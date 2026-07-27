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
    exportTimes: vi.fn(async () => 'https://storage/export.csv'),
    getStats: (...a: unknown[]) => getStats(...a),
    getCurrentStatus: (...a: unknown[]) => getCurrentStatus(...a),
    getTodayWorkTime: (...a: unknown[]) => getTodayWorkTime(...a),
  },
}));

const generateTimeAccountReport = vi.fn();
const generateEmployeeStatistics = vi.fn();
vi.mock('@/lib/services/reports', () => ({
  reportService: {
    generateTimeAccountReport: (...a: unknown[]) => generateTimeAccountReport(...a),
    generateEmployeeStatistics: (...a: unknown[]) => generateEmployeeStatistics(...a),
    generateReport: vi.fn(async () => 'r1'),
    exportTimeAccountReport: vi.fn(async () => 'url'),
    exportEmployeeStatistics: vi.fn(async () => 'url'),
    exportAllReports: vi.fn(async () => 'url'),
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
});
