import { useQuery } from '@tanstack/react-query';
import type { Timesheet } from '@/lib/services/timesheets';

// Echte Services verwenden - keine Mocks mehr
import { timesheetService } from '@/lib/services/timesheets';
import { useAuth as useAuthReal } from '@/contexts/AuthContext';
const useAuth = useAuthReal;

export interface TimesheetHistoryFilters {
  startDate?: Date;
  endDate?: Date;
  month?: number;
  year?: number;
  status?: string;
}

type ExtendedTimesheetFields = {
  regularHours?: number;
  overtimeHours?: number;
};

const getTimesheetNumericField = (
  timesheet: Timesheet,
  key: keyof ExtendedTimesheetFields
): number => {
  const value = (timesheet as ExtendedTimesheetFields)[key];
  return typeof value === 'number' ? value : 0;
};

/**
 * Robuste Datumsermittlung eines Nachweises.
 *
 * Vorher wurde direkt `new Date(timesheet.startDate).toISOString()` aufgerufen.
 * Fehlt startDate (z. B. bei einem optimistisch eingefügten oder offline
 * erfassten Eintrag), ist das Ergebnis "Invalid Date" und toISOString() wirft
 * einen RangeError – die komplette Verlaufsseite bleibt dann leer.
 */
function nachweisDatum(timesheet: { startDate?: Date | string; date?: Date | string }): Date {
  const kandidaten = [timesheet.startDate, timesheet.date];
  for (const kandidat of kandidaten) {
    if (!kandidat) continue;
    const d = kandidat instanceof Date ? kandidat : new Date(kandidat);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date(0);
}

export const useTimesheetHistory = (filters: TimesheetHistoryFilters = {}) => {
  const { user } = useAuth();

  // Timesheets abrufen
  const {
    data: timesheets = [],
    isLoading,
    error,
    refetch
  } = useQuery<Timesheet[]>({
    queryKey: ['timesheetHistory', user?.id, filters],
    queryFn: () => {
      if (!user?.id) return Promise.resolve([]);
      return timesheetService.getByUserId(user.id);
    },
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Statistiken berechnen
  const getStatistics = () => {
    if (!timesheets.length) {
      return {
        totalHours: 0,
        averageHoursPerDay: 0,
        totalDays: 0,
        regularHours: 0,
        overtimeHours: 0,
        nightHours: 0,
        weekendHours: 0,
        holidayHours: 0,
        averageHoursPerWeek: 0,
        workingDays: 0,
        trend: 'stable' as 'up' | 'down' | 'stable',
      };
    }

    const totalHours = timesheets.reduce((sum, ts) => sum + (ts.totalHours || 0), 0);
    const regularHours = timesheets.reduce((sum, ts) => sum + getTimesheetNumericField(ts, 'regularHours'), 0);
    const overtimeHours = timesheets.reduce((sum, ts) => sum + getTimesheetNumericField(ts, 'overtimeHours'), 0);
    const nightHours = timesheets.reduce((sum, ts) => sum + (ts.nightHours || 0), 0);
    const weekendHours = timesheets.reduce((sum, ts) => sum + (ts.weekendHours || 0), 0);
    const holidayHours = timesheets.reduce((sum, ts) => sum + (ts.holidayHours || 0), 0);

    // Eindeutige Arbeitstage
    const uniqueDays = new Set(timesheets.map(ts => nachweisDatum(ts).toDateString())).size;
    const workingDays = uniqueDays;
    const totalDays = timesheets.length;

    const averageHoursPerDay = workingDays > 0 ? totalHours / workingDays : 0;
    const averageHoursPerWeek = workingDays > 0 ? (totalHours / workingDays) * 7 : 0;

    // Trend berechnen (Vergleich der letzten 2 Wochen)
    const now = new Date();
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const firstWeekHours = timesheets
      .filter(ts => {
        const date = nachweisDatum(ts);
        return date >= twoWeeksAgo && date < oneWeekAgo;
      })
      .reduce((sum, ts) => sum + (ts.totalHours || 0), 0);

    const secondWeekHours = timesheets
      .filter(ts => {
        const date = nachweisDatum(ts);
        return date >= oneWeekAgo;
      })
      .reduce((sum, ts) => sum + (ts.totalHours || 0), 0);

    let trend: 'up' | 'down' | 'stable' = 'stable';
    if (secondWeekHours > firstWeekHours * 1.1) trend = 'up';
    else if (secondWeekHours < firstWeekHours * 0.9) trend = 'down';

    return {
      totalHours,
      averageHoursPerDay,
      totalDays,
      regularHours,
      overtimeHours,
      nightHours,
      weekendHours,
      holidayHours,
      averageHoursPerWeek,
      workingDays,
      trend,
    };
  };

  // Timesheets nach Monat gruppieren
  const getTimesheetsByMonth = () => {
    const grouped: { [key: string]: Timesheet[] } = {};
    
    timesheets.forEach(timesheet => {
      const date = nachweisDatum(timesheet);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      
      if (!grouped[monthKey]) {
        grouped[monthKey] = [];
      }
      grouped[monthKey].push(timesheet);
    });

    return grouped;
  };

  // Timesheets nach Woche gruppieren
  const getTimesheetsByWeek = () => {
    const grouped: { [key: string]: Timesheet[] } = {};
    
    timesheets.forEach(timesheet => {
      const date = nachweisDatum(timesheet);
      const weekStart = new Date(date);
      weekStart.setDate(date.getDate() - date.getDay()); // Sonntag
      const weekKey = weekStart.toISOString().split('T')[0];
      
      if (!grouped[weekKey]) {
        grouped[weekKey] = [];
      }
      grouped[weekKey].push(timesheet);
    });

    return grouped;
  };

  // Timesheets nach Tag gruppieren
  const getTimesheetsByDay = () => {
    const grouped: { [key: string]: Timesheet[] } = {};
    
    timesheets.forEach(timesheet => {
      const date = nachweisDatum(timesheet);
      const dayKey = date.toISOString().split('T')[0];
      
      if (!grouped[dayKey]) {
        grouped[dayKey] = [];
      }
      grouped[dayKey].push(timesheet);
    });

    return grouped;
  };

  // Chart-Daten für Stunden pro Tag
  const getChartData = () => {
    const dayData = getTimesheetsByDay();
    const sortedDays = Object.keys(dayData).sort();
    
    return sortedDays.map(day => {
      const dayTimesheets = dayData[day];
      const totalHours = dayTimesheets.reduce((sum, ts) => sum + (ts.totalHours || 0), 0);
      const regularHours = dayTimesheets.reduce((sum, ts) => sum + getTimesheetNumericField(ts, 'regularHours'), 0);
      const overtimeHours = dayTimesheets.reduce((sum, ts) => sum + getTimesheetNumericField(ts, 'overtimeHours'), 0);
      const nightHours = dayTimesheets.reduce((sum, ts) => sum + (ts.nightHours || 0), 0);
      const weekendHours = dayTimesheets.reduce((sum, ts) => sum + (ts.weekendHours || 0), 0);
      
      return {
        date: day,
        totalHours,
        regularHours,
        overtimeHours,
        nightHours,
        weekendHours,
        timesheetCount: dayTimesheets.length,
      };
    });
  };

  // Chart-Daten für Stunden pro Woche
  const getWeeklyChartData = () => {
    const weekData = getTimesheetsByWeek();
    const sortedWeeks = Object.keys(weekData).sort();
    
    return sortedWeeks.map(week => {
      const weekTimesheets = weekData[week];
      const totalHours = weekTimesheets.reduce((sum, ts) => sum + (ts.totalHours || 0), 0);
      const regularHours = weekTimesheets.reduce((sum, ts) => sum + getTimesheetNumericField(ts, 'regularHours'), 0);
      const overtimeHours = weekTimesheets.reduce((sum, ts) => sum + getTimesheetNumericField(ts, 'overtimeHours'), 0);
      const nightHours = weekTimesheets.reduce((sum, ts) => sum + (ts.nightHours || 0), 0);
      const weekendHours = weekTimesheets.reduce((sum, ts) => sum + (ts.weekendHours || 0), 0);
      
      return {
        week,
        totalHours,
        regularHours,
        overtimeHours,
        nightHours,
        weekendHours,
        timesheetCount: weekTimesheets.length,
      };
    });
  };

  // Chart-Daten für Stunden pro Monat
  const getMonthlyChartData = () => {
    const monthData = getTimesheetsByMonth();
    const sortedMonths = Object.keys(monthData).sort();
    
    return sortedMonths.map(month => {
      const monthTimesheets = monthData[month];
      const totalHours = monthTimesheets.reduce((sum, ts) => sum + (ts.totalHours || 0), 0);
      const regularHours = monthTimesheets.reduce((sum, ts) => sum + getTimesheetNumericField(ts, 'regularHours'), 0);
      const overtimeHours = monthTimesheets.reduce((sum, ts) => sum + getTimesheetNumericField(ts, 'overtimeHours'), 0);
      const nightHours = monthTimesheets.reduce((sum, ts) => sum + (ts.nightHours || 0), 0);
      const weekendHours = monthTimesheets.reduce((sum, ts) => sum + (ts.weekendHours || 0), 0);
      
      return {
        month,
        totalHours,
        regularHours,
        overtimeHours,
        nightHours,
        weekendHours,
        timesheetCount: monthTimesheets.length,
      };
    });
  };

  // Format Datum
  const formatDate = (date: Date | string) => {
    const d = new Date(date);
    return d.toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  // Format Zeit
  const formatTime = (date: Date | string) => {
    const d = new Date(date);
    return d.toLocaleTimeString('de-DE', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Format DateTime
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

  // Format Woche
  const formatWeek = (weekStart: string) => {
    const start = new Date(weekStart);
    const end = new Date(start.getTime() + 6 * 24 * 60 * 60 * 1000);
    return `${start.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })} - ${end.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}`;
  };

  // Format Monat
  const formatMonth = (monthKey: string) => {
    const [year, month] = monthKey.split('-');
    const date = new Date(parseInt(year), parseInt(month) - 1);
    return date.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
  };

  // Status-Farben
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'success';
      case 'completed':
        return 'info';
      case 'pending':
        return 'warning';
      case 'cancelled':
        return 'error';
      default:
        return 'default';
    }
  };

  // Status-Labels
  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'active':
        return 'Aktiv';
      case 'completed':
        return 'Abgeschlossen';
      case 'pending':
        return 'Ausstehend';
      case 'cancelled':
        return 'Storniert';
      default:
        return 'Unbekannt';
    }
  };

  // Trend-Icon
  const getTrendIcon = (trend: 'up' | 'down' | 'stable') => {
    switch (trend) {
      case 'up':
        return '📈';
      case 'down':
        return '📉';
      case 'stable':
        return '➡️';
    }
  };

  // Trend-Text
  const getTrendText = (trend: 'up' | 'down' | 'stable') => {
    switch (trend) {
      case 'up':
        return 'Steigend';
      case 'down':
        return 'Fallend';
      case 'stable':
        return 'Stabil';
    }
  };

  return {
    // Data
    timesheets,
    
    // Loading states
    isLoading,
    
    // Error
    error,
    
    // Computed data
    statistics: getStatistics(),
    timesheetsByMonth: getTimesheetsByMonth(),
    timesheetsByWeek: getTimesheetsByWeek(),
    timesheetsByDay: getTimesheetsByDay(),
    chartData: getChartData(),
    weeklyChartData: getWeeklyChartData(),
    monthlyChartData: getMonthlyChartData(),
    
    // Helper functions
    formatDate,
    formatTime,
    formatDateTime,
    formatWeek,
    formatMonth,
    getStatusColor,
    getStatusLabel,
    getTrendIcon,
    getTrendText,
    
    // Actions
    refetch,
  };
};
