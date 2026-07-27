import React, { type ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Anreicherung der Kalenderansicht: Zu jeder Schicht werden Einrichtung,
 * Station und die Namen der besetzten Mitarbeitenden nachgeladen.
 */

const authUser: { id?: string; companyId?: string } = { id: 'u1', companyId: 'firmaA' };
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: authUser }) }));

const getFacilityById = vi.fn();
const getAssignmentsByShift = vi.fn();
const getUserById = vi.fn();
vi.mock('@/lib/services', () => ({
  facilityService: { getById: (...a: unknown[]) => getFacilityById(...a) },
  assignmentService: { getByShiftId: (...a: unknown[]) => getAssignmentsByShift(...a) },
  userService: { getById: (...a: unknown[]) => getUserById(...a) },
}));

import { useShiftEnrichment } from '../useShiftEnrichment';

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) =>
  React.createElement(QueryClientProvider, { client }, children);

const schicht = (id: string, overrides: Record<string, unknown> = {}) =>
  ({
    id,
    facilityId: 'f1',
    date: '2026-07-20',
    startTime: '06:00',
    endTime: '14:00',
    status: 'open',
    ...overrides,
  }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  authUser.id = 'u1';
  authUser.companyId = 'firmaA';
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  getFacilityById.mockResolvedValue({
    id: 'f1',
    name: 'Haus Sonnenschein',
    stations: [{ id: 'st1', name: 'Station 3' }],
  });
  getAssignmentsByShift.mockResolvedValue([]);
  getUserById.mockResolvedValue({ id: 'u2', displayName: 'Anna Muster' });
});

describe('useShiftEnrichment', () => {
  it('ergänzt Einrichtung, Station und Namen der besetzten Mitarbeitenden', async () => {
    getAssignmentsByShift.mockResolvedValue([
      { id: 'a1', userId: 'u2', shiftId: 's1', status: 'accepted' },
      { id: 'a2', userId: 'u3', shiftId: 's1', status: 'declined' },
    ]);
    getUserById.mockImplementation(async (id: string) =>
      id === 'u2' ? { id, displayName: 'Anna Muster' } : null
    );

    const { result } = renderHook(
      () => useShiftEnrichment([schicht('s1', { stationId: 'st1' })]),
      { wrapper }
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.enrichment.s1).toEqual({
      facilityName: 'Haus Sonnenschein',
      stationName: 'Station 3',
      assigneeNames: ['Anna Muster'],
    });
    // abgelehnte Einsätze zählen nicht als Besetzung
    expect(getUserById).toHaveBeenCalledTimes(1);
  });

  it('nennt die E-Mail, wenn kein Anzeigename hinterlegt ist', async () => {
    getAssignmentsByShift.mockResolvedValue([
      { id: 'a1', userId: 'u2', shiftId: 's1', status: 'assigned' },
    ]);
    getUserById.mockResolvedValue({ id: 'u2', email: 'anna@aufabruf.eu' });

    const { result } = renderHook(() => useShiftEnrichment([schicht('s1')]), { wrapper });
    await waitFor(() => expect(result.current.enrichment.s1).toBeTruthy());

    expect(result.current.enrichment.s1.assigneeNames).toEqual(['anna@aufabruf.eu']);
  });

  it('fällt auf die Nutzer-ID zurück, wenn der Mitarbeiter gelöscht wurde', async () => {
    getAssignmentsByShift.mockResolvedValue([
      { id: 'a1', userId: 'weg', shiftId: 's1', status: 'accepted' },
    ]);
    getUserById.mockResolvedValue(null);

    const { result } = renderHook(() => useShiftEnrichment([schicht('s1')]), { wrapper });
    await waitFor(() => expect(result.current.enrichment.s1).toBeTruthy());

    expect(result.current.enrichment.s1.assigneeNames).toEqual(['weg']);
  });

  it('nennt eine unbekannte Einrichtung beim Namen des Fallbacks', async () => {
    getFacilityById.mockResolvedValue(null);
    const { result } = renderHook(() => useShiftEnrichment([schicht('s1')]), { wrapper });
    await waitFor(() => expect(result.current.enrichment.s1).toBeTruthy());

    expect(result.current.enrichment.s1.facilityName).toBe('Unbekannte Einrichtung');
    expect(result.current.enrichment.s1.stationName).toBeUndefined();
  });

  it('lässt die Station leer, wenn sie in der Einrichtung fehlt', async () => {
    const { result } = renderHook(
      () => useShiftEnrichment([schicht('s1', { stationId: 'st-weg' })]),
      { wrapper }
    );
    await waitFor(() => expect(result.current.enrichment.s1).toBeTruthy());
    expect(result.current.enrichment.s1.stationName).toBeUndefined();
  });

  it('lädt jede Einrichtung nur einmal, auch bei mehreren Schichten', async () => {
    const { result } = renderHook(
      () => useShiftEnrichment([schicht('s1'), schicht('s2'), schicht('s3')]),
      { wrapper }
    );
    await waitFor(() => expect(Object.keys(result.current.enrichment)).toHaveLength(3));

    expect(getFacilityById).toHaveBeenCalledTimes(1);
    expect(getAssignmentsByShift).toHaveBeenCalledTimes(3);
  });

  it('lädt ohne Schichten gar nichts', async () => {
    const { result } = renderHook(() => useShiftEnrichment([]), { wrapper });
    await new Promise(r => setTimeout(r, 30));

    expect(result.current.enrichment).toEqual({});
    expect(getFacilityById).not.toHaveBeenCalled();
  });

  it('nutzt eine übergebene companyId vorrangig', async () => {
    const { result } = renderHook(() => useShiftEnrichment([schicht('s1')], 'firmaB'), {
      wrapper,
    });
    await waitFor(() => expect(result.current.enrichment.s1).toBeTruthy());
    expect(result.current.enrichment.s1.facilityName).toBe('Haus Sonnenschein');
  });

  it('liest die companyId aus den Schichten, wenn der Kontext keine hat', async () => {
    authUser.companyId = undefined;
    const { result } = renderHook(
      () => useShiftEnrichment([schicht('s1', { companyId: 'firmaAusSchicht' })]),
      { wrapper }
    );
    await waitFor(() => expect(result.current.enrichment.s1).toBeTruthy());
    expect(result.current.enrichment.s1.facilityName).toBe('Haus Sonnenschein');
  });

  it('kommt mit vielen Schichten zurecht (gekürzter Abfrageschlüssel)', async () => {
    const viele = Array.from({ length: 35 }, (_, i) => schicht(`s${i}`));
    const { result } = renderHook(() => useShiftEnrichment(viele), { wrapper });
    await waitFor(() => expect(Object.keys(result.current.enrichment)).toHaveLength(35));

    expect(getAssignmentsByShift).toHaveBeenCalledTimes(35);
  });
});
