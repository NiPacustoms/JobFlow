import React, { type ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Admin-Dashboard: KPIs über Mitarbeiter, Schichten, Einsätze und Nachweise.
 */

const mockUser = { id: 'admin1', companyId: 'firmaA', role: 'admin' };
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const getAllUsers = vi.fn();
vi.mock('@/lib/services/users', () => ({
  userService: { getAll: (...a: unknown[]) => getAllUsers(...a) },
}));

const getAllTimesheets = vi.fn();
vi.mock('@/lib/services/timesheets', () => ({
  timesheetService: { getAll: (...a: unknown[]) => getAllTimesheets(...a) },
}));

const getAllAssignments = vi.fn();
vi.mock('@/lib/services/assignments', () => ({
  assignmentService: { getAll: (...a: unknown[]) => getAllAssignments(...a) },
}));

const getAllShifts = vi.fn();
vi.mock('@/lib/services/shifts', () => ({
  shiftService: { getAll: (...a: unknown[]) => getAllShifts(...a) },
}));

const getAllFacilities = vi.fn();
vi.mock('@/lib/services/facilities', () => ({
  facilityService: { getAll: (...a: unknown[]) => getAllFacilities(...a) },
}));

const getAllDocuments = vi.fn();
vi.mock('@/lib/services/documents', () => ({
  documentService: { getAll: (...a: unknown[]) => getAllDocuments(...a) },
}));

const getRecentActivities = vi.fn();
vi.mock('@/lib/services/activities', () => ({
  activityService: { getRecent: (...a: unknown[]) => getRecentActivities(...a) },
}));

vi.mock('../useAlerts', () => ({
  useAdminAlerts: () => ({ alerts: [] }),
  useAlerts: () => ({ alerts: [] }),
}));

vi.mock('@/lib/utils/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { useAdminDashboard } from '../useAdminDashboard';

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) =>
  React.createElement(QueryClientProvider, { client }, children);

const nutzer = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  email: `${id}@aufabruf.eu`,
  displayName: id,
  role: 'nurse',
  active: true,
  companyId: 'firmaA',
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  getAllUsers.mockResolvedValue({ data: [], total: 0, page: 1, limit: 100, hasMore: false });
  getAllTimesheets.mockResolvedValue([]);
  getAllAssignments.mockResolvedValue({ data: [], total: 0, page: 1, limit: 50, hasMore: false });
  getAllShifts.mockResolvedValue([]);
  getAllFacilities.mockResolvedValue([]);
  getAllDocuments.mockResolvedValue([]);
  getRecentActivities.mockResolvedValue([]);
});

