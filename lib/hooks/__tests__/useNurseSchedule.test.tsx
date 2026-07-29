import React, { type ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Dienstplan-Hook der Pflegekraft: eigene Einsätze im Zeitraum, offene
 * Schichten, Annehmen/Ablehnen (mit Unterschrifts-Workflow) und Anfragen.
 */

const mockUser = {
  id: 'u1',
  companyId: 'firmaA',
  role: 'nurse',
  qualifications: ['Intensivpflege'],
};
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));

const getByUserAndDateRange = vi.fn();
const acceptAssignment = vi.fn();
const getShiftsByDateRange = vi.fn();
const getAllFacilities = vi.fn();
const declineAssignmentCF = vi.fn();
const requestShiftCF = vi.fn();

vi.mock('@/lib/services', () => ({
  assignmentService: {
    getByUserAndDateRange: (...a: unknown[]) => getByUserAndDateRange(...a),
    accept: (...a: unknown[]) => acceptAssignment(...a),
  },
  shiftService: { getByDateRange: (...a: unknown[]) => getShiftsByDateRange(...a) },
  facilityService: { getAll: (...a: unknown[]) => getAllFacilities(...a) },
  cloudFunctions: {
    declineAssignment: (...a: unknown[]) => declineAssignmentCF(...a),
    requestShiftAssignment: (...a: unknown[]) => requestShiftCF(...a),
  },
}));

