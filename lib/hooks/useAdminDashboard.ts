import React from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { userService } from '@/lib/services/users';
import { timesheetService } from '@/lib/services/timesheets';
import { assignmentService } from '@/lib/services/assignments';
import { shiftService } from '@/lib/services/shifts';
import { facilityService } from '@/lib/services/facilities';
import { documentService } from '@/lib/services/documents';
import { activityService } from '@/lib/services/activities';
import { useAdminAlerts } from './useAlerts';
import type { DashboardAlert } from '@/components/admin/AlertsPanel';
import type { Alert } from '@/lib/types/alert';
import type { PaginatedResponse, User, Facility } from '@/lib/types';
import type { Shift } from '@/lib/services/shifts';
import type { Assignment } from '@/lib/services/assignments';
import type { Timesheet } from '@/lib/services/timesheets';
import type { Document as Doc } from '@/lib/services/documents';
import type { Activity } from '@/lib/services/activities';
import { ArbZGValidationService } from '@/lib/services/arbzgValidation';
import { logger } from '@/lib/utils/logger';
import { getShiftDisplayStatus } from '@/lib/utils/shiftStatus';

interface TimesheetData {
  totalHours?: number;
  date?: string | Date;
}

interface ActivityWithStatus extends Activity {
  status?: string;
}

