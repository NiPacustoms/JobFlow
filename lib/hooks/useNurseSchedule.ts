import { useAuth } from '@/contexts/AuthContext';
import { assignmentService, cloudFunctions, shiftService } from '@/lib/services';
import type { Assignment } from '@/lib/services/assignments';
import { TimeConflict } from '@/lib/types';
import type { Shift } from '@/lib/services/shifts';
import { toast } from '@/lib/utils/toast';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { endOfWeek, format, startOfWeek } from 'date-fns';
import { de } from 'date-fns/locale';
import { getShiftTypeColor as getShiftTypeColorToken } from '@/lib/design-tokens';

export interface NurseScheduleData {
  myAssignments: Assignment[];
  openShifts: Shift[];
  pendingAssignments: Assignment[];
  upcomingAssignments: Assignment[];
  conflicts: TimeConflict[];
  isLoading: boolean;
  error: Error | null;
}

export interface NurseScheduleActions {
  acceptAssignment: (assignmentId: string) => Promise<void>;
  declineAssignment: (assignmentId: string, reason?: string) => Promise<void>;
  requestShift: (shiftId: string, message?: string) => Promise<void>;
}

export const useNurseSchedule = (view: 'week' | 'month' = 'week', date?: Date) => {
  const { user } = useAuth();
  const userId = user?.id;
  const queryClient = useQueryClient();
  const targetDate = date || new Date();

  // Date range calculation
  const getDateRange = () => {
    switch (view) {
      case 'week':
        return {
          start: startOfWeek(targetDate, { weekStartsOn: 1 }),
          end: endOfWeek(targetDate, { weekStartsOn: 1 }),
        };
      case 'month':
        return {
          start: new Date(targetDate.getFullYear(), targetDate.getMonth(), 1),
          end: new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0),
        };
      default:
        return {
          start: new Date(targetDate.getFullYear(), targetDate.getMonth(), 1),
          end: new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0),
        };
    }
  };

  // Get my assignments
  const { data: myAssignments = [], isLoading: loadingAssignments } = useQuery<Assignment[]>({
    queryKey: ['nurseSchedule', 'assignments', userId, user?.companyId, view, format(targetDate, 'yyyy-MM-dd')],
    queryFn: async (): Promise<Assignment[]> => {
      if (!userId) return [];
      const dateRange = getDateRange();
      return await assignmentService.getByUserAndDateRange(userId, dateRange.start, dateRange.end, user?.companyId || undefined);
    },
    enabled: !!userId,
    staleTime: 2 * 60 * 1000, // 2 minutes
  });

  // Get open shifts
  const { data: openShifts = [], isLoading: loadingShifts } = useQuery({
    queryKey: ['nurseSchedule', 'openShifts', view, format(targetDate, 'yyyy-MM-dd'), user?.companyId],
    queryFn: async () => {
      const dateRange = getDateRange();
      return await shiftService.getByDateRange(dateRange.start, dateRange.end, user?.companyId || undefined);
    },
    enabled: !!user?.companyId,
    staleTime: 1 * 60 * 1000, // 1 minute
  });

  // Get facilities for shift details - nur für die eigene Firma
  const { data: facilities = [] } = useQuery({
    queryKey: ['nurseSchedule', 'facilities', user?.companyId],
    queryFn: async () => {
      const { facilityService } = await import('@/lib/services');
      return await facilityService.getAll(user?.companyId);
    },
    enabled: !!user?.companyId, // Nur laden, wenn companyId vorhanden ist
    staleTime: 10 * 60 * 1000, // 10 minutes
  });

  // Mutations
  const acceptAssignment = useMutation({
    mutationFn: async (assignmentId: string) => {
      return await assignmentService.accept(assignmentId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nurseSchedule'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success('Schicht erfolgreich angenommen!');
    },
    onError: (error) => {
      toast.error('Fehler beim Annehmen der Schicht: ' + error.message);
    },
  });

  const declineAssignment = useMutation({
    mutationFn: async (data: { assignmentId: string; reason?: string }) => {
      // Verwende Cloud Function für den Unterschrifts-Workflow
      return await cloudFunctions.declineAssignment({
        assignmentId: data.assignmentId,
        declineType: 'nurse-initiated',
        declineReason: data.reason,
      });
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['nurseSchedule'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      if (result.requiresSignature) {
        toast.success('Schicht abgelehnt. Bitte warte auf Admin-Unterschrift.');
      } else {
        toast.success('Schicht abgelehnt.');
      }
    },
    onError: (error) => {
      toast.error('Fehler beim Ablehnen der Schicht: ' + error.message);
    },
  });

  const requestShift = useMutation({
    mutationFn: async (data: { shiftId: string; message?: string }) => {
      return await cloudFunctions.requestShiftAssignment(data.shiftId, data.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nurseSchedule'] });
      queryClient.invalidateQueries({ queryKey: ['openShifts'] });
      toast.success('Schichtanfrage gesendet!');
    },
    onError: (error) => {
      toast.error('Fehler beim Senden der Anfrage: ' + error.message);
    },
  });

  // Helper functions
  // Get pending assignments (requested, pending, or assigned - all need employee action)
  const getPendingAssignments = () => {
    return myAssignments.filter(assignment => 
      assignment.status === 'requested' || 
      assignment.status === 'pending' || 
      assignment.status === 'assigned' // Zugewiesene Schichten benötigen auch eine Bestätigung
    );
  };

  const getUpcomingAssignments = () => {
    const now = new Date();
    return myAssignments.filter(assignment => {
      // This would need to be enhanced with actual shift data
      return assignment.assignedAt >= now;
    });
  };

  // Zentrale Schichttyp-Farbe (lib/design-tokens)
  const getShiftTypeColor = (type: Shift['type']) => getShiftTypeColorToken(type);

  // Get status color
  const getStatusColor = (status: Assignment['status']) => {
    switch (status) {
      case 'pending':
        return 'warning';
      case 'accepted':
        return 'success';
      case 'declined':
        return 'error';
      case 'completed':
        return 'info';
      case 'requested':
        return 'info';
      case 'assigned':
        return 'primary';
      default:
        return 'default';
    }
  };

  // Get status label
  const getStatusLabel = (status: Assignment['status']) => {
    switch (status) {
      case 'pending':
        return 'Ausstehend';
      case 'accepted':
        return 'Angenommen';
      case 'declined':
        return 'Abgelehnt';
      case 'completed':
        return 'Abgeschlossen';
      case 'requested':
        return 'Angefragt';
      case 'assigned':
        return 'Zugewiesen';
      default:
        return 'Unbekannt';
    }
  };

  // Check if user is qualified for shift
  const isQualifiedForShift = (shift: Shift) => {
    if (!user?.qualifications || shift.requiredQualifications.length === 0) return true;

    const userQualifications = user.qualifications;
    const requiredQualifications = shift.requiredQualifications;

    return requiredQualifications.every(qual => userQualifications.includes(qual));
  };

  // Get missing qualifications for shift
  const getMissingQualifications = (shift: Shift): string[] => {
    if (!user?.qualifications || shift.requiredQualifications.length === 0) return [];

    const userQualifications = user.qualifications;
    const requiredQualifications = shift.requiredQualifications;

    return requiredQualifications.filter(qual => !userQualifications.includes(qual));
  };

  // Format time for display
  const formatTime = (date: Date, time: string) => {
    const [hours, minutes] = time.split(':');
    const dateTime = new Date(date);
    dateTime.setHours(parseInt(hours), parseInt(minutes));
    return format(dateTime, 'HH:mm', { locale: de });
  };

  // Get time until shift starts
  const getTimeUntilShift = (shift: Shift) => {
    const now = new Date();
    const shiftDate = new Date(shift.date);
    const [hours, minutes] = shift.startTime.split(':');
    shiftDate.setHours(parseInt(hours), parseInt(minutes));

    const diffMs = shiftDate.getTime() - now.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

    if (diffDays > 0) {
      return `${diffDays} Tag${diffDays > 1 ? 'e' : ''}`;
    } else if (diffHours > 0) {
      return `${diffHours} Stunde${diffHours > 1 ? 'n' : ''}`;
    } else {
      return 'Bald';
    }
  };

  const isLoading = loadingAssignments || loadingShifts;
  const error = acceptAssignment.error || declineAssignment.error || requestShift.error;

  const data: NurseScheduleData = {
    myAssignments,
    openShifts: openShifts.filter(shift => shift.status === 'open'),
    pendingAssignments: getPendingAssignments(), // Verwende getPendingAssignments() statt getAssignmentsByStatus('pending')
    upcomingAssignments: getUpcomingAssignments(),
    conflicts: [], // Would be populated by conflict checking
    isLoading,
    error: error as Error | null,
  };

  const actions: NurseScheduleActions = {
    acceptAssignment: acceptAssignment.mutateAsync,
    declineAssignment: async (assignmentId: string, reason?: string) => {
      await declineAssignment.mutateAsync({ assignmentId, reason });
    },
    requestShift: async (shiftId: string, message?: string) => {
      await requestShift.mutateAsync({ shiftId, message });
    },
  };

  return {
    ...data,
    ...actions,
    // Helper functions
    getShiftTypeColor,
    getStatusColor,
    getStatusLabel,
    isQualifiedForShift,
    getMissingQualifications,
    formatTime,
    getTimeUntilShift,
    // Raw data
    facilities,
  };
};
