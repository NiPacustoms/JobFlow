import React, { type ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Administrations-Einstellungen und die Stundenhistorie des Mitarbeiters.
 */

const mockUser = { id: 'u1', companyId: 'firmaA', role: 'admin' };
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));

const getSettings = vi.fn();
const updateSettings = vi.fn();
const getRoles = vi.fn();
const createRole = vi.fn();
const updateRole = vi.fn();
const deleteRole = vi.fn();
const getDocumentTypes = vi.fn();
const createDocumentType = vi.fn();
const updateDocumentType = vi.fn();
const deleteDocumentType = vi.fn();
const getSystemInfo = vi.fn();
const backupData = vi.fn();
const restoreData = vi.fn();

vi.mock('@/lib/services/adminSettings', () => ({
  adminSettingsService: {
    getSettings: (...a: unknown[]) => getSettings(...a),
    updateSettings: (...a: unknown[]) => updateSettings(...a),
    getRoles: (...a: unknown[]) => getRoles(...a),
    createRole: (...a: unknown[]) => createRole(...a),
    updateRole: (...a: unknown[]) => updateRole(...a),
    deleteRole: (...a: unknown[]) => deleteRole(...a),
    getDocumentTypes: (...a: unknown[]) => getDocumentTypes(...a),
    createDocumentType: (...a: unknown[]) => createDocumentType(...a),
    updateDocumentType: (...a: unknown[]) => updateDocumentType(...a),
    deleteDocumentType: (...a: unknown[]) => deleteDocumentType(...a),
    getSystemInfo: (...a: unknown[]) => getSystemInfo(...a),
    backupData: (...a: unknown[]) => backupData(...a),
    restoreData: (...a: unknown[]) => restoreData(...a),
  },
}));

const getByUserId = vi.fn();
vi.mock('@/lib/services/timesheets', () => ({
  timesheetService: { getByUserId: (...a: unknown[]) => getByUserId(...a) },
}));

vi.mock('@/lib/utils/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('@/contexts/PermissionsContext', () => ({
  usePermissions: () => ({
    canAccessAdminArea: true,
    hasPermission: () => true,
    permissions: [],
  }),
}));

import { useAdminSettings } from '../useAdminSettings';
import { useTimesheetHistory } from '../useTimesheetHistory';

// WICHTIG: Der QueryClient darf NICHT bei jedem Render neu entstehen – sonst
// verliert der Cache bei jedem Re-Render seinen Inhalt und die Abfrage bleibt
// dauerhaft im Ladezustand.
let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) =>
  React.createElement(QueryClientProvider, { client }, children);

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  getSettings.mockResolvedValue({ systemName: 'AufAbruf Planung', sessionTimeout: 60 });
  getRoles.mockResolvedValue([{ id: 'r1', name: 'Disponent', permissions: [] }]);
  getDocumentTypes.mockResolvedValue([{ id: 'd1', name: 'Führungszeugnis' }]);
  getSystemInfo.mockResolvedValue({ status: 'Online', version: '1.0.0' });
  getByUserId.mockResolvedValue([]);
});

