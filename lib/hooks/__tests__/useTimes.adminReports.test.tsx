import React, { type ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Stempeluhr-Hook (Ein-/Ausstempeln, Pausen, Krankmeldung) und der
 * Admin-Berichts-Hook (Zeitkonten, Mitarbeiterstatistik).
 */

const mockUser = { id: 'u1', companyId: 'firmaA', role: 'nurse' };
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));

const getAllTimes = vi.fn();
const startShift = vi.fn();
const endShift = vi.fn();
const addBreak = vi.fn();
const endBreak = vi.fn();
const reportSick = vi.fn();
const getStats = vi.fn();
const getCurrentStatus = vi.fn();
const getTodayWorkTime = vi.fn();

vi.mock('@/lib/services/times', () => ({
  timesService: {
    getAll: (...a: unknown[]) => getAllTimes(...a),
    getByUserId: (...a: unknown[]) => getAllTimes(...a),
    startShift: (...a: unknown[]) => startShift(...a),
    endShift: (...a: unknown[]) => endShift(...a),
    addBreak: (...a: unknown[]) => addBreak(...a),
    endBreak: (...a: unknown[]) => endBreak(...a),
    reportSick: (...a: unknown[]) => reportSick(...a),
    exportTimes: vi.fn(async () => ({ art: 'url', wert: 'https://storage/export.pdf' })),
    getStats: (...a: unknown[]) => getStats(...a),
    getCurrentStatus: (...a: unknown[]) => getCurrentStatus(...a),
    getTodayWorkTime: (...a: unknown[]) => getTodayWorkTime(...a),
  },
}));

const generateTimeAccountReport = vi.fn();
const generateEmployeeStatistics = vi.fn();
const generateReport = vi.fn();
const exportTimeAccountReportPDF = vi.fn();
const exportTimeAccountReportExcel = vi.fn();
const exportReport = vi.fn();
const exportAllReportsPDF = vi.fn();
const exportAllReportsExcel = vi.fn();
vi.mock('@/lib/services/reports', () => ({
  reportService: {
    generateTimeAccountReport: (...a: unknown[]) => generateTimeAccountReport(...a),
    generateEmployeeStatistics: (...a: unknown[]) => generateEmployeeStatistics(...a),
    generateReport: (...a: unknown[]) => generateReport(...a),
    exportTimeAccountReportPDF: (...a: unknown[]) => exportTimeAccountReportPDF(...a),
    exportTimeAccountReportExcel: (...a: unknown[]) => exportTimeAccountReportExcel(...a),
    exportReport: (...a: unknown[]) => exportReport(...a),
    exportAllReportsPDF: (...a: unknown[]) => exportAllReportsPDF(...a),
    exportAllReportsExcel: (...a: unknown[]) => exportAllReportsExcel(...a),
  },
}));

vi.mock('@/lib/utils/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { useTimes } from '../useTimes';
import { useAdminReports } from '../useAdminReports';

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) =>
  React.createElement(QueryClientProvider, { client }, children);

const zeitEintrag = (overrides: Record<string, unknown> = {}) => ({
  id: 'z1',
  userId: 'u1',
  assignmentId: 'a1',
  date: new Date(2026, 6, 20),
  type: 'work',
  startTime: '06:00',
  endTime: '14:00',
  hours: 7.5,
  balance: -0.5,
  status: 'completed',
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  getAllTimes.mockResolvedValue([]);
  generateReport.mockResolvedValue('r1');
  exportTimeAccountReportPDF.mockResolvedValue('url-pdf');
  exportTimeAccountReportExcel.mockResolvedValue('url-xlsx');
  exportReport.mockResolvedValue('url-report');
  exportAllReportsPDF.mockResolvedValue('url-alle-pdf');
  exportAllReportsExcel.mockResolvedValue('url-alle-xlsx');
  generateTimeAccountReport.mockResolvedValue([
    {
      totalHours: 160,
      regularHours: 150,
      overtimeHours: 10,
      nightHours: 20,
      weekendHours: 16,
      holidayHours: 0,
      averageHoursPerDay: 8,
      averageHoursPerWeek: 40,
      workingDays: 20,
      trend: 'flat',
      hoursByDay: [],
      employees: [],
    },
  ]);
  generateEmployeeStatistics.mockResolvedValue([
    {
      totalEmployees: 12,
      activeEmployees: 10,
      averageShiftsPerEmployee: 8,
      averageHoursPerEmployee: 120,
      topPerformers: 2,
      employeeTrend: 'up',
      employeesByFacility: [],
    },
  ]);
});

