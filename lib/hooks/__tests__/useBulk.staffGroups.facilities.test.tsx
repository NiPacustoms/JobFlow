import React, { type ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Sammelaktionen (Mehrfachauswahl in Listen), Personal-Gruppen und die
 * Einrichtungs-Sicht des Mitarbeiters (Favoriten, Anfahrt, Statistik).
 */

const mockUser = { id: 'u1', companyId: 'firmaA', role: 'admin' };
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));

const getEmployeeFacilities = vi.fn();
const addToFavorites = vi.fn();
const removeFromFavorites = vi.fn();
const getDirections = vi.fn();
vi.mock('@/lib/services/employeeFacilities', () => ({
  employeeFacilitiesService: {
    getAll: (...a: unknown[]) => getEmployeeFacilities(...a),
    addToFavorites: (...a: unknown[]) => addToFavorites(...a),
    removeFromFavorites: (...a: unknown[]) => removeFromFavorites(...a),
    getDirections: (...a: unknown[]) => getDirections(...a),
  },
}));

vi.mock('@/lib/utils/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import {
  useBulkOperations,
  createBulkDeleteOperation,
  createBulkStatusUpdateOperation,
  createBulkExportOperation,
  type BulkOperation,
} from '../useBulkOperations';
import { useStaffGroups } from '../useStaffGroups';
import { useEmployeeFacilities } from '../useEmployeeFacilities';
import { toast } from '@/lib/utils/toast';

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) =>
  React.createElement(QueryClientProvider, { client }, children);

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  getEmployeeFacilities.mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

type Zeile = { id: string; name: string };

describe('useBulkOperations', () => {
  const zeilen: Zeile[] = [
    { id: 'z1', name: 'Anna' },
    { id: 'z2', name: 'Bea' },
  ];

  it('wählt Elemente einzeln an und wieder ab', () => {
    const { result } = renderHook(() => useBulkOperations<Zeile>([]));

    act(() => result.current.toggleSelection(zeilen[0]));
    expect(result.current.isSelected(zeilen[0])).toBe(true);
    expect(result.current.isPartiallySelected(zeilen)).toBe(true);

    act(() => result.current.toggleSelection(zeilen[0]));
    expect(result.current.isSelected(zeilen[0])).toBe(false);
  });

  it('wählt alle an und hebt die Auswahl wieder auf', () => {
    const { result } = renderHook(() => useBulkOperations<Zeile>([]));

    act(() => result.current.toggleSelectAll(zeilen));
    expect(result.current.isAllSelected(zeilen)).toBe(true);

    act(() => result.current.toggleSelectAll(zeilen));
    expect(result.current.selectedItems).toHaveLength(0);

    act(() => result.current.toggleSelection(zeilen[0]));
    act(() => result.current.clearSelection());
    expect(result.current.selectedItems).toHaveLength(0);
  });

  it('führt eine Aktion für die Auswahl aus und ruft onSuccess auf', async () => {
    const aktion = vi.fn(async () => undefined);
    const onSuccess = vi.fn();
    const op: BulkOperation<Zeile> = { id: 'op', label: 'Testaktion', action: aktion };
    const { result } = renderHook(() => useBulkOperations<Zeile>([op], onSuccess));

    act(() => result.current.toggleSelection(zeilen[0]));
    await act(async () => {
      await result.current.executeOperation(op);
    });

    expect(aktion).toHaveBeenCalledWith([zeilen[0]]);
    expect(onSuccess).toHaveBeenCalled();
    expect(result.current.selectedItems).toHaveLength(0);
    expect(toast.success).toHaveBeenCalled();
  });

  it('verweigert die Ausführung ohne Auswahl', async () => {
    const aktion = vi.fn(async () => undefined);
    const op: BulkOperation<Zeile> = { id: 'op', label: 'Testaktion', action: aktion };
    const { result } = renderHook(() => useBulkOperations<Zeile>([op]));

    await act(async () => {
      await result.current.executeOperation(op);
    });
    expect(aktion).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('Keine Elemente ausgewählt');
  });

  it('bricht ab, wenn die Rückfrage verneint wird', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const aktion = vi.fn(async () => undefined);
    const op: BulkOperation<Zeile> = {
      id: 'op',
      label: 'Löschen',
      action: aktion,
      requiresConfirmation: true,
    };
    const { result } = renderHook(() => useBulkOperations<Zeile>([op]));

    act(() => result.current.toggleSelection(zeilen[0]));
    await act(async () => {
      await result.current.executeOperation(op);
    });
    expect(aktion).not.toHaveBeenCalled();
  });

  it('meldet Fehler der Aktion über den Toast', async () => {
    const op: BulkOperation<Zeile> = {
      id: 'op',
      label: 'Testaktion',
      action: vi.fn(async () => {
        throw new Error('kaputt');
      }),
    };
    const { result } = renderHook(() => useBulkOperations<Zeile>([op]));

    act(() => result.current.toggleSelection(zeilen[0]));
    await act(async () => {
      await result.current.executeOperation(op);
    });
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('kaputt'));
    expect(result.current.isProcessing).toBe(false);
  });

  it('setzt den Auswahlmodus um und leert die Auswahl beim Verlassen', () => {
    const { result } = renderHook(() => useBulkOperations<Zeile>([]));

    act(() => result.current.toggleSelecting());
    expect(result.current.isSelecting).toBe(true);

    act(() => result.current.toggleSelection(zeilen[0]));
    act(() => result.current.toggleSelecting());
    expect(result.current.isSelecting).toBe(false);
    expect(result.current.selectedItems).toHaveLength(0);
  });

  it('erzeugt Standard-Sammelaktionen (Löschen, Status, Export)', async () => {
    const loeschen = vi.fn(async () => undefined);
    const statusSetzen = vi.fn(async () => undefined);
    const exportieren = vi.fn(async () => undefined);

    const delOp = createBulkDeleteOperation<Zeile>(loeschen, 'Nachweise');
    const statusOp = createBulkStatusUpdateOperation<Zeile>(statusSetzen, 'approved', 'Genehmigt');
    const exportOp = createBulkExportOperation<Zeile>(exportieren, 'CSV');

    await delOp.action(zeilen);
    await statusOp.action(zeilen);
    await exportOp.action(zeilen);

    expect(loeschen).toHaveBeenCalledWith(['z1', 'z2']);
    expect(statusSetzen).toHaveBeenCalledWith(['z1', 'z2'], 'approved');
    expect(exportieren).toHaveBeenCalledWith(zeilen);
    expect(delOp.requiresConfirmation).toBe(true);
    expect(exportOp.requiresConfirmation).toBe(false);
  });
});