describe('useAdminSettings', () => {
  it('lädt Einstellungen, Rollen und Dokumenttypen', async () => {
    const { result } = renderHook(() => useAdminSettings(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.settings).toMatchObject({ systemName: 'AufAbruf Planung' });
    expect(result.current.roles).toHaveLength(1);
    expect(result.current.documentTypes).toHaveLength(1);
  });

  it('liefert Standardeinstellungen, wenn nichts geladen werden konnte', async () => {
    getSettings.mockResolvedValue(null);
    const { result } = renderHook(() => useAdminSettings(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.settings).toMatchObject({ systemName: 'Schichtklar', language: 'de' });
  });

  it('speichert geänderte Einstellungen', async () => {
    updateSettings.mockResolvedValue(undefined);
    const { result } = renderHook(() => useAdminSettings(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.updateSettings({ systemName: 'Neu' } as never);
    });
    expect(updateSettings).toHaveBeenCalledWith({ systemName: 'Neu' });
  });

  it('legt eine Rolle an und löscht sie wieder', async () => {
    createRole.mockResolvedValue('r2');
    deleteRole.mockResolvedValue(undefined);
    const { result } = renderHook(() => useAdminSettings(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.createRole({ name: 'Neu', permissions: [] } as never);
    });
    expect(createRole).toHaveBeenCalled();

    await act(async () => {
      await result.current.deleteRole('r2');
    });
    expect(deleteRole).toHaveBeenCalledWith('r2');
  });

  it('verwaltet Dokumenttypen', async () => {
    createDocumentType.mockResolvedValue('d2');
    updateDocumentType.mockResolvedValue(undefined);
    deleteDocumentType.mockResolvedValue(undefined);
    const { result } = renderHook(() => useAdminSettings(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.createDocumentType({ name: 'Impfnachweis' } as never);
      await result.current.updateDocumentType('d2', { name: 'Geändert' } as never);
      await result.current.deleteDocumentType('d2');
    });
    expect(createDocumentType).toHaveBeenCalled();
    expect(updateDocumentType).toHaveBeenCalled();
    expect(deleteDocumentType).toHaveBeenCalledWith('d2');
  });

  it('meldet einen Ladefehler', async () => {
    getSettings.mockRejectedValue(new Error('kein Zugriff'));
    const { result } = renderHook(() => useAdminSettings(), { wrapper });
    await waitFor(() => expect(result.current.error).toBeTruthy());
  });
});

describe('useTimesheetHistory', () => {
  const nachweis = (overrides: Record<string, unknown> = {}) => ({
    id: 't1',
    userId: 'u1',
    date: new Date(2026, 6, 20),
    startDate: new Date(2026, 6, 20),
    endDate: new Date(2026, 6, 20),
    startTime: '06:00',
    endTime: '14:00',
    totalHours: 8,
    regularHours: 8,
    overtimeHours: 0,
    nightHours: 0,
    weekendHours: 0,
    status: 'approved',
    ...overrides,
  });

  it('lädt die Nachweise des Mitarbeiters', async () => {
    getByUserId.mockResolvedValue([nachweis(), nachweis({ id: 't2' })]);
    const { result } = renderHook(() => useTimesheetHistory(), { wrapper });
    await waitFor(() => expect(result.current.timesheets).toHaveLength(2));
    expect(getByUserId).toHaveBeenCalledWith('u1');
  });

  it('berechnet die Statistik über alle Nachweise', async () => {
    getByUserId.mockResolvedValue([
      nachweis({ id: 't1', totalHours: 8 }),
      nachweis({ id: 't2', totalHours: 6 }),
    ]);
    const { result } = renderHook(() => useTimesheetHistory(), { wrapper });
    await waitFor(() => expect(result.current.timesheets).toHaveLength(2));
    expect(result.current.statistics.totalHours).toBe(14);
  });

  it('liefert Wochen-Diagrammdaten', async () => {
    getByUserId.mockResolvedValue([
      nachweis({ id: 't1', date: new Date(2026, 6, 20), totalHours: 8 }),
      nachweis({ id: 't2', date: new Date(2026, 6, 21), totalHours: 6 }),
    ]);
    const { result } = renderHook(() => useTimesheetHistory(), { wrapper });
    await waitFor(() => expect(result.current.timesheets).toHaveLength(2));
    expect(Array.isArray(result.current.weeklyChartData)).toBe(true);
    expect(result.current.weeklyChartData[0]).toHaveProperty('totalHours');
  });

  it('liefert Monats-Diagrammdaten', async () => {
    getByUserId.mockResolvedValue([nachweis({ totalHours: 8, overtimeHours: 2 })]);
    const { result } = renderHook(() => useTimesheetHistory(), { wrapper });
    await waitFor(() => expect(result.current.timesheets).toHaveLength(1));
    expect(result.current.monthlyChartData[0]).toHaveProperty('overtimeHours');
  });

  it('übersteht einen Nachweis ohne Datumsangabe', async () => {
    getByUserId.mockResolvedValue([
      { id: 't1', userId: 'u1', totalHours: 8, status: 'approved' },
    ]);
    const { result } = renderHook(() => useTimesheetHistory(), { wrapper });
    await waitFor(() => expect(result.current.timesheets).toHaveLength(1));
    expect(result.current.statistics.totalHours).toBe(8);
  });

  it('gruppiert die Nachweise nach Tag, Woche und Monat', async () => {
    getByUserId.mockResolvedValue([nachweis()]);
    const { result } = renderHook(() => useTimesheetHistory(), { wrapper });
    await waitFor(() => expect(result.current.timesheets).toHaveLength(1));
    expect(Object.keys(result.current.timesheetsByDay).length).toBeGreaterThan(0);
    expect(Object.keys(result.current.timesheetsByWeek).length).toBeGreaterThan(0);
    expect(Object.keys(result.current.timesheetsByMonth).length).toBeGreaterThan(0);
  });

  it('formatiert Datum und Uhrzeit deutsch', async () => {
    const { result } = renderHook(() => useTimesheetHistory(), { wrapper });
    await waitFor(() => expect(result.current.timesheets).toEqual([]));
    expect(result.current.formatDate(new Date(2026, 6, 20))).toContain('2026');
    expect(typeof result.current.formatTime(new Date(2026, 6, 20, 6, 0))).toBe('string');
  });

  it('kommt ohne Nachweise zurecht', async () => {
    getByUserId.mockResolvedValue([]);
    const { result } = renderHook(() => useTimesheetHistory(), { wrapper });
    await waitFor(() => expect(result.current.timesheets).toEqual([]));
    expect(result.current.weeklyChartData).toEqual([]);
    expect(result.current.statistics.totalHours).toBe(0);
  });

  it('liefert Tages-Diagrammdaten mit allen Stundenarten', async () => {
    getByUserId.mockResolvedValue([
      nachweis({ totalHours: 8, regularHours: 6, overtimeHours: 2, nightHours: 4 }),
      nachweis({ id: 't2', totalHours: 6, weekendHours: 6, startDate: new Date(2026, 6, 25) }),
    ]);
    const { result } = renderHook(() => useTimesheetHistory(), { wrapper });
    await waitFor(() => expect(result.current.timesheets).toHaveLength(2));

    const tage = result.current.chartData;
    expect(tage.length).toBeGreaterThanOrEqual(2);
    // aufsteigend nach Datum sortiert
    expect([...tage].sort((a, b) => a.date.localeCompare(b.date))).toEqual(tage);
    const ersterTag = tage[0];
    expect(ersterTag.totalHours).toBe(8);
    expect(ersterTag.overtimeHours).toBe(2);
    expect(ersterTag.nightHours).toBe(4);
  });

  it('liefert Farben und Beschriftungen für alle Status', async () => {
    const { result } = renderHook(() => useTimesheetHistory(), { wrapper });
    await waitFor(() => expect(result.current.timesheets).toEqual([]));

    expect(result.current.getStatusColor('active')).toBe('success');
    expect(result.current.getStatusColor('completed')).toBe('info');
    expect(result.current.getStatusColor('pending')).toBe('warning');
    expect(result.current.getStatusColor('cancelled')).toBe('error');
    expect(result.current.getStatusColor('x')).toBe('default');

    expect(result.current.getStatusLabel('active')).toBe('Aktiv');
    expect(result.current.getStatusLabel('completed')).toBe('Abgeschlossen');
    expect(result.current.getStatusLabel('pending')).toBe('Ausstehend');
    expect(result.current.getStatusLabel('cancelled')).toBe('Storniert');
    expect(result.current.getStatusLabel('x')).toBe('Unbekannt');
  });

  it('liefert Trend-Symbole und -Texte', async () => {
    const { result } = renderHook(() => useTimesheetHistory(), { wrapper });
    await waitFor(() => expect(result.current.timesheets).toEqual([]));

    expect(result.current.getTrendIcon('up')).toBe('📈');
    expect(result.current.getTrendIcon('down')).toBe('📉');
    expect(result.current.getTrendIcon('stable')).toBe('➡️');
    expect(result.current.getTrendText('up')).toBe('Steigend');
    expect(result.current.getTrendText('down')).toBe('Fallend');
    expect(result.current.getTrendText('stable')).toBe('Stabil');
  });

  it('formatiert Woche, Monat und Zeitstempel', async () => {
    const { result } = renderHook(() => useTimesheetHistory(), { wrapper });
    await waitFor(() => expect(result.current.timesheets).toEqual([]));

    expect(typeof result.current.formatWeek('2026-W30')).toBe('string');
    expect(typeof result.current.formatMonth('2026-07')).toBe('string');
    expect(result.current.formatDateTime(new Date(2026, 6, 20, 6, 5))).toContain('2026');
  });

  it('lädt die Nachweise auf Wunsch neu', async () => {
    getByUserId.mockResolvedValue([nachweis()]);
    const { result } = renderHook(() => useTimesheetHistory(), { wrapper });
    await waitFor(() => expect(result.current.timesheets).toHaveLength(1));

    await act(async () => {
      await result.current.refetch();
    });
    expect(getByUserId.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('meldet einen Ladefehler der Nachweise', async () => {
    getByUserId.mockRejectedValue(new Error('kein Zugriff'));
    const { result } = renderHook(() => useTimesheetHistory(), { wrapper });
    await waitFor(() => expect(result.current.error).toBeTruthy());
  });
});