export const useAdminDashboard = () => {
  const { user: _user } = useAuth();
  const router = useRouter();
  const { alerts } = useAdminAlerts();

  // Load all users - nur für die eigene Firma (kritisch für KPIs)
  const { data: usersData, isLoading: loadingUsers } = useQuery<PaginatedResponse<User>>({
    queryKey: ['admin', 'users', _user?.companyId],
    queryFn: async () => {
      try {
        return await userService.getAll(1, 100, { companyId: _user?.companyId });
      } catch (error) {
        logger.error('Error loading users:', error);
        return { data: [], total: 0, page: 1, limit: 100, hasMore: false };
      }
    },
    enabled: !!_user?.companyId,
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  // Load timesheets - nachgeladen (nicht blockierend für erste Anzeige)
  const { data: timesheetsData } = useQuery<Timesheet[]>({
    queryKey: ['admin', 'timesheets', _user?.companyId],
    queryFn: async () => {
      try {
        return await timesheetService.getAll(_user?.companyId);
      } catch (error) {
        logger.error('Error loading timesheets:', error);
        return [];
      }
    },
    enabled: !!_user?.companyId,
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  // Load assignments (kritisch für KPIs)
  const { data: assignmentsData, isLoading: loadingAssignments } = useQuery<PaginatedResponse<Assignment>>({
    queryKey: ['admin', 'assignments'],
    queryFn: async () => {
      try {
        return await assignmentService.getAll();
      } catch (error) {
        logger.error('Error loading assignments:', error);
        return { data: [], total: 0, page: 1, limit: 50, hasMore: false };
      }
    },
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  // Load shifts - nur für die eigene Firma (kritisch für KPIs)
  const { data: shiftsData, isLoading: loadingShifts } = useQuery<Shift[]>({
    queryKey: ['admin', 'shifts', _user?.companyId],
    queryFn: async () => {
      try {
        const shifts = await shiftService.getAll({ companyId: _user?.companyId });
        return shifts;
      } catch (error) {
        logger.error('Error loading shifts:', error);
        return [];
      }
    },
    enabled: !!_user?.companyId,
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  // Load facilities - nur für die eigene Firma (kritisch für KPIs)
  const { data: facilitiesData, isLoading: loadingFacilities } = useQuery<Facility[]>({
    queryKey: ['admin', 'facilities', _user?.companyId],
    queryFn: async () => {
      try {
        return await facilityService.getAll(_user?.companyId);
      } catch (error) {
        logger.error('Error loading facilities:', error);
        return [];
      }
    },
    enabled: !!_user?.companyId,
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  // Load documents - nachgeladen (nicht blockierend)
  const { data: documentsData } = useQuery<Doc[]>({
    queryKey: ['admin', 'documents'],
    queryFn: async () => {
      try {
        return await documentService.getAll();
      } catch (error) {
        logger.error('Error loading documents:', error);
        return [];
      }
    },
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  // Load recent activities - nachgeladen (nicht blockierend)
  const { data: activitiesData } = useQuery<Activity[]>({
    queryKey: ['admin', 'activities', _user?.companyId],
    queryFn: async () => {
      try {
        return await activityService.getRecent(50, _user?.companyId);
      } catch (error) {
        logger.error('Error loading activities:', error);
        return [];
      }
    },
    enabled: !!_user?.companyId,
    staleTime: 2 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  const allUsers = React.useMemo(() => usersData?.data ?? [], [usersData]);

  const weeklyTimesheets = React.useMemo(() => timesheetsData ?? [], [timesheetsData]);
  const allAssignments = React.useMemo(() => assignmentsData?.data ?? [], [assignmentsData]);
  const allShifts = React.useMemo(() => shiftsData ?? [], [shiftsData]);
  const allFacilities = React.useMemo(() => facilitiesData ?? [], [facilitiesData]);
  const allDocuments = React.useMemo(() => documentsData ?? [], [documentsData]);
  const allActivities = React.useMemo(() => activitiesData ?? [], [activitiesData]);

  // Calculate real KPIs from loaded data
  const kpis = React.useMemo(() => ({
    totalStaff: allUsers.length,
    activeStaff: allUsers.filter(u => u.active).length,
    openShifts: allShifts.filter(s => getShiftDisplayStatus(s) === 'open').length,
    utilization: (() => {
      const active = allShifts.filter(s => getShiftDisplayStatus(s) !== 'ended');
      return active.length > 0
        ? Math.round((active.filter(s => getShiftDisplayStatus(s) === 'filled').length / active.length) * 100)
        : 0;
    })(),
    facilities: allFacilities.length,
    totalHours: weeklyTimesheets.reduce((sum: number, ts: TimesheetData) => sum + (ts.totalHours || 0), 0),
    pendingAssignments: allAssignments.filter(a => a.status === 'pending').length,
    expiringDocuments: allDocuments.filter(d => d.status === 'expiring').length,
    /** Anzahl Mitarbeiter mit Wochenlimit überschritten (blocked) */
    weeklyLimitBlocked: allUsers.filter(u => u.limitStatus === 'blocked').length,
    /** Anzahl Mitarbeiter mit Wochenlimit-Warnung (≥90 %) */
    weeklyLimitWarning: allUsers.filter(u => u.limitStatus === 'warning').length,
    // Trends: optional V2 aus Vorwoche vs. diese Woche
    staffGrowth: { value: 0, isPositive: true },
    shiftTrend: { value: 0, isPositive: false },
    utilizationTrend: { value: 0, isPositive: true },
    facilityTrend: { value: 0, isPositive: true },
  }), [allUsers, allAssignments, allShifts, allFacilities, weeklyTimesheets, allDocuments]);

  // Calculate statistics
  const getUserStatsByRole = () => {
    const stats: Record<string, number> = {};
    allUsers.forEach(user => {
      stats[user.role] = (stats[user.role] || 0) + 1;
    });
    return stats;
  };

  const getAssignmentStatsByStatus = () => {
    const stats: Record<string, number> = {};
    allAssignments.forEach(assignment => {
      stats[assignment.status] = (stats[assignment.status] || 0) + 1;
    });
    return stats;
  };

  const getShiftStatsByType = () => {
    const stats: Record<string, number> = {};
    allShifts.forEach(shift => {
      const type = shift.type || 'unknown';
      stats[type] = (stats[type] || 0) + 1;
    });
    return stats;
  };

  const getRecentActivities = () => {
    return allActivities.map(activity => ({
      type: activity.type,
      message: activity.description || activity.type,
      timestamp: activity.timestamp,
      status: (activity as ActivityWithStatus).status || 'pending'
    }));
  };

  // Calculate weekly hours chart data
  const getWeeklyHours = React.useCallback(() => {
    const days = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
    return days.map((name, index) => {
      const dayTimesheets = weeklyTimesheets.filter((ts: TimesheetData) => {
        const date = new Date(ts.date || '');
        return date.getDay() === ((index + 1) % 7); // Adjust for Monday start
      });
      const hours = dayTimesheets.reduce((sum: number, ts: TimesheetData) => sum + (ts.totalHours || 0), 0);
      return {
        name,
        hours: Math.round(hours * 10) / 10,
        target: index < 5 ? 8 : 6, // Weekdays 8h, weekends 6h
      };
    });
  }, [weeklyTimesheets]);

  // Monthly hours derived from weeklyTimesheets grouped by week number
  const getMonthlyHours = React.useCallback(() => {
    const weeks: Record<string, number> = {};
    weeklyTimesheets.forEach((ts: TimesheetData) => {
      if (!ts.date) return;
      const d = new Date(ts.date);
      const weekKey = `${d.getFullYear()}-W${Math.ceil((((d.getTime() - new Date(d.getFullYear(),0,1).getTime())/86400000) + new Date(d.getFullYear(),0,1).getDay()+1)/7)}`;
      weeks[weekKey] = (weeks[weekKey] || 0) + (ts.totalHours || 0);
    });
    const entries = Object.entries(weeks).slice(-4);
    return entries.map(([weekKey, hours]) => ({
      name: weekKey,
      hours: Math.round(hours * 10) / 10,
      target: 40
    }));
  }, [weeklyTimesheets]);

  // Calculate staff activity (nur Aktiv/Verfügbar)
  const getStaffActivity = React.useCallback(() => {
    const activeUsers = allUsers.filter(u => u.active);
    const onDuty = activeUsers.filter(u => u.currentStatus === 'active').length;
    const available = activeUsers.filter(u => u.currentStatus !== 'active').length;

    return [
      { name: 'Im Dienst', value: onDuty, color: '#4caf50' },
      { name: 'Verfügbar', value: available, color: '#2196f3' },
    ];
  }, [allUsers]);

  // Calculate shift completion (nur aktive Schichten, keine beendeten)
  const getShiftCompletion = React.useCallback(() => {
    const activeShifts = allShifts.filter(s => getShiftDisplayStatus(s) !== 'ended');
    const filled = activeShifts.filter(s => getShiftDisplayStatus(s) === 'filled').length;
    const open = activeShifts.filter(s => getShiftDisplayStatus(s) === 'open').length;
    const total = filled + open;

    return [
      { 
        name: 'Besetzt', 
        value: total > 0 ? Math.round((filled / total) * 100) : 0, 
        color: '#4caf50' 
      },
      { 
        name: 'Offen', 
        value: total > 0 ? Math.round((open / total) * 100) : 0, 
        color: '#f44336' 
      },
    ];
  }, [allShifts]);

  // Action functions
  const createShift = async () => {
    router.push('/admin/schichten?create=true');
  };

  const addStaff = async () => {
    router.push('/admin/mitarbeiter');
  };

  const exportReport = async () => {
    router.push('/admin/berichte');
  };

  const openSettings = () => {
    router.push('/admin/einstellungen');
  };

  // Nur kritische Daten blockieren die erste Anzeige (KPIs); Rest lädt im Hintergrund nach
  const isLoading =
    loadingUsers ||
    loadingAssignments ||
    loadingShifts ||
    loadingFacilities;

  const memoWeeklyHours = React.useMemo(() => getWeeklyHours(), [getWeeklyHours]);
  const memoMonthlyHours = React.useMemo(() => getMonthlyHours(), [getMonthlyHours]);
  const memoShiftCompletion = React.useMemo(() => getShiftCompletion(), [getShiftCompletion]);
  const memoStaffActivity = React.useMemo(() => getStaffActivity(), [getStaffActivity]);

  // Map generic alerts to DashboardAlert shape expected by AlertsPanel
  const mapSeverity = (sev?: string): 'error' | 'warning' | 'info' => {
    switch (sev) {
      case 'critical':
      case 'high':
        return 'error';
      case 'medium':
        return 'warning';
      case 'low':
      default:
        return 'info';
    }
  };

  const createFallbackId = React.useCallback(() => {
    const webCrypto = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
    if (webCrypto && typeof webCrypto.randomUUID === 'function') {
      return webCrypto.randomUUID();
    }
    return Math.random().toString(36).slice(2);
  }, []);

  // ArbZG-Compliance-Prüfung für Timesheets (pro User!)
  const arbzgAlerts = React.useMemo(() => {
    if (!timesheetsData || timesheetsData.length === 0) return [];
    
    const validationService = new ArbZGValidationService();
    const alerts: DashboardAlert[] = [];
    
    // WICHTIG: Gruppiere Timesheets nach userId, da ArbZG-Prüfungen pro Mitarbeiter erfolgen müssen
    const timesheetsByUser = new Map<string, Timesheet[]>();
    timesheetsData.forEach((ts: Timesheet) => {
      if (!timesheetsByUser.has(ts.userId)) {
        timesheetsByUser.set(ts.userId, []);
      }
      timesheetsByUser.get(ts.userId)!.push(ts);
    });
    
    // Prüfe jeden User separat
    timesheetsByUser.forEach((userTimesheets, userId) => {
      // Finde User-Name für bessere Fehlermeldungen
      const user = allUsers.find(u => u.id === userId);
      const userName = user?.displayName || user?.email || userId;
      
      // Filtere nur vollständige Timesheets (mit startTime, endTime und gültigem Datum)
      // Draft-Timesheets ohne endTime werden übersprungen
      const validTimesheets = userTimesheets.filter((ts: Timesheet) => {
        // Prüfe auf vorhandene Felder
        if (!ts.startTime || !ts.endTime || !ts.date) return false;
        
        // Prüfe auf gültiges Datum (kann Date oder string sein)
        const date = ts.date instanceof Date ? ts.date : new Date(ts.date);
        if (isNaN(date.getTime())) return false;
        
        // Prüfe auf gültige Stunden
        if (!Number.isFinite(ts.totalHours) || ts.totalHours <= 0) return false;
        
        // Prüfe auf gültige Zeitangaben (Format: "HH:mm")
        if (typeof ts.startTime !== 'string' || !ts.startTime.includes(':')) return false;
        if (typeof ts.endTime !== 'string' || !ts.endTime.includes(':')) return false;
        
        return true;
      });
      
      if (validTimesheets.length === 0) return; // Keine gültigen Timesheets für diesen User
      
      const timesheetEntries = validTimesheets.map((ts: Timesheet) => ({
        date: ts.date,
        startTime: ts.startTime,
        endTime: ts.endTime,
        totalHours: ts.totalHours || 0,
        breakMinutes: ts.breakMinutes || 0,
      }));
      
      const validation = validationService.validateArbZG(timesheetEntries);
      
      // Erstelle Alerts für kritische Verstöße
      // WICHTIG: Verwende stabile, eindeutige IDs basierend auf den Verstoß-Daten
      // Die ID sollte sich nicht ändern, wenn sich nur der User-Name ändert
      validation.violations.forEach((violation, index) => {
        // Stabile ID: userId + violation type + Datum + severity + index
        // Das Datum als Timestamp macht die ID stabil, auch wenn sich der User-Name ändert
        const dateKey = violation.date ? (violation.date instanceof Date ? violation.date.getTime() : new Date(violation.date).getTime()) : '';
        const violationKey = `${violation.type}-${dateKey}-${index}`;
        const uniqueId = `arbzg-${violation.severity}-${userId}-${violationKey}`;
        
        if (violation.severity === 'error') {
          alerts.push({
            id: uniqueId,
            severity: 'error',
            type: 'arbzg-violation',
            title: `ArbZG-Verstoß: ${violation.type === 'daily' ? 'Tägliche Arbeitszeit' : violation.type === 'weekly' ? 'Wöchentliche Arbeitszeit' : violation.type === 'rest' ? 'Ruhezeit' : 'Pause'} - ${userName}`,
            message: `${violation.message} (Mitarbeiter: ${userName})`,
            actionUrl: `/admin/mitarbeiter/${userId}`,
            createdAt: violation.date || new Date(),
          });
        } else if (violation.severity === 'warning') {
          alerts.push({
            id: uniqueId,
            severity: 'warning',
            type: 'arbzg-violation',
            title: `ArbZG-Warnung: ${violation.type === 'daily' ? 'Tägliche Arbeitszeit' : violation.type === 'weekly' ? 'Wöchentliche Arbeitszeit' : violation.type === 'rest' ? 'Ruhezeit' : 'Pause'} - ${userName}`,
            message: `${violation.message} (Mitarbeiter: ${userName})`,
            actionUrl: `/admin/mitarbeiter/${userId}`,
            createdAt: violation.date || new Date(),
          });
        }
      });
    });
    
    return alerts;
  }, [timesheetsData, allUsers]);

  const dashboardAlerts: DashboardAlert[] = [
    ...(alerts || []).map((alert: Alert) => ({
      id: String(alert?.id ?? createFallbackId()),
      severity: mapSeverity(alert?.severity),
      type: String(alert?.type ?? 'info'),
      title: String(alert?.title ?? alert?.message ?? 'Hinweis'),
      message: String(alert?.message ?? ''),
      actionUrl: String((alert as Partial<Alert> & { actionUrl?: string })?.actionUrl ?? '/admin/berichte'),
      createdAt: alert?.createdAt instanceof Date ? alert.createdAt : new Date(String(alert?.createdAt ?? Date.now())),
    })),
    ...arbzgAlerts,
  ];

  return {
    allUsers,
    weeklyTimesheets,
    allAssignments,
    allShifts,
    allFacilities,
    allDocuments,
    allActivities,
    kpis,
    alerts: dashboardAlerts, // Mapped alerts for AlertsPanel
    staff: allUsers,
    weeklyHours: memoWeeklyHours,
    monthlyHours: memoMonthlyHours,
    shiftCompletion: memoShiftCompletion,
    staffActivity: memoStaffActivity,
    recentActivities: getRecentActivities(),
    getRecentActivities,
    createShift,
    addStaff,
    exportReport,
    openSettings,
    getUserStatsByRole,
    getAssignmentStatsByStatus,
    getShiftStatsByType,
    isLoading,
    error: null,
    pendingWorkTimesheets: [] as Timesheet[],
  };
};
