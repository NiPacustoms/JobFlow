'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { timesService } from '@/lib/services/times';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/lib/utils/toast';

export interface TimeEntry {
  id: string;
  userId: string;
  assignmentId?: string; // Pflichtfeld für work/break, optional für sick
  date: Date;
  type: 'work' | 'break' | 'sick';
  startTime?: string;
  endTime?: string;
  hours: number;
  balance: number;
  status: 'active' | 'completed' | 'pending' | 'approved' | 'rejected';
  reason?: string;
  facility?: string;
  shiftType?: string;
  breaks?: number;
  remark?: string;
  approvedBy?: string;
  doctor?: string;
}

export interface TimeStats {
  currentStatus: 'working' | 'break' | 'off' | 'sick';
  totalHours: number;
  workHours: number;
  overtimeHours: number;
  sickHours: number;
  totalBalance: number;
  todayWorkTime: string;
  todayWorkTimeMinutes: number;
  sickDays: number;
  timeEntries: TimeEntry[];
  workEntries: Array<{
    date: Date;
    shiftType: string;
    facility: string;
    startTime: string;
    endTime: string;
    breaks: number;
    hours: number;
    status: string;
  }>;
  sickEntries: Array<{
    startDate: Date;
    endDate: Date;
    days: number;
    status: string;
    doctor: string;
    remark: string;
  }>;
}

