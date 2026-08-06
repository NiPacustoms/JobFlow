import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { TimeAccountReport, EmployeeStatistics, reportService } from '@/lib/services/reports';
import { useAuth } from '@/contexts/AuthContext';


import { toast } from '@/lib/utils/toast';

export interface AdminReportFilters {
  startDate?: Date;
  endDate?: Date;
  facilityId?: string;
  userId?: string;
}

export const useAdminReports = (filters: AdminReportFilters) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Zeitkonten-Bericht
  const {
    data: timeAccountReport,
    isLoading: isLoadingTime,
    error: errorTime,
  } = useQuery<TimeAccountReport>({
    queryKey: ['admin-reports', 'time-account', filters],
    queryFn: async () => {
      const reports = await reportService.generateTimeAccountReport(filters);
      if (reports.length === 0) {
        return {
          totalHours: 0,
          regularHours: 0,
          overtimeHours: 0,
          nightHours: 0,
          weekendHours: 0,
          holidayHours: 0,
          averageHoursPerDay: 0,
          averageHoursPerWeek: 0,
          workingDays: 0,
          trend: 'flat' as const,
          hoursByDay: [],
          employees: []
        };
      }
      
      // Aggregiere alle Reports zu einem einzelnen Objekt
      const totalHours = reports.reduce((sum, r) => sum + r.totalHours, 0);
      const regularHours = reports.reduce((sum, r) => sum + r.regularHours, 0);
      const overtimeHours = reports.reduce((sum, r) => sum + r.overtimeHours, 0);
      const nightHours = reports.reduce((sum, r) => sum + r.nightHours, 0);
      const weekendHours = reports.reduce((sum, r) => sum + r.weekendHours, 0);
      const holidayHours = reports.reduce((sum, r) => sum + r.holidayHours, 0);
      
      // Berechne korrekte Durchschnittswerte
      const totalWorkingDays = reports.reduce((sum, r) => sum + r.workingDays, 0);
      const averageHoursPerDay = totalWorkingDays > 0 ? totalHours / totalWorkingDays : 0;
      const averageHoursPerWeek = totalHours / Math.max(1, Math.ceil(totalWorkingDays / 7));
      
      // Bestimme Trend basierend auf Vergleich mit vorherigem Zeitraum
      const trend = reports.length > 1 && reports[0].totalHours > reports[1].totalHours ? 'up' as const : 
                   reports.length > 1 && reports[0].totalHours < reports[1].totalHours ? 'down' as const : 'flat' as const;
      
      return {
        totalHours,
        regularHours,
        overtimeHours,
        nightHours,
        weekendHours,
        holidayHours,
        averageHoursPerDay,
        averageHoursPerWeek,
        workingDays: totalWorkingDays,
        trend,
        hoursByDay: reports[0]?.hoursByDay || [],
        employees: (reports[0]?.employees || []).map(e => ({
          userId: e.userId,
          userName: e.userName,
          totalHours: e.totalHours,
          regularHours: e.regularHours,
          overtimeHours: e.overtimeHours,
        }))
      };
    },
    enabled: !!user?.id,
    staleTime: 30000,
  });

  // Mitarbeiter-Statistiken
  const {
    data: employeeStatistics,
    isLoading: isLoadingEmployee,
    error: errorEmployee,
  } = useQuery<EmployeeStatistics>({
    queryKey: ['admin-reports', 'employee', filters],
    queryFn: async () => {
      const reports = await reportService.generateEmployeeStatistics(filters);
      if (reports.length === 0) {
        return {
          totalEmployees: 0,
          activeEmployees: 0,
          averageShiftsPerEmployee: 0,
          averageHoursPerEmployee: 0,
          topPerformers: 0,
          employeeTrend: 'flat' as const,
          employeesByFacility: []
        };
      }
      
      // Aggregiere alle Reports zu einem einzelnen Objekt
      const totalEmployees = reports.reduce((sum, r) => sum + r.totalEmployees, 0);
      const activeEmployees = reports.reduce((sum, r) => sum + r.activeEmployees, 0);
      
      // Berechne korrekte Durchschnittswerte
      const averageShiftsPerEmployee = totalEmployees > 0 ? 
        reports.reduce((sum, r) => sum + r.averageShiftsPerEmployee * r.totalEmployees, 0) / totalEmployees : 0;
      const averageHoursPerEmployee = totalEmployees > 0 ? 
        reports.reduce((sum, r) => sum + r.averageHoursPerEmployee * r.totalEmployees, 0) / totalEmployees : 0;
      const topPerformers = reports.reduce((sum, r) => sum + r.topPerformers, 0);
      
      // Bestimme Trend basierend auf Vergleich mit vorherigem Zeitraum
      const employeeTrend = reports.length > 1 && reports[0].totalEmployees > reports[1].totalEmployees ? 'up' as const : 
                           reports.length > 1 && reports[0].totalEmployees < reports[1].totalEmployees ? 'down' as const : 'flat' as const;
      
      return {
        totalEmployees,
        activeEmployees,
        averageShiftsPerEmployee,
        averageHoursPerEmployee,
        topPerformers,
        employeeTrend,
        employeesByFacility: reports[0]?.employeesByFacility || []
      };
    },
    enabled: !!user?.id,
    staleTime: 30000,
  });

  // Export-Mutationen
  const exportTimeAccountMutation = useMutation({
    mutationFn: async (format: 'pdf' | 'excel') => {
      if (!user?.id) {
        throw new Error('Benutzer nicht authentifiziert');
      }
      const reportId = await reportService.generateReport({
        type: 'timesheet',
        period: 'current-month',
        format,
        userId: user.id,
      });
      return format === 'pdf'
        ? reportService.exportTimeAccountReportPDF({ reportId }, filters)
        : reportService.exportTimeAccountReportExcel({ reportId }, filters);
    },
    onSuccess: () => {
      toast.success('Zeitkonten-Bericht exportiert');
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error('Export fehlgeschlagen: ' + msg);
    },
  });

  const exportEmployeeMutation = useMutation({
    mutationFn: async (format: 'pdf' | 'excel') => {
      if (!user?.id) {
        throw new Error('Benutzer nicht authentifiziert');
      }
      const reportId = await reportService.generateReport({
        type: 'summary',
        period: 'current-month',
        format,
        userId: user.id,
      });
      return reportService.exportReport(reportId, format);
    },
    onSuccess: () => {
      toast.success('Mitarbeiter-Statistiken exportiert');
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error('Export fehlgeschlagen: ' + msg);
    },
  });

  const exportAllMutation = useMutation({
    mutationFn: async (format: 'pdf' | 'excel') => {
      if (!user?.id) {
        throw new Error('Benutzer nicht authentifiziert');
      }
      const reportId = await reportService.generateReport({
        type: 'summary',
        period: 'current-month',
        format,
        userId: user.id,
      });
      return format === 'pdf'
        ? reportService.exportAllReportsPDF({ reportId }, filters)
        : reportService.exportAllReportsExcel({ reportId }, filters);
    },
    onSuccess: () => {
      toast.success('Alle Berichte exportiert');
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error('Export fehlgeschlagen: ' + msg);
    },
  });

  // Helper-Funktionen
  const formatDate = (date: Date | string) => {
    const d = new Date(date);
    return d.toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  const formatTime = (date: Date | string) => {
    const d = new Date(date);
    return d.toLocaleTimeString('de-DE', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatDateTime = (date: Date | string) => {
    const d = new Date(date);
    return d.toLocaleString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatWeek = (week: number) => {
    return `KW ${week}`;
  };

  const formatMonth = (month: number) => {
    const months = [
      'Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun',
      'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'
    ];
    return months[month - 1] || `Monat ${month}`;
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('de-DE', {
      style: 'currency',
      currency: 'EUR',
    }).format(amount);
  };

  const formatHours = (hours: number) => {
    return `${hours.toFixed(1)}h`;
  };

  const formatPercentage = (value: number, total: number) => {
    if (total === 0) return '0%';
    return `${((value / total) * 100).toFixed(1)}%`;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'success';
      case 'inactive':
        return 'error';
      case 'pending':
        return 'warning';
      default:
        return 'default';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'active':
        return 'Aktiv';
      case 'inactive':
        return 'Inaktiv';
      case 'pending':
        return 'Ausstehend';
      default:
        return 'Unbekannt';
    }
  };

  const getTrendIcon = (trend: 'up' | 'down' | 'flat') => {
    switch (trend) {
      case 'up':
        return '📈';
      case 'down':
        return '📉';
      case 'flat':
        return '➡️';
      default:
        return '➡️';
    }
  };

  const getTrendText = (trend: 'up' | 'down' | 'flat') => {
    switch (trend) {
      case 'up':
        return 'Steigend';
      case 'down':
        return 'Fallend';
      case 'flat':
        return 'Konstant';
      default:
        return 'Unbekannt';
    }
  };

  // Export-Funktionen (fire-and-forget mit Toast)
  const exportTimeAccountReport = (format: 'pdf' | 'excel') => {
    exportTimeAccountMutation.mutate(format);
  };

  const exportEmployeeStatistics = (format: 'pdf' | 'excel') => {
    exportEmployeeMutation.mutate(format);
  };

  const exportAllReports = (format: 'pdf' | 'excel') => {
    exportAllMutation.mutate(format);
  };

  // Async-Export (gibt URL zurück, z. B. für Dialog mit Download-Link)
  const exportTimeAccountReportAsync = (format: 'pdf' | 'excel') =>
    exportTimeAccountMutation.mutateAsync(format);
  const exportEmployeeStatisticsAsync = (format: 'pdf' | 'excel') =>
    exportEmployeeMutation.mutateAsync(format);
  const exportAllReportsAsync = (format: 'pdf' | 'excel') =>
    exportAllMutation.mutateAsync(format);

  const refetch = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-reports'] });
  };

  return {
    // Data
    timeAccountReport,
    employeeStatistics,
    
    // Loading states
    isLoading: isLoadingTime || isLoadingEmployee,
    isExporting:
      exportTimeAccountMutation.isPending ||
      exportEmployeeMutation.isPending ||
      exportAllMutation.isPending,
    
    // Error
    error: errorTime || errorEmployee,
    
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
    
// Export functions
    exportTimeAccountReport,
    exportEmployeeStatistics,
    exportAllReports,
    exportTimeAccountReportAsync,
    exportEmployeeStatisticsAsync,
    exportAllReportsAsync,

    // Actions
    refetch,
  };
};
