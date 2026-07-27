import React, { type ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Einsatz-Hook (Annehmen/Ablehnen aus Mitarbeitersicht) und der
 * Dienstplan der Pflegekraft (Woche/Monat, offene Schichten).
 */

const mockUser = { id: 'u1', companyId: 'firmaA', role: 'nurse' };
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));

const getByUserId = vi.fn();
const acceptAssignment = vi.fn();
const declineAssignment = vi.fn();
const updateAssignment = vi.fn();
const deleteAssignment = vi.fn();
const getByUserAndDateRange = vi.fn();
const getByDateRange = vi.fn();
const requestShift = vi.fn();
const cancelRequest = vi.fn();
const acceptCf = vi.fn();
const declineCf = vi.fn();

// vi.mock wird gehoisted – gemeinsame Mocks daher über vi.hoisted definieren.
const { assignmentServiceMock, shiftServiceMock, cloudFunctionsMock } = vi.hoisted(() => {
  const g = globalThis as Record<string, ((...x: unknown[]) => unknown) | undefined>;
  const weiter = (name: string) => (...a: unknown[]) => g[name]?.(...a);
  return {
    assignmentServiceMock: {
      getByUserId: weiter('__aGetByUserId'),
      accept: weiter('__aAccept'),
      decline: weiter('__aDecline'),
      update: weiter('__aUpdate'),
      delete: weiter('__aDelete'),
      getByUserAndDateRange: weiter('__aGetByRange'),
      createRequest: weiter('__aRequest'),
    },
    shiftServiceMock: {
      getByDateRange: weiter('__sGetByRange'),
      getById: async () => null,
    },
    cloudFunctionsMock: {
      acceptAssignment: weiter('__cfAccept'),
      declineAssignment: weiter('__cfDecline'),
      requestShift: weiter('__aRequest'),
      cancelShiftRequest: weiter('__cfCancel'),
    },
  };
});

{
  const g = globalThis as Record<string, unknown>;
  g.__aGetByUserId = (...a: unknown[]) => getByUserId(...a);
  g.__aAccept = (...a: unknown[]) => acceptAssignment(...a);
  g.__aDecline = (...a: unknown[]) => declineAssignment(...a);
  g.__aUpdate = (...a: unknown[]) => updateAssignment(...a);
  g.__aDelete = (...a: unknown[]) => deleteAssignment(...a);
  g.__aGetByRange = (...a: unknown[]) => getByUserAndDateRange(...a);
  g.__aRequest = (...a: unknown[]) => requestShift(...a);
  g.__sGetByRange = (...a: unknown[]) => getByDateRange(...a);
  g.__cfAccept = (...a: unknown[]) => acceptCf(...a);
  g.__cfDecline = (...a: unknown[]) => declineCf(...a);
  g.__cfCancel = (...a: unknown[]) => cancelRequest(...a);
}

vi.mock('@/lib/services/assignments', () => ({ assignmentService: assignmentServiceMock }));
vi.mock('@/lib/services/shifts', () => ({ shiftService: shiftServiceMock }));
vi.mock('@/src/composition', () => ({
  listAllAssignments: {
    execute: (...a: unknown[]) =>
      (globalThis as Record<string, ((...x: unknown[]) => unknown) | undefined>).__listAll?.(...a) ??
      Promise.resolve({ data: [] }),
  },
}));
vi.mock('@/lib/services', () => ({
  assignmentService: assignmentServiceMock,
  shiftService: shiftServiceMock,
  facilityService: { getAll: async () => [] },
  cloudFunctions: cloudFunctionsMock,
}));

vi.mock('@/lib/utils/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('@/lib/services/cloudFunctions', () => ({ cloudFunctions: cloudFunctionsMock }));

import { useAssignments } from '../useAssignments';
import { useNurseSchedule } from '../useNurseSchedule';

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) =>
  React.createElement(QueryClientProvider, { client }, children);

const einsatz = (overrides: Record<string, unknown> = {}) => ({
  id: 'a1',
  userId: 'u1',
  shiftId: 's1',
  companyId: 'firmaA',
  status: 'assigned',
  assignedAt: new Date(2026, 6, 18),
  createdAt: new Date(2026, 6, 18),
  updatedAt: new Date(2026, 6, 18),
  ...overrides,
});

const listAll = vi.fn();
(globalThis as Record<string, unknown>).__listAll = (...a: unknown[]) => listAll(...a);

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  listAll.mockResolvedValue({ data: [] });
  getByUserId.mockResolvedValue([]);
  getByUserAndDateRange.mockResolvedValue([]);
  getByDateRange.mockResolvedValue([]);
});