vi.mock('@/lib/utils/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { useNurseSchedule } from '../useNurseSchedule';
import { toast } from '@/lib/utils/toast';

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

const schicht = (overrides: Record<string, unknown> = {}) => ({
  id: 's1',
  date: new Date(2026, 6, 22),
  startTime: '06:00',
  endTime: '14:00',
  status: 'open',
  type: 'early',
  requiredQualifications: [],
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  getByUserAndDateRange.mockResolvedValue([]);
  getShiftsByDateRange.mockResolvedValue([]);
  getAllFacilities.mockResolvedValue([]);
  acceptAssignment.mockResolvedValue(undefined);
  declineAssignmentCF.mockResolvedValue({ success: true, requiresSignature: false });
  requestShiftCF.mockResolvedValue({ success: true, assignmentId: 'a9' });
});

describe('Laden', () => {
  it('lädt eigene Einsätze und nur offene Schichten der Woche', async () => {
    getByUserAndDateRange.mockResolvedValue([einsatz()]);
    getShiftsByDateRange.mockResolvedValue([
      schicht(),
      schicht({ id: 's-vergeben', status: 'assigned' }),
    ]);

    const { result } = renderHook(() => useNurseSchedule('week', new Date(2026, 6, 22)), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.myAssignments).toHaveLength(1);
    await waitFor(() => expect(result.current.openShifts).toHaveLength(1));
    expect(result.current.openShifts[0].id).toBe('s1');
  });

  it('nutzt in der Monatsansicht Monatsanfang und -ende', async () => {
    renderHook(() => useNurseSchedule('month', new Date(2026, 6, 15)), { wrapper });
    await waitFor(() => expect(getByUserAndDateRange).toHaveBeenCalled());

    const [, start, ende] = getByUserAndDateRange.mock.calls[0];
    expect((start as Date).getDate()).toBe(1);
    expect((ende as Date).getMonth()).toBe(6); // 31.07.2026
    expect((ende as Date).getDate()).toBe(31);
  });

  it('führt zu bestätigende Einsätze als offen', async () => {
    getByUserAndDateRange.mockResolvedValue([
      einsatz({ id: 'zugewiesen', status: 'assigned' }),
      einsatz({ id: 'angefragt', status: 'requested' }),
      einsatz({ id: 'offen', status: 'pending' }),
      einsatz({ id: 'fertig', status: 'completed' }),
    ]);
    const { result } = renderHook(() => useNurseSchedule(), { wrapper });
    await waitFor(() => expect(result.current.myAssignments).toHaveLength(4));

    expect(result.current.pendingAssignments.map(a => a.id)).toEqual([
      'zugewiesen',
      'angefragt',
      'offen',
    ]);
  });
});

describe('Aktionen', () => {
  it('nimmt einen Einsatz an und meldet Erfolg', async () => {
    const { result } = renderHook(() => useNurseSchedule(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.acceptAssignment('a1');
    });
    expect(acceptAssignment).toHaveBeenCalledWith('a1');
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it('lehnt über die Cloud Function ab und weist auf die Unterschrift hin', async () => {
    declineAssignmentCF.mockResolvedValue({ success: true, requiresSignature: true });
    const { result } = renderHook(() => useNurseSchedule(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.declineAssignment('a1', 'krank');
    });
    expect(declineAssignmentCF).toHaveBeenCalledWith({
      assignmentId: 'a1',
      declineType: 'nurse-initiated',
      declineReason: 'krank',
    });
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('Admin-Unterschrift'))
    );
  });

  it('sendet eine Schichtanfrage', async () => {
    const { result } = renderHook(() => useNurseSchedule(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.requestShift('s5', 'gern Frühdienst');
    });
    expect(requestShiftCF).toHaveBeenCalledWith('s5', 'gern Frühdienst');
  });

  it('meldet Fehler beim Annehmen als Toast', async () => {
    acceptAssignment.mockRejectedValue(new Error('Schicht ist voll'));
    const { result } = renderHook(() => useNurseSchedule(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await expect(
      act(async () => {
        await result.current.acceptAssignment('a1');
      })
    ).rejects.toThrow('Schicht ist voll');
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Schicht ist voll'))
    );
  });

});

describe('Hilfsfunktionen', () => {
  it('liefert Status-Farben und -Beschriftungen', async () => {
    const { result } = renderHook(() => useNurseSchedule(), { wrapper });

    expect(result.current.getStatusColor('pending')).toBe('warning');
    expect(result.current.getStatusColor('accepted')).toBe('success');
    expect(result.current.getStatusColor('declined')).toBe('error');
    expect(result.current.getStatusColor('completed')).toBe('info');
    expect(result.current.getStatusColor('requested')).toBe('info');
    expect(result.current.getStatusColor('assigned')).toBe('primary');

    expect(result.current.getStatusLabel('pending')).toBe('Ausstehend');
    expect(result.current.getStatusLabel('accepted')).toBe('Angenommen');
    expect(result.current.getStatusLabel('declined')).toBe('Abgelehnt');
    expect(result.current.getStatusLabel('completed')).toBe('Abgeschlossen');
    expect(result.current.getStatusLabel('requested')).toBe('Angefragt');
    expect(result.current.getStatusLabel('assigned')).toBe('Zugewiesen');
    expect(typeof result.current.getShiftTypeColor('early')).toBe('string');
  });

  it('prüft Qualifikationen und nennt fehlende', async () => {
    const { result } = renderHook(() => useNurseSchedule(), { wrapper });

    const ohneAnforderung = schicht({ requiredQualifications: [] });
    expect(result.current.isQualifiedForShift(ohneAnforderung as never)).toBe(true);
    expect(result.current.getMissingQualifications(ohneAnforderung as never)).toEqual([]);

    const passend = schicht({ requiredQualifications: ['Intensivpflege'] });
    expect(result.current.isQualifiedForShift(passend as never)).toBe(true);

    const fehlend = schicht({ requiredQualifications: ['Intensivpflege', 'OP-Pflege'] });
    expect(result.current.isQualifiedForShift(fehlend as never)).toBe(false);
    expect(result.current.getMissingQualifications(fehlend as never)).toEqual(['OP-Pflege']);
  });

  it('formatiert Uhrzeiten und die Zeit bis zum Schichtbeginn', async () => {
    const { result } = renderHook(() => useNurseSchedule(), { wrapper });

    expect(result.current.formatTime(new Date(2026, 6, 22), '06:30')).toBe('06:30');

    const inVierTagen = new Date();
    inVierTagen.setDate(inVierTagen.getDate() + 4);
    expect(
      result.current.getTimeUntilShift(schicht({ date: inVierTagen, startTime: '06:00' }) as never)
    ).toMatch(/^[0-9]+ Tage$/);

    const vergangen = new Date();
    vergangen.setDate(vergangen.getDate() - 1);
    expect(
      result.current.getTimeUntilShift(schicht({ date: vergangen, startTime: '06:00' }) as never)
    ).toBe('Bald');
  });
});