describe('useAdminDashboard', () => {
  it('lädt alle Datenquellen der eigenen Firma', async () => {
    getAllUsers.mockResolvedValue({
      data: [nutzer('u1'), nutzer('u2', { role: 'admin' })],
      total: 2,
      page: 1,
      limit: 100,
      hasMore: false,
    });
    const { result } = renderHook(() => useAdminDashboard(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.allUsers).toHaveLength(2);
    expect(getAllUsers).toHaveBeenCalledWith(1, 100, { companyId: 'firmaA' });
    expect(getAllTimesheets).toHaveBeenCalledWith('firmaA');
  });

  it('liefert KPIs', async () => {
    getAllUsers.mockResolvedValue({
      data: [nutzer('u1'), nutzer('u2', { active: false })],
      total: 2,
      page: 1,
      limit: 100,
      hasMore: false,
    });
    const { result } = renderHook(() => useAdminDashboard(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.kpis).toBeTruthy();
  });

  it('gruppiert Nutzer nach Rolle', async () => {
    getAllUsers.mockResolvedValue({
      data: [nutzer('u1'), nutzer('u2'), nutzer('u3', { role: 'admin' })],
      total: 3,
      page: 1,
      limit: 100,
      hasMore: false,
    });
    const { result } = renderHook(() => useAdminDashboard(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const proRolle = result.current.getUserStatsByRole();
    expect(proRolle.nurse ?? proRolle['nurse']).toBe(2);
  });

  it('gruppiert Einsätze nach Status', async () => {
    getAllAssignments.mockResolvedValue({
      data: [
        { id: 'a1', userId: 'u1', shiftId: 's1', status: 'accepted' },
        { id: 'a2', userId: 'u2', shiftId: 's2', status: 'accepted' },
        { id: 'a3', userId: 'u3', shiftId: 's3', status: 'declined' },
      ],
      total: 3,
      page: 1,
      limit: 50,
      hasMore: false,
    });
    const { result } = renderHook(() => useAdminDashboard(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const proStatus = result.current.getAssignmentStatsByStatus();
    expect(proStatus.accepted).toBe(2);
    expect(proStatus.declined).toBe(1);
  });

  it('navigiert über die Schnellaktionen', async () => {
    const { result } = renderHook(() => useAdminDashboard(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    result.current.createShift();
    result.current.addStaff();
    result.current.openSettings();
    expect(push).toHaveBeenCalledTimes(3);
  });

  it('übersteht Fehler der Datenquellen mit leeren Listen', async () => {
    getAllUsers.mockRejectedValue(new Error('kein Zugriff'));
    getAllShifts.mockRejectedValue(new Error('kein Zugriff'));
    const { result } = renderHook(() => useAdminDashboard(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.allUsers).toEqual([]);
    expect(result.current.allShifts).toEqual([]);
  });
});

describe('useAdminDashboard – Diagramme und Warnungen', () => {
  const nachweis = (datum: Date, stunden: number) => ({
    id: `t-${datum.getTime()}`,
    userId: 'u1',
    date: datum,
    totalHours: stunden,
    status: 'approved',
  });

  it('bildet die Wochenstunden auf Mo–So ab', async () => {
    // 2026-07-20 ist ein Montag, 2026-07-25 ein Samstag
    getAllTimesheets.mockResolvedValue([
      nachweis(new Date(2026, 6, 20), 8),
      nachweis(new Date(2026, 6, 20, 15), 1.25),
      nachweis(new Date(2026, 6, 25), 6),
    ]);
    const { result } = renderHook(() => useAdminDashboard(), { wrapper });
    await waitFor(() => expect(result.current.weeklyTimesheets).toHaveLength(3));

    const wochenstunden = result.current.weeklyHours;
    expect(wochenstunden).toHaveLength(7);
    expect(wochenstunden[0]).toMatchObject({ name: 'Mo', hours: 9.3, target: 8 });
    expect(wochenstunden[5]).toMatchObject({ name: 'Sa', hours: 6, target: 6 });
    expect(result.current.kpis.totalHours).toBeCloseTo(15.25, 2);
  });

  it('gruppiert die Monatsstunden nach Kalenderwoche (letzte vier)', async () => {
    getAllTimesheets.mockResolvedValue([
      nachweis(new Date(2026, 5, 1), 40),
      nachweis(new Date(2026, 5, 8), 38),
      nachweis(new Date(2026, 5, 15), 42),
      nachweis(new Date(2026, 5, 22), 36),
      nachweis(new Date(2026, 5, 29), 41),
      { id: 'ohne-datum', userId: 'u1', totalHours: 5, status: 'approved' },
    ]);
    const { result } = renderHook(() => useAdminDashboard(), { wrapper });
    await waitFor(() => expect(result.current.weeklyTimesheets).toHaveLength(6));

    const monatsstunden = result.current.monthlyHours;
    expect(monatsstunden).toHaveLength(4);
    expect(monatsstunden.every(m => m.target === 40)).toBe(true);
  });

  it('teilt die Mitarbeiter in "Im Dienst" und "Verfügbar"', async () => {
    getAllUsers.mockResolvedValue({
      data: [
        nutzer('u1', { currentStatus: 'active' }),
        nutzer('u2'),
        nutzer('u3', { active: false, currentStatus: 'active' }),
      ],
      total: 3,
      page: 1,
      limit: 100,
      hasMore: false,
    });
    const { result } = renderHook(() => useAdminDashboard(), { wrapper });
    await waitFor(() => expect(result.current.allUsers).toHaveLength(3));

    const aktivitaet = result.current.staffActivity;
    expect(aktivitaet[0]).toMatchObject({ name: 'Im Dienst', value: 1 });
    expect(aktivitaet[1]).toMatchObject({ name: 'Verfügbar', value: 1 });
  });

  it('berechnet Besetzungsquote und Auslastung nur aus aktiven Schichten', async () => {
    const morgen = new Date();
    morgen.setDate(morgen.getDate() + 1);
    const datum = morgen.toISOString().slice(0, 10);
    getAllShifts.mockResolvedValue([
      { id: 's1', date: datum, startTime: '06:00', endTime: '14:00', status: 'filled', type: 'early' },
      { id: 's2', date: datum, startTime: '14:00', endTime: '22:00', status: 'open', type: 'late' },
      // vergangene Schicht zählt nicht mehr mit
      { id: 's3', date: '2020-01-01', startTime: '06:00', endTime: '14:00', status: 'open', type: 'early' },
    ]);
    const { result } = renderHook(() => useAdminDashboard(), { wrapper });
    await waitFor(() => expect(result.current.allShifts).toHaveLength(3));

    const besetzung = result.current.shiftCompletion;
    expect(besetzung[0]).toMatchObject({ name: 'Besetzt', value: 50 });
    expect(besetzung[1]).toMatchObject({ name: 'Offen', value: 50 });
    expect(result.current.kpis.utilization).toBe(50);
    expect(result.current.kpis.openShifts).toBe(1);
  });

  it('zählt Wochenlimit-Warnungen und -Sperren', async () => {
    getAllUsers.mockResolvedValue({
      data: [
        nutzer('u1', { limitStatus: 'blocked' }),
        nutzer('u2', { limitStatus: 'warning' }),
        nutzer('u3', { limitStatus: 'normal' }),
      ],
      total: 3,
      page: 1,
      limit: 100,
      hasMore: false,
    });
    const { result } = renderHook(() => useAdminDashboard(), { wrapper });
    await waitFor(() => expect(result.current.allUsers).toHaveLength(3));

    expect(result.current.kpis.weeklyLimitBlocked).toBe(1);
    expect(result.current.kpis.weeklyLimitWarning).toBe(1);
  });

  it('zählt ablaufende Dokumente und offene Einsätze', async () => {
    getAllDocuments.mockResolvedValue([
      { id: 'd1', userId: 'u1', status: 'expiring' },
      { id: 'd2', userId: 'u1', status: 'valid' },
    ]);
    getAllAssignments.mockResolvedValue({
      data: [
        { id: 'a1', userId: 'u1', shiftId: 's1', status: 'pending' },
        { id: 'a2', userId: 'u1', shiftId: 's2', status: 'accepted' },
      ],
      total: 2,
      page: 1,
      limit: 50,
      hasMore: false,
    });
    const { result } = renderHook(() => useAdminDashboard(), { wrapper });
    await waitFor(() => expect(result.current.allDocuments).toHaveLength(2));

    expect(result.current.kpis.expiringDocuments).toBe(1);
    expect(result.current.kpis.pendingAssignments).toBe(1);
  });

  it('bereitet die letzten Aktivitäten für die Anzeige auf', async () => {
    getRecentActivities.mockResolvedValue([
      { id: 'act1', type: 'shift.created', description: 'Frühdienst angelegt', timestamp: new Date(2026, 6, 20) },
      { id: 'act2', type: 'user.login', timestamp: new Date(2026, 6, 21), status: 'success' },
    ]);
    const { result } = renderHook(() => useAdminDashboard(), { wrapper });
    await waitFor(() => expect(result.current.allActivities).toHaveLength(2));

    const aktivitaeten = result.current.recentActivities;
    expect(aktivitaeten[0]).toMatchObject({
      type: 'shift.created',
      message: 'Frühdienst angelegt',
      status: 'pending',
    });
    // ohne Beschreibung wird der Typ als Text genutzt
    expect(aktivitaeten[1]).toMatchObject({ message: 'user.login', status: 'success' });
  });

  it('zählt Schichten nach Typ und liefert (noch) leere Ranglisten', async () => {
    getAllShifts.mockResolvedValue([
      { id: 's1', date: '2026-07-20', startTime: '06:00', endTime: '14:00', status: 'open', type: 'early' },
      { id: 's2', date: '2026-07-20', startTime: '14:00', endTime: '22:00', status: 'open', type: 'early' },
      { id: 's3', date: '2026-07-20', startTime: '22:00', endTime: '06:00', status: 'open' },
    ]);
    const { result } = renderHook(() => useAdminDashboard(), { wrapper });
    await waitFor(() => expect(result.current.allShifts).toHaveLength(3));

    const proTyp = result.current.getShiftStatsByType();
    expect(proTyp.early).toBe(2);
    expect(proTyp.unknown).toBe(1);
    expect(result.current.getTopPerformers()).toEqual([]);
    expect(result.current.getTopFacilities()).toEqual([]);
  });

  it('navigiert auch in den Berichtsbereich', async () => {
    const { result } = renderHook(() => useAdminDashboard(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await result.current.exportReport();
    expect(push).toHaveBeenCalledWith('/admin/berichte');
  });
});
