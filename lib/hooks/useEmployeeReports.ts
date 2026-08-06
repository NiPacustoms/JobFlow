'use client';

import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { useAuth } from '@/contexts/AuthContext';
import { timesheetService } from '@/lib/services/timesheets';
import type { Timesheet } from '@/lib/services/timesheets';
import { timesService } from '@/lib/services/times';
import type { TimeEntry } from '@/lib/services/times';
import { reportService } from '@/lib/services/reports';
import { toast } from '@/lib/utils/toast';
import { logger } from '@/lib/utils/logger';

export interface EmployeeReportFilters {
  year?: number;
  startDate?: Date;
  endDate?: Date;
  [key: string]: unknown;
}

interface ExportData {
  reportId: string;
  [key: string]: unknown;
}

interface ExportFilters {
  startDate: Date;
  endDate: Date;
  [key: string]: unknown;
}

export function useEmployeeReports(_filters?: EmployeeReportFilters) {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  // Get timesheets for the current user
  const { data: timesheets = [], isLoading: loadingTimesheets, error, refetch: refetchTimesheets } = useQuery<Timesheet[]>({
    queryKey: ['employeeTimesheets', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      try {
        return await timesheetService.getByUserId(user.id);
      } catch (error) {
        logger.error('Error fetching timesheets:', error);
        return [];
      }
    },
    enabled: !!user?.id,
  });

  // Get sick leave entries
  type SickEntry = TimeEntry & {
    startDate: Date;
    endDate: Date;
    days: number;
  };

const { data: timeEntries = [], isLoading: loadingTimeEntries } = useQuery<SickEntry[]>({
    queryKey: ['employeeTimeEntries', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      try {
        const allEntries = await timesService.getByUserId(user.id);
        // Filter for sick entries and normalise optional fields
        return allEntries
          .filter((entry): entry is TimeEntry & { startDate?: Date; endDate?: Date; days?: number } => entry.type === 'sick')
          .map<SickEntry>((entry) => {
            const startDate = entry.startDate ?? entry.date;
            const endDate = entry.endDate ?? entry.date;
            const days = entry.days ?? (entry.hours ? Math.round(entry.hours / 8) : 1);

            return {
              ...entry,
              startDate,
              endDate,
              days,
            };
          });
      } catch (error) {
        logger.error('Error fetching time entries:', error);
        return [];
      }
    },
    enabled: !!user?.id,
  });

  // Generate time account report
  const generateTimeAccountReportMutation = useMutation({
    mutationFn: async (filters: {
      startDate: Date;
      endDate: Date;
      includeOvertime?: boolean;
    }) => {
      if (!user?.id) throw new Error('No user ID');
      return await reportService.generateTimeAccountReport({
        userId: user.id,
        ...filters,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employeeTimesheets'] });
      toast.success('Zeitkonto-Bericht erfolgreich generiert');
    },
    onError: (error: Error) => {
      logger.error('Error generating time account report:', error);
      toast.error('Fehler beim Generieren des Zeitkonto-Berichts');
    },
  });

  // Export functions
  const exportTimeAccountReportPDF = async (data: ExportData, filters: ExportFilters) => {
    try {
      return await reportService.exportTimeAccountReportPDF(data, filters);
    } catch (error) {
      logger.error('Error exporting PDF:', error);
      toast.error('Fehler beim Exportieren der PDF');
      throw error;
    }
  };

  const exportTimeAccountReportExcel = async (data: ExportData, filters: ExportFilters) => {
    try {
      return await reportService.exportTimeAccountReportExcel(data, filters);
    } catch (error) {
      logger.error('Error exporting Excel:', error);
      toast.error('Fehler beim Exportieren der Excel-Datei');
      throw error;
    }
  };

  // Helper functions
  const formatDate = (date: Date | string) => {
    return format(new Date(date), 'dd.MM.yyyy');
  };

  const formatDateTime = (date: Date | string) => {
    return format(new Date(date), 'dd.MM.yyyy HH:mm');
  };

  const formatTime = (date: Date | string) => format(new Date(date), 'HH:mm');
  const formatWeek = (date: Date | string) => format(new Date(date), "'KW'ww yyyy");
  const formatMonth = (date: Date | string) => format(new Date(date), 'MMMM yyyy');
  const formatCurrency = (value: number) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(value);
  const formatHours = (value: number) => `${value.toFixed(2)} h`;
  const formatPercentage = (value: number, total?: number) =>
    total != null && total > 0 ? `${((value / total) * 100).toFixed(1)} %` : `${value.toFixed(1)} %`;
  const getStatusColor = (_status: string) => 'default' as const;
  const getStatusLabel = (status: string) => status;
  type TrendValue = 'up' | 'down' | 'flat';
  const getTrendIcon = (_trend: TrendValue) => null;
  const getTrendText = (_trend: TrendValue) => '';

  const workTimeReport = useMemo(() => {
    const list = timesheets ?? [];
    const totalHours = list.reduce((sum, ts) => sum + (ts.totalHours || 0), 0);
    const overtimeHours = list.reduce((sum, ts) => sum + (ts.overtimeHours || 0), 0);
    const regularHours = Math.max(0, totalHours - overtimeHours);

    // Aggregation je Kalendertag (für Kennzahlen und Chart)
    const byDay = new Map<
      string,
      { day: Date; totalHours: number; regularHours: number; overtimeHours: number }
    >();
    const weeks = new Set<string>();
    for (const ts of list) {
      const d = ts.date instanceof Date ? ts.date : new Date(ts.date);
      if (Number.isNaN(d.getTime())) continue;
      const dayKey = d.toISOString().slice(0, 10);
      weeks.add(format(d, "RRRR-'W'II")); // ISO-Woche
      const th = ts.totalHours || 0;
      const ot = ts.overtimeHours || 0;
      const cur = byDay.get(dayKey) ?? { day: d, totalHours: 0, regularHours: 0, overtimeHours: 0 };
      cur.totalHours += th;
      cur.overtimeHours += ot;
      cur.regularHours += Math.max(0, th - ot);
      byDay.set(dayKey, cur);
    }
    const hoursByDay = [...byDay.values()].sort((a, b) => a.day.getTime() - b.day.getTime());
    const workingDays = byDay.size;
    const weekCount = weeks.size || (workingDays > 0 ? 1 : 0);
    const averageHoursPerDay = workingDays > 0 ? totalHours / workingDays : 0;
    const averageHoursPerWeek = weekCount > 0 ? totalHours / weekCount : 0;

    // ArbZG: keine Überschreitung der 10h-Tagesgrenze (§3)
    const maxDailyHours = hoursByDay.reduce((m, d) => Math.max(m, d.totalHours), 0);
    const arbzgCompliance = {
      isCompliant: maxDailyHours <= 10,
      maxDailyHours,
      violations: [] as string[],
    };

    return {
      data: list,
      summary: { totalHours, regularHours, overtimeHours, workingDays },
      totalHours,
      regularHours,
      overtimeHours,
      averageHoursPerDay,
      averageHoursPerWeek,
      workingDays,
      trend: 'flat' as TrendValue,
      hoursByDay,
      arbzgCompliance,
    };
  }, [timesheets]);

  // Berichtszeitraum aus den vorhandenen Timesheets ableiten (Fallback: laufendes Jahr)
  const reportDateRange = useMemo(() => {
    const list = timesheets ?? [];
    const times = list
      .map(ts => (ts.date instanceof Date ? ts.date : new Date(ts.date)).getTime())
      .filter(t => !Number.isNaN(t));
    const now = new Date();
    const startDate = times.length
      ? new Date(Math.min(...times))
      : new Date(now.getFullYear(), 0, 1);
    const endDate = times.length ? new Date(Math.max(...times)) : now;
    return { startDate, endDate };
  }, [timesheets]);

  /**
   * Exportiert den Arbeitszeit-Bericht des Mitarbeiters direkt über die
   * Dokumenterzeugung bzw. den ExportService. Der frühere Umweg über
   * reportService.exportReport('employee-worktime') schlug immer fehl, weil
   * ein Bericht mit dieser ID nie angelegt wird.
   */
  const exportWorkTimeReport = async (format: 'pdf' | 'excel') => {
    if (!user?.id) throw new Error('No user ID');
    try {
      if (format === 'pdf') {
        const { documentGenerationService } = await import('@/lib/services/documentGeneration');
        const dokument = await documentGenerationService.generateDocument({
          type: 'timesheet-report',
          userId: user.id,
          dateRange: { start: reportDateRange.startDate, end: reportDateRange.endDate },
        });
        window.open(dokument.url, '_blank', 'noopener');
        return dokument.url;
      }

      const { ExportService } = await import('@/lib/services/exportService');
      const zeilen = (timesheets ?? []).map(ts => ({
        Datum: ts.date instanceof Date ? ts.date : new Date(ts.date),
        Start: ts.startTime || '',
        Ende: ts.endTime || '',
        'Pause (Min)': ts.breakMinutes || 0,
        Stunden: ts.totalHours || 0,
        Status: ts.status || '',
      }));
      if (zeilen.length === 0) {
        throw new Error('Keine Nachweise zum Exportieren vorhanden.');
      }
      return await ExportService.exportToExcel(zeilen, {
        filename: `arbeitszeit-bericht-${new Date().toISOString().split('T')[0]}.xls`,
      });
    } catch (error) {
      logger.error('Error exporting work time report:', error);
      toast.error('Fehler beim Exportieren des Arbeitszeit-Berichts');
      throw error;
    }
  };
  const exportAllReports = async (format: 'pdf' | 'excel') => {
    await exportWorkTimeReport(format);
  };

  const refetch = () => { void refetchTimesheets(); queryClient.invalidateQueries({ queryKey: ['employeeTimeEntries'] }); };

  const getTotalHours = () => {
    return timesheets.reduce((sum, ts) => sum + (ts.totalHours || 0), 0);
  };

  const getOvertimeHours = () => {
    // Calculate overtime: Stunden > 8h pro Tag oder > 40h pro Woche
    // Group by week first
    const timesheetsByWeek = new Map<string, Timesheet[]>();
    timesheets.forEach(ts => {
      const date = ts.date instanceof Date ? ts.date : new Date(ts.date);
      const weekStart = new Date(date);
      weekStart.setDate(date.getDate() - date.getDay()); // Start of week (Sunday)
      const weekKey = `${weekStart.getFullYear()}-W${Math.ceil((weekStart.getTime() - new Date(weekStart.getFullYear(), 0, 1).getTime()) / (7 * 24 * 60 * 60 * 1000))}`;
      
      if (!timesheetsByWeek.has(weekKey)) {
        timesheetsByWeek.set(weekKey, []);
      }
      timesheetsByWeek.get(weekKey)!.push(ts);
    });

    let totalOvertime = 0;
    timesheetsByWeek.forEach((weekTimesheets) => {
      // Daily overtime: > 8h per day
      const dailyOvertime = weekTimesheets.reduce((sum, ts) => {
        const hours = ts.totalHours || 0;
        return sum + Math.max(0, hours - 8);
      }, 0);
      
      // Weekly overtime: > 40h per week
      const weeklyTotal = weekTimesheets.reduce((sum, ts) => sum + (ts.totalHours || 0), 0);
      const weeklyOvertime = Math.max(0, weeklyTotal - 40);
      
      // Use the maximum of daily or weekly overtime
      totalOvertime += Math.max(dailyOvertime, weeklyOvertime);
    });

    return totalOvertime;
  };

  const isLoading = loadingTimesheets || loadingTimeEntries ||
    generateTimeAccountReportMutation.isPending;

  return {
    // Data
    timesheets,
    timeEntries,
    user,
    workTimeReport,
    // Loading states
    isLoading,
    loadingTimesheets,
    loadingTimeEntries,
    error,
    // Mutations
    generateTimeAccountReport: generateTimeAccountReportMutation.mutateAsync,
    // Export functions
    exportTimeAccountReportPDF,
    exportTimeAccountReportExcel,
    exportWorkTimeReport,
    exportAllReports,
    refetch,
    // Helper functions
    formatDate,
    formatTime,
    formatDateTime,
    formatWeek,
    formatMonth,
    formatCurrency,
    formatHours,
    formatPercentage,
    getStatusColor,
    getStatusLabel,
    getTrendIcon,
    getTrendText,
    getTotalHours,
    getOvertimeHours,
    // Computed values
    totalHours: getTotalHours(),
    overtimeHours: getOvertimeHours(),
  };
}