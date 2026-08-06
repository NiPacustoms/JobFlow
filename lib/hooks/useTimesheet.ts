import { useAuth } from '@/contexts/AuthContext';
import { timesheetService } from '@/lib/services';
import { TimesheetForm } from '@/lib/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { getRequiredBreakMinutes } from '@/lib/utils/time';

export const useTimesheet = (date?: Date) => {
  const { user } = useAuth();
  const userId = user?.id;
  const queryClient = useQueryClient();
  const targetDate = date || new Date();

  // Get today's timesheet
  const {
    data: timesheet,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['timesheet', userId, format(targetDate, 'yyyy-MM-dd')],
    queryFn: async () => {
      if (!userId) return null;
      const todaySheet = await timesheetService.getByDate(userId, targetDate);
      if (todaySheet) return todaySheet;
      // Nachtschicht-Rollover: Eine um z. B. 22:00 gestartete Schicht ist unter
      // dem VORTAG gespeichert. Nach Mitternacht wäre die Schnell-Erfassung
      // sonst „leer" und die laufende Schicht nicht mehr beendbar.
      if (!date) {
        const yesterday = new Date(targetDate);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdaySheet = await timesheetService.getByDate(userId, yesterday);
        const isOpenDraft =
          yesterdaySheet?.status === 'draft' &&
          (!yesterdaySheet.endTime || yesterdaySheet.endTime === yesterdaySheet.startTime);
        if (isOpenDraft) return yesterdaySheet;
      }
      return null;
    },
    enabled: !!userId,
    staleTime: 2 * 60 * 1000, // 2 minutes
  });

  // Get recent timesheets for history
  const { data: recentTimesheets } = useQuery({
    queryKey: ['timesheets', 'recent', userId],
    queryFn: async () => {
      if (!userId) return [];
      return await timesheetService.getByUserId(userId, 3);
    },
    enabled: !!userId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Create timesheet mutation
  const createTimesheet = useMutation({
    mutationFn: async (data: TimesheetForm) => {
      if (!userId) throw new Error('No user ID');
      return await timesheetService.create(userId, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['timesheet'] });
      queryClient.invalidateQueries({ queryKey: ['timesheets'] });
    },
  });

  // Update timesheet mutation
  const updateTimesheet = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<TimesheetForm> }) => {
      return await timesheetService.update(id, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['timesheet'] });
      queryClient.invalidateQueries({ queryKey: ['timesheets'] });
    },
  });

  // Submit timesheet mutation
  const submitTimesheet = useMutation({
    mutationFn: async (id: string) => {
      return await timesheetService.submit(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['timesheet'] });
      queryClient.invalidateQueries({ queryKey: ['timesheets'] });
    },
  });

  // Calculate total hours
  const calculateTotalHours = (startTime: string, endTime: string, breakMinutes: number) => {
    if (!startTime || !endTime) return 0;

    const start = new Date(`2000-01-01T${startTime}`);
    const end = new Date(`2000-01-01T${endTime}`);

    let totalMinutes = (end.getTime() - start.getTime()) / (1000 * 60);

    // Handle overnight shifts
    if (totalMinutes < 0) {
      totalMinutes += 24 * 60; // Add 24 hours
    }

    const totalHours = (totalMinutes - breakMinutes) / 60;
    return Math.round(totalHours * 100) / 100; // Round to 2 decimal places
  };

  // Check if break warning is needed (>6h work, <30min break)
  const needsBreakWarning = (workMinutes: number, breakMinutes: number) => {
    const requiredBreakMinutes = getRequiredBreakMinutes(workMinutes);
    return breakMinutes < requiredBreakMinutes;
  };

  return {
    timesheet,
    recentTimesheets: recentTimesheets || [],
    isLoading,
    error,
    createTimesheet,
    updateTimesheet,
    submitTimesheet,
    calculateTotalHours,
    needsBreakWarning,
  };
};