describe('useTimes', () => {
  it('lädt die Zeiteinträge des Mitarbeiters', async () => {
    getAllTimes.mockResolvedValue([zeitEintrag(), zeitEintrag({ id: 'z2', type: 'break', hours: 0.5 })]);
    const { result } = renderHook(() => useTimes(), { wrapper });
    await waitFor(() => expect(result.current.times).toHaveLength(2));
  });

  it('stempelt eine Schicht ein', async () => {
    startShift.mockResolvedValue('z-neu');
    const { result } = renderHook(() => useTimes(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.startShift();
    });
    expect(startShift).toHaveBeenCalled();
  });

  it('stempelt eine Schicht aus', async () => {
    endShift.mockResolvedValue(undefined);
    const { result } = renderHook(() => useTimes(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.endShift();
    });
    expect(endShift).toHaveBeenCalled();
  });

  it('startet und beendet eine Pause', async () => {
    addBreak.mockResolvedValue('b1');
    endBreak.mockResolvedValue(undefined);
    const { result } = renderHook(() => useTimes(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.addBreak({ reason: 'Mittag', duration: 30 } as never);
    });
    expect(addBreak).toHaveBeenCalled();

    await act(async () => {
      await result.current.endBreak();
    });
    expect(endBreak).toHaveBeenCalled();
  });

  it('meldet eine Krankheit', async () => {
    reportSick.mockResolvedValue('k1');
    const { result } = renderHook(() => useTimes(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.reportSick({
        startDate: new Date(2026, 6, 20),
        endDate: new Date(2026, 6, 22),
        reason: 'Grippe',
      } as never);
    });
    expect(reportSick).toHaveBeenCalled();
  });

  it('berechnet die Zeitstatistik aus den Einträgen', async () => {
    getAllTimes.mockResolvedValue([
      zeitEintrag({ id: 'z1', type: 'work', hours: 8, balance: 0 }),
      zeitEintrag({ id: 'z2', type: 'work', hours: 7.5, balance: -0.5 }),
      zeitEintrag({ id: 'z3', type: 'sick', hours: 8, balance: 0 }),
    ]);
    const { result } = renderHook(() => useTimes(), { wrapper });
    await waitFor(() => expect(result.current.times).toHaveLength(3));

    const stats = result.current.getTimeStats();
    expect(stats.workHours).toBeCloseTo(15.5);
    expect(stats.sickHours).toBe(8);
    expect(stats.timeEntries).toHaveLength(3);
  });

  it('meldet einen Fehler beim Einstempeln als Toast statt Absturz', async () => {
    startShift.mockRejectedValue(new Error('Kein Einsatz für heute'));
    const { result } = renderHook(() => useTimes(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.startShift().catch(() => undefined);
    });
    const { toast } = await import('@/lib/utils/toast');
    expect(vi.mocked(toast.error)).toHaveBeenCalled();
  });
});