export function useTimes() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id;

  // Get all time entries
  const {
    data: timesData = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['times', userId],
    queryFn: async () => {
      if (!userId) return [];
      return await timesService.getByUserId(userId);
    },
    enabled: !!userId,
  });

  // Ensure times is always defined
  const times = timesData || [];

  // Start shift mutation
  const startShiftMutation = useMutation({
    mutationFn: (assignmentId?: string) => {
      if (!userId) throw new Error('No user ID');
      return timesService.startShift(userId, assignmentId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['times'] });
      toast.success('Schicht erfolgreich gestartet');
    },
    onError: (error) => {
      toast.error('Fehler beim Starten der Schicht: ' + error.message);
    },
  });

  // End shift mutation
  const endShiftMutation = useMutation({
    mutationFn: () => {
      if (!userId) throw new Error('No user ID');
      return timesService.endShift(userId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['times'] });
      toast.success('Schicht erfolgreich beendet');
    },
    onError: (error) => {
      toast.error('Fehler beim Beenden der Schicht: ' + error.message);
    },
  });

  // Add break mutation
  const addBreakMutation = useMutation({
    mutationFn: (data: { reason: string; duration: number; assignmentId?: string }) => {
      if (!userId) throw new Error('No user ID');
      return timesService.addBreak(userId, { reason: data.reason, duration: data.duration }, data.assignmentId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['times'] });
      toast.success('Pause erfolgreich hinzugefügt');
    },
    onError: (error) => {
      toast.error('Fehler beim Hinzufügen der Pause: ' + error.message);
    },
  });

  // End break mutation
  const endBreakMutation = useMutation({
    mutationFn: () => {
      if (!userId) throw new Error('No user ID');
      return timesService.endBreak(userId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['times'] });
      toast.success('Pause erfolgreich beendet');
    },
    onError: (error) => {
      toast.error('Fehler beim Beenden der Pause: ' + error.message);
    },
  });

  // Report sick mutation
  const reportSickMutation = useMutation({
    mutationFn: (data: { startDate: Date; endDate: Date; reason: string; doctorNote?: string }) => {
      if (!userId) throw new Error('No user ID');
      return timesService.reportSick(userId, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['times'] });
      toast.success('Krankmeldung erfolgreich eingereicht');
    },
    onError: (error) => {
      toast.error('Fehler beim Einreichen der Krankmeldung: ' + error.message);
    },
  });

  // Export times mutation
  const exportTimesMutation = useMutation({
    mutationFn: (format: 'pdf' | 'excel' | 'csv') => {
      if (!userId) throw new Error('No user ID');
      return timesService.exportTimes(format, userId);
    },
    onSuccess: (ergebnis) => {
      // CSV/Excel laden im ExportService selbst herunter; das PDF liegt im
      // Storage und wird in einem neuen Tab geöffnet.
      if (ergebnis.art === 'url') {
        window.open(ergebnis.wert, '_blank', 'noopener');
      }
      toast.success('Zeiten erfolgreich exportiert');
    },
    onError: (error) => {
      toast.error('Fehler beim Exportieren: ' + error.message);
    },
  });

  // Helper functions
  const startShift = async (assignmentId?: string) => {
    return startShiftMutation.mutateAsync(assignmentId);
  };

  const endShift = async () => {
    return endShiftMutation.mutateAsync();
  };

  const addBreak = async (data: { reason: string; duration: number; assignmentId?: string }) => {
    return addBreakMutation.mutateAsync(data);
  };

  const endBreak = async () => {
    return endBreakMutation.mutateAsync();
  };

  const reportSick = async (data: { startDate: Date; endDate: Date; reason: string; doctorNote?: string }) => {
    return reportSickMutation.mutateAsync(data);
  };

  const exportTimes = async (format: 'pdf' | 'excel' | 'csv') => {
    return exportTimesMutation.mutateAsync(format);
  };

  // Get time statistics - berechnet aus echten Daten, keine Mock-Daten
  const getTimeStats = (): TimeStats => {
    const allEntries = times || [];
    const workEntries = allEntries.filter(e => e.type === 'work');
    const sickEntries = allEntries.filter(e => e.type === 'sick');
    
    const totalHours = workEntries.reduce((sum, e) => sum + e.hours, 0);
    const workHours = workEntries.filter(e => e.status === 'completed').reduce((sum, e) => sum + e.hours, 0);
    const overtimeHours = workEntries.reduce((sum, e) => sum + Math.max(0, e.balance), 0);
    const sickHours = sickEntries.reduce((sum, e) => sum + e.hours, 0);
    const totalBalance = workEntries.reduce((sum, e) => sum + e.balance, 0);
    
    // Heutige Arbeitszeit berechnen
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayEntries = workEntries.filter(e => {
      const entryDate = new Date(e.date);
      entryDate.setHours(0, 0, 0, 0);
      return entryDate.getTime() === today.getTime();
    });
    const todayWorkTimeMinutes = todayEntries.reduce((sum, e) => sum + (e.hours * 60), 0);
    const todayWorkTime = `${Math.floor(todayWorkTimeMinutes / 60)}h ${todayWorkTimeMinutes % 60}min`;
    
    // Aktueller Status
    const activeEntry = allEntries.find(e => e.status === 'active');
    let currentStatus: 'working' | 'break' | 'off' | 'sick' = 'off';
    if (activeEntry) {
      if (activeEntry.type === 'work') currentStatus = 'working';
      else if (activeEntry.type === 'break') currentStatus = 'break';
      else if (activeEntry.type === 'sick') currentStatus = 'sick';
    }
    
    // Berechne Pausen für jeden Work-Eintrag
    const breakEntries = allEntries.filter(e => e.type === 'break' && e.status === 'completed');
    
    return {
      currentStatus,
      totalHours,
      workHours,
      overtimeHours,
      sickHours,
      totalBalance,
      todayWorkTime,
      todayWorkTimeMinutes,
      sickDays: sickEntries.length,
      timeEntries: allEntries,
      workEntries: workEntries.map(e => {
        // Finde alle Pausen, die zu diesem Work-Eintrag gehören
        // Pausen gehören zu einem Work-Eintrag, wenn:
        // 1. Sie am selben Tag sind
        // 2. Sie die gleiche assignmentId haben (falls vorhanden)
        // 3. Sie zwischen Start- und Endzeit des Work-Eintrags liegen
        const workDate = new Date(e.date);
        workDate.setHours(0, 0, 0, 0);
        
        const relatedBreaks = breakEntries.filter(b => {
          const breakDate = new Date(b.date);
          breakDate.setHours(0, 0, 0, 0);
          
          // Gleicher Tag
          if (workDate.getTime() !== breakDate.getTime()) {
            return false;
          }
          
          // Gleiche assignmentId (falls vorhanden)
          if (e.assignmentId && b.assignmentId && e.assignmentId !== b.assignmentId) {
            return false;
          }
          
          // Wenn keine assignmentId vorhanden ist, prüfe ob die Pause zeitlich zur Schicht passt
          // (für alte Einträge ohne assignmentId)
          if (!e.assignmentId || !b.assignmentId) {
            // Prüfe ob Pause zwischen Start und Ende liegt
            if (e.startTime && e.endTime && b.startTime) {
              const workStart = e.startTime.split(':').map(Number);
              const workEnd = e.endTime.split(':').map(Number);
              const breakStart = b.startTime.split(':').map(Number);
              
              const workStartMinutes = workStart[0] * 60 + workStart[1];
              const workEndMinutes = workEnd[0] * 60 + workEnd[1];
              const breakStartMinutes = breakStart[0] * 60 + breakStart[1];
              
              if (breakStartMinutes < workStartMinutes || breakStartMinutes > workEndMinutes) {
                return false;
              }
            }
          }
          
          return true;
        });
        
        // Summiere Pausen in Minuten
        const totalBreakMinutes = relatedBreaks.reduce((sum, b) => {
          // Breaks haben hours als Dezimalzahl (z.B. 0.5 für 30 Minuten)
          return sum + Math.round(b.hours * 60);
        }, 0);
        
        return {
          date: e.date,
          shiftType: e.shiftType || '',
          facility: e.facility || '',
          startTime: e.startTime || '',
          endTime: e.endTime || '',
          breaks: totalBreakMinutes,
          hours: e.hours,
          status: e.status,
        };
      }),
      sickEntries: sickEntries.map(e => {
        const entry = e as TimeEntry & { startDate?: Date; endDate?: Date; days?: number };
        const startDate = entry.startDate || e.date;
        const endDate = entry.endDate || entry.startDate || e.date;
        const days = entry.days || Math.ceil(e.hours / 8);
        
        return {
          startDate,
          endDate,
          days,
          status: e.status,
          doctor: e.doctor || '',
          remark: e.reason || '',
        };
      }),
    };
  };

  return {
    times,
    isLoading,
    error,
    startShift,
    endShift,
    addBreak,
    endBreak,
    reportSick,
    exportTimes,
    getTimeStats,
    refetch,
    isStarting: startShiftMutation.isPending,
    isEnding: endShiftMutation.isPending,
    isAddingBreak: addBreakMutation.isPending,
    isEndingBreak: endBreakMutation.isPending,
  };
}