describe('useAssignments', () => {
  it('lädt die Einsätze und gruppiert nach Status', async () => {
    listAll.mockResolvedValue({ data: [
      einsatz({ id: 'a1', status: 'pending' }),
      einsatz({ id: 'a2', status: 'accepted' }),
      einsatz({ id: 'a3', status: 'declined' }),
      einsatz({ id: 'a4', status: 'completed' }),
    ] });
    const { result } = renderHook(() => useAssignments(), { wrapper });
    await waitFor(() => expect(result.current.assignments).toHaveLength(4));

    expect(result.current.pendingAssignments).toHaveLength(1);
    expect(result.current.acceptedAssignments).toHaveLength(1);
    expect(result.current.declinedAssignments).toHaveLength(1);
    expect(result.current.completedAssignments).toHaveLength(1);
  });

  it('nimmt einen Einsatz an', async () => {
    listAll.mockResolvedValue({ data: [einsatz()] });
    acceptAssignment.mockResolvedValue(undefined);
    acceptCf.mockResolvedValue({ success: true });
    const { result } = renderHook(() => useAssignments(), { wrapper });
    await waitFor(() => expect(result.current.assignments).toHaveLength(1));

    await act(async () => {
      await result.current.acceptAssignment('a1');
    });
    expect(acceptAssignment.mock.calls.length + acceptCf.mock.calls.length).toBeGreaterThan(0);
  });

  it('lehnt einen Einsatz ab', async () => {
    listAll.mockResolvedValue({ data: [einsatz()] });
    declineAssignment.mockResolvedValue(undefined);
    declineCf.mockResolvedValue({ success: true });
    const { result } = renderHook(() => useAssignments(), { wrapper });
    await waitFor(() => expect(result.current.assignments).toHaveLength(1));

    await act(async () => {
      await result.current.declineAssignment('a1');
    });
    expect(declineAssignment.mock.calls.length + declineCf.mock.calls.length).toBeGreaterThan(0);
  });

  it('meldet einen Ladefehler', async () => {
    listAll.mockRejectedValue(new Error('kein Zugriff'));
    const { result } = renderHook(() => useAssignments(), { wrapper });
    await waitFor(() => expect(result.current.error).toBeTruthy());
  });
});

describe('useNurseSchedule', () => {
  it('lädt Einsätze und offene Schichten der Woche', async () => {
    getByUserAndDateRange.mockResolvedValue([einsatz({ status: 'accepted' })]);
    getByDateRange.mockResolvedValue([
      {
        id: 's-offen',
        facilityId: 'f1',
        date: '2026-07-22',
        startTime: '06:00',
        endTime: '14:00',
        status: 'open',
        capacity: 1,
        assignedCount: 0,
      },
    ]);
    const { result } = renderHook(() => useNurseSchedule('week', new Date(2026, 6, 20)), {
      wrapper,
    });
    await waitFor(() => expect(getByUserAndDateRange).toHaveBeenCalled());
    await waitFor(() => expect(getByDateRange).toHaveBeenCalled());
    expect(result.current).toBeTruthy();
  });

  it('berechnet den Wochenbereich ab Montag', async () => {
    renderHook(() => useNurseSchedule('week', new Date(2026, 6, 22)), { wrapper });
    await waitFor(() => expect(getByUserAndDateRange).toHaveBeenCalled());
    const [, start] = getByUserAndDateRange.mock.calls[0];
    expect((start as Date).getDay()).toBe(1); // Montag
  });

  it('berechnet den Monatsbereich vom Ersten bis zum Letzten', async () => {
    renderHook(() => useNurseSchedule('month', new Date(2026, 6, 15)), { wrapper });
    await waitFor(() => expect(getByUserAndDateRange).toHaveBeenCalled());
    const [, start, end] = getByUserAndDateRange.mock.calls[0];
    expect((start as Date).getDate()).toBe(1);
    expect((end as Date).getDate()).toBe(31);
  });

  it('liefert Hilfsfunktionen für die Anzeige', async () => {
    const { result } = renderHook(() => useNurseSchedule('week', new Date(2026, 6, 20)), {
      wrapper,
    });
    await waitFor(() => expect(getByUserAndDateRange).toHaveBeenCalled());
    expect(typeof result.current.getShiftTypeColor).toBe('function');
    expect(typeof result.current.getStatusLabel).toBe('function');
    expect(typeof result.current.formatTime).toBe('function');
  });
});
