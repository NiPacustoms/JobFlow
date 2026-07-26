import React, { type ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Dienstplan-Hook: Laden, Kennzahlen, Anlegen/Ändern/Löschen und Zuweisen.
 */

const mockUser = { id: 'admin1', companyId: 'firmaA', role: 'admin' };
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));

const getWithFilters = vi.fn();
const createShift = vi.fn();
const updateShift = vi.fn();
const deleteShift = vi.fn();
const assignShiftFn = vi.fn();
const unassignShiftFn = vi.fn();

vi.mock('@/lib/services', () => ({
  shiftService: {
    getWithFilters: (...a: unknown[]) => getWithFilters(...a),
    getAllWithFilters: (...a: unknown[]) => getWithFilters(...a),
    getAll: (...a: unknown[]) => getWithFilters(...a),
    create: (...a: unknown[]) => createShift(...a),
    update: (...a: unknown[]) => updateShift(...a),
    delete: (...a: unknown[]) => deleteShift(...a),
  },
  assignmentService: {
    create: vi.fn(),
    delete: vi.fn(),
    getByShiftId: vi.fn(async () => [{ id: 'a1', userId: 'u1', shiftId: 's1', status: 'assigned' }]),
  },
  cloudFunctions: {
    assignShiftToUser: (...a: unknown[]) => assignShiftFn(...a),
    assignShift: (...a: unknown[]) => assignShiftFn(...a),
    unassignUser: (...a: unknown[]) => unassignShiftFn(...a),
    unassignShiftFromUser: (...a: unknown[]) => unassignShiftFn(...a),
    unassignShift: (...a: unknown[]) => unassignShiftFn(...a),
  },
}));

vi.mock('@/lib/utils/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { useShifts } from '../useShifts';

const wrapper = ({ children }: { children: ReactNode }) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return React.createElement(QueryClientProvider, { client }, children);
};

const schicht = (overrides: Record<string, unknown> = {}) => ({
  id: 's1',
  facilityId: 'f1',
  companyId: 'firmaA',
  // weit in der Zukunft, damit der Anzeigestatus nicht auf "ended" fällt
  date: '2099-07-20',
  startTime: '06:00',
  endTime: '14:00',
  status: 'open',
  capacity: 2,
  assignedCount: 0,
  assignedTo: [],
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  getWithFilters.mockResolvedValue([]);
});

describe('useShifts', () => {
  it('lädt die Schichten', async () => {
    getWithFilters.mockResolvedValue([schicht(), schicht({ id: 's2' })]);
    const { result } = renderHook(() => useShifts(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.shifts).toHaveLength(2);
  });

  it('ergänzt die companyId des angemeldeten Nutzers im Filter', async () => {
    getWithFilters.mockResolvedValue([]);
    const { result } = renderHook(() => useShifts(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(getWithFilters).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: 'firmaA' })
    );
  });

  it('berechnet Kennzahlen über offene, besetzte und abgesagte Schichten', async () => {
    getWithFilters.mockResolvedValue([
      schicht({ id: 's1', status: 'open', capacity: 2, assignedCount: 0 }),
      schicht({ id: 's2', status: 'filled', capacity: 1, assignedCount: 1 }),
      schicht({ id: 's3', status: 'cancelled', capacity: 3, assignedCount: 0 }),
    ]);
    const { result } = renderHook(() => useShifts(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const stats = result.current.getShiftStats();
    expect(stats.total).toBe(3);
    expect(stats.open).toBe(1);
    expect(stats.filled).toBe(1);
    expect(stats.cancelled).toBe(1);
    expect(stats.assignedCount).toBe(1);
    expect(stats.totalCapacity).toBe(6);
  });

  it('liefert leere Kennzahlen ohne Schichten', async () => {
    const { result } = renderHook(() => useShifts(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.getShiftStats()).toMatchObject({ total: 0, open: 0, filled: 0 });
  });

  it('legt eine Schicht an', async () => {
    createShift.mockResolvedValue('s-neu');
    const { result } = renderHook(() => useShifts(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.createShift(schicht() as never);
    });
    expect(createShift).toHaveBeenCalled();
  });

  it('ändert eine Schicht', async () => {
    updateShift.mockResolvedValue(undefined);
    const { result } = renderHook(() => useShifts(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.updateShift('s1', { notes: 'Neu' } as never);
    });
    expect(updateShift).toHaveBeenCalledWith('s1', { notes: 'Neu' });
  });

  it('löscht eine Schicht', async () => {
    deleteShift.mockResolvedValue(undefined);
    const { result } = renderHook(() => useShifts(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.deleteShift('s1');
    });
    expect(deleteShift).toHaveBeenCalledWith('s1');
  });

  it('weist eine Schicht über die Cloud Function zu', async () => {
    assignShiftFn.mockResolvedValue({ success: true });
    const { result } = renderHook(() => useShifts(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.assignShift('s1', 'u1');
    });
    expect(assignShiftFn).toHaveBeenCalled();
  });

  it('gibt eine Zuweisung wieder frei', async () => {
    unassignShiftFn.mockResolvedValue({ success: true });
    const { result } = renderHook(() => useShifts(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.unassignShift('s1', 'u1');
    });
    expect(unassignShiftFn).toHaveBeenCalled();
  });

  it('meldet einen Ladefehler', async () => {
    getWithFilters.mockRejectedValue(new Error('kein Zugriff'));
    const { result } = renderHook(() => useShifts(), { wrapper });
    await waitFor(() => expect(result.current.error).toBeTruthy());
  });
});
