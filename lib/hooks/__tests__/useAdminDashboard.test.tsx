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