describe('useAdminReports', () => {
  it('lädt Zeitkonto und Mitarbeiterstatistik', async () => {
    const { result } = renderHook(() => useAdminReports(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.timeAccountReport).toMatchObject({ totalHours: 160, overtimeHours: 10 });
    expect(result.current.employeeStatistics).toMatchObject({ totalEmployees: 12 });
  });

  it('meldet einen Ladefehler', async () => {
    generateTimeAccountReport.mockRejectedValue(new Error('kein Zugriff'));
    const { result } = renderHook(() => useAdminReports(), { wrapper });
    await waitFor(() => expect(result.current.error).toBeTruthy());
  });

  it('formatiert Datumsangaben deutsch', async () => {
    const { result } = renderHook(() => useAdminReports(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.formatDate(new Date(2026, 6, 20))).toContain('2026');
    expect(typeof result.current.formatMonth('2026-07')).toBe('string');
  });

  it('liefert Nullwerte, wenn keine Berichte vorliegen', async () => {
    generateTimeAccountReport.mockResolvedValue([]);
    generateEmployeeStatistics.mockResolvedValue([]);
    const { result } = renderHook(() => useAdminReports(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.timeAccountReport).toMatchObject({
      totalHours: 0,
      trend: 'flat',
      employees: [],
    });
    expect(result.current.employeeStatistics).toMatchObject({ totalEmployees: 0 });
  });

  it('aggregiert mehrere Berichte und erkennt den Trend', async () => {
    const bericht = (totalHours: number, workingDays: number) => ({
      totalHours,
      regularHours: totalHours,
      overtimeHours: 0,
      nightHours: 0,
      weekendHours: 0,
      holidayHours: 0,
      averageHoursPerDay: 0,
      averageHoursPerWeek: 0,
      workingDays,
      trend: 'flat',
      hoursByDay: [],
      employees: [
        { userId: 'u1', userName: 'Anna', totalHours, regularHours: totalHours, overtimeHours: 0 },
      ],
    });
    generateTimeAccountReport.mockResolvedValue([bericht(100, 10), bericht(60, 10)]);
    generateEmployeeStatistics.mockResolvedValue([
      {
        totalEmployees: 10,
        activeEmployees: 8,
        averageShiftsPerEmployee: 5,
        averageHoursPerEmployee: 100,
        topPerformers: 2,
        employeeTrend: 'flat',
        employeesByFacility: [],
      },
      {
        totalEmployees: 12,
        activeEmployees: 9,
        averageShiftsPerEmployee: 6,
        averageHoursPerEmployee: 90,
        topPerformers: 1,
        employeeTrend: 'flat',
        employeesByFacility: [],
      },
    ]);

    const { result } = renderHook(() => useAdminReports(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.timeAccountReport).toMatchObject({
      totalHours: 160,
      workingDays: 20,
      averageHoursPerDay: 8,
      trend: 'up', // aktueller Zeitraum (100h) über dem vorherigen (60h)
    });
    expect(result.current.timeAccountReport?.employees).toHaveLength(1);
    expect(result.current.employeeStatistics).toMatchObject({
      totalEmployees: 22,
      activeEmployees: 17,
      topPerformers: 3,
      employeeTrend: 'down', // 10 aktuelle < 12 vorherige
    });
  });

  it('exportiert Zeitkonto als PDF und Excel', async () => {
    const { result } = renderHook(() => useAdminReports(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.exportTimeAccountReportAsync('pdf');
      await result.current.exportTimeAccountReportAsync('excel');
    });
    expect(exportTimeAccountReportPDF).toHaveBeenCalled();
    expect(exportTimeAccountReportExcel).toHaveBeenCalled();
    expect(generateReport).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'timesheet', userId: 'u1' })
    );
  });

  it('exportiert Mitarbeiterstatistik und Gesamtberichte', async () => {
    const { result } = renderHook(() => useAdminReports(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.exportEmployeeStatisticsAsync('excel');
      await result.current.exportAllReportsAsync('pdf');
      await result.current.exportAllReportsAsync('excel');
    });
    expect(exportReport).toHaveBeenCalledWith('r1', 'excel');
    expect(exportAllReportsPDF).toHaveBeenCalled();
    expect(exportAllReportsExcel).toHaveBeenCalled();
  });

  it('meldet Exportfehler über den Toast', async () => {
    exportTimeAccountReportPDF.mockRejectedValue(new Error('kein Speicher'));
    const { result } = renderHook(() => useAdminReports(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await expect(
      act(async () => {
        await result.current.exportTimeAccountReportAsync('pdf');
      })
    ).rejects.toThrow('kein Speicher');
    const { toast } = await import('@/lib/utils/toast');
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalled());
  });

  it('stellt alle Format-Helfer bereit', async () => {
    const { result } = renderHook(() => useAdminReports(), { wrapper });

    expect(result.current.formatTime(new Date(2026, 6, 20, 14, 5))).toContain('14');
    expect(result.current.formatDateTime(new Date(2026, 6, 20, 14, 5))).toContain('2026');
    expect(result.current.formatWeek(31)).toBe('KW 31');
    expect(result.current.formatMonth(7)).toBe('Jul');
    expect(result.current.formatMonth(99)).toBe('Monat 99');
    expect(result.current.formatCurrency(12.5)).toContain('12,50');
    expect(result.current.formatHours(7.25)).toBe('7.3h');
    expect(result.current.formatPercentage(1, 4)).toBe('25.0%');
    expect(result.current.formatPercentage(1, 0)).toBe('0%');
    expect(result.current.getStatusColor('active')).toBe('success');
    expect(result.current.getStatusColor('inactive')).toBe('error');
    expect(result.current.getStatusColor('pending')).toBe('warning');
    expect(result.current.getStatusColor('x')).toBe('default');
    expect(result.current.getStatusLabel('active')).toBe('Aktiv');
    expect(result.current.getStatusLabel('x')).toBe('Unbekannt');
    expect(result.current.getTrendIcon('up')).toBe('📈');
    expect(result.current.getTrendIcon('down')).toBe('📉');
    expect(result.current.getTrendText('up')).toBe('Steigend');
    expect(result.current.getTrendText('flat')).toBe('Konstant');
  });

  it('stößt das Neuladen der Berichte an', async () => {
    const { result } = renderHook(() => useAdminReports(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(() => result.current.refetch()).not.toThrow();
  });
});