describe('useStaffGroups', () => {
  it('liefert leere Gruppen und Nullstatistik (Service noch nicht implementiert)', async () => {
    const { result } = renderHook(() => useStaffGroups(), { wrapper });
    await waitFor(() => expect(result.current.loadingGroups).toBe(false));

    expect(result.current.groups).toEqual([]);
    expect(result.current.stats).toMatchObject({
      total: 0,
      myGroups: 0,
      totalMembers: 0,
      avgMembersPerGroup: '0',
    });
  });

  it('behandelt fehlschlagende Mutationen ohne Absturz', async () => {
    const { result } = renderHook(() => useStaffGroups(), { wrapper });
    await waitFor(() => expect(result.current.loadingGroups).toBe(false));

    act(() => {
      result.current.createGroup({ name: 'Frühdienst-Team', memberIds: [] });
      result.current.updateGroup('g1', { name: 'Neu' });
      result.current.addMember('g1', 'u2');
      result.current.removeMember('g1', 'u2');
    });
    await waitFor(() => expect(result.current.isCreating).toBe(false));
    await waitFor(() => expect(result.current.isUpdating).toBe(false));
  });

  it('löscht nur nach bestätigter Rückfrage', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { result } = renderHook(() => useStaffGroups(), { wrapper });
    await waitFor(() => expect(result.current.loadingGroups).toBe(false));

    act(() => result.current.deleteGroup('g1'));
    expect(result.current.isDeleting).toBe(false);

    confirmSpy.mockReturnValue(true);
    act(() => result.current.deleteGroup('g1'));
    await waitFor(() => expect(result.current.isDeleting).toBe(false));
  });
});

describe('useEmployeeFacilities', () => {
  const einrichtung = (overrides: Record<string, unknown> = {}) => ({
    id: 'f1',
    name: 'Haus Sonnenschein',
    type: 'nursing_home' as const,
    address: 'Hauptstr. 1',
    phone: '030 123',
    email: 'info@haus.de',
    contactPerson: 'Frau Meier',
    shiftSupervisor: 'Herr Kurz',
    distance: 12.4,
    travelTime: '20 min',
    rating: 4.5,
    shiftCount: 3,
    isFavorite: false,
    ...overrides,
  });

  it('lädt die Einrichtungen des Mitarbeiters', async () => {
    getEmployeeFacilities.mockResolvedValue([einrichtung()]);
    const { result } = renderHook(() => useEmployeeFacilities(), { wrapper });
    await waitFor(() => expect(result.current.facilities).toHaveLength(1));
    expect(getEmployeeFacilities).toHaveBeenCalledWith({ userId: 'u1', companyId: 'firmaA' });
  });

  it('berechnet die Einrichtungsstatistik', async () => {
    getEmployeeFacilities.mockResolvedValue([
      einrichtung(),
      einrichtung({ id: 'f2', isFavorite: true, shiftCount: 0, rating: 3.5, distance: 7.6 }),
    ]);
    const { result } = renderHook(() => useEmployeeFacilities(), { wrapper });
    await waitFor(() => expect(result.current.facilities).toHaveLength(2));

    expect(result.current.getFacilityStats()).toEqual({
      totalFacilities: 2,
      activeFacilities: 1,
      favoriteFacilities: 1,
      totalShifts: 3,
      averageRating: 4,
      totalDistance: 20,
    });
  });

  it('fügt Favoriten hinzu und entfernt sie', async () => {
    addToFavorites.mockResolvedValue(undefined);
    removeFromFavorites.mockResolvedValue(undefined);
    const { result } = renderHook(() => useEmployeeFacilities(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.addToFavorites('f1');
      await result.current.removeFromFavorites('f1');
    });
    expect(addToFavorites).toHaveBeenCalledWith({ userId: 'u1', companyId: 'firmaA' }, 'f1');
    expect(removeFromFavorites).toHaveBeenCalledWith({ userId: 'u1', companyId: 'firmaA' }, 'f1');
  });

  it('öffnet die Anfahrt in einem neuen Tab', async () => {
    getDirections.mockResolvedValue({ url: 'https://maps.example/route' });
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    const { result } = renderHook(() => useEmployeeFacilities(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.getDirections('f1');
    });
    expect(openSpy).toHaveBeenCalledWith('https://maps.example/route', '_blank');
  });

  it('meldet Fehler beim Favorisieren über den Toast', async () => {
    addToFavorites.mockRejectedValue(new Error('kein Zugriff'));
    const { result } = renderHook(() => useEmployeeFacilities(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await expect(
      act(async () => {
        await result.current.addToFavorites('f1');
      })
    ).rejects.toThrow('kein Zugriff');
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });
});
