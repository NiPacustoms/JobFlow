import React, { type ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Dienstplan-Hook des Mitarbeiters (Einsätze, offene Schichten, Konflikte)
 * und der Branding-Hook (Logo, Farben) des Admin-Bereichs.
 */

const mockUser = { id: 'u1', companyId: 'firmaA', role: 'nurse' };
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));

let adminZugriff = true;
vi.mock('@/contexts/PermissionsContext', () => ({
  usePermissions: () => ({ canAccessAdminArea: adminZugriff }),
}));

const getAssignmentsByUser = vi.fn();
const acceptAssignment = vi.fn();
const declineAssignment = vi.fn();
const getAllShifts = vi.fn();
const getShiftsByDateRange = vi.fn();
const getAllFacilities = vi.fn();
vi.mock('@/lib/services', () => ({
  assignmentService: {
    getByUserId: (...a: unknown[]) => getAssignmentsByUser(...a),
    accept: (...a: unknown[]) => acceptAssignment(...a),
    decline: (...a: unknown[]) => declineAssignment(...a),
  },
  shiftService: {
    getAll: (...a: unknown[]) => getAllShifts(...a),
    getByDateRange: (...a: unknown[]) => getShiftsByDateRange(...a),
  },
  facilityService: { getAll: (...a: unknown[]) => getAllFacilities(...a) },
}));

const getSettings = vi.fn();
const updateBrandingSettings = vi.fn();
const uploadLogo = vi.fn();
const deleteLogo = vi.fn();
vi.mock('@/lib/services/settingsService', () => ({
  settingsService: {
    getSettings: (...a: unknown[]) => getSettings(...a),
    updateBrandingSettings: (...a: unknown[]) => updateBrandingSettings(...a),
    uploadLogo: (...a: unknown[]) => uploadLogo(...a),
    deleteLogo: (...a: unknown[]) => deleteLogo(...a),
  },
}));

vi.mock('@/lib/utils/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { useSchedule } from '../useSchedule';
import { useBrandingSettings } from '../useBrandingSettings';

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) =>
  React.createElement(QueryClientProvider, { client }, children);

beforeEach(() => {
  vi.clearAllMocks();
  adminZugriff = true;
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  getAssignmentsByUser.mockResolvedValue([]);
  getAllShifts.mockResolvedValue([]);
  getShiftsByDateRange.mockResolvedValue([]);
  getAllFacilities.mockResolvedValue([]);
  getSettings.mockResolvedValue({
    id: 'main',
    companyName: 'AufAbruf GmbH',
    companyLogo: 'https://example.com/logo.png',
    primaryColor: '#123456',
    secondaryColor: '#654321',
    showLogo: true,
    customColors: true,
  });
});

describe('useSchedule', () => {
  const einsatz = (overrides: Record<string, unknown> = {}) => ({
    id: 'a1',
    userId: 'u1',
    shiftId: 's1',
    status: 'pending',
    assignedAt: new Date(2026, 6, 20),
    ...overrides,
  });

  it('lädt Einsätze, offene Schichten und Einrichtungen', async () => {
    const morgen = new Date();
    morgen.setDate(morgen.getDate() + 1);
    getAssignmentsByUser.mockResolvedValue([einsatz()]);
    getAllShifts.mockResolvedValue([
      { id: 's-alt', date: '2020-01-01', status: 'open' },
      { id: 's-neu', date: morgen.toISOString().slice(0, 10), status: 'open' },
    ]);
    getAllFacilities.mockResolvedValue([{ id: 'f1', name: 'Haus Sonnenschein' }]);

    const { result } = renderHook(() => useSchedule('week'), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await waitFor(() => expect(result.current.openShifts).toHaveLength(1));

    expect(result.current.assignments).toHaveLength(1);
    // Vergangene offene Schichten werden ausgeblendet
    expect(result.current.openShifts[0].id).toBe('s-neu');
    expect(result.current.facilities).toHaveLength(1);
    expect(getAllShifts).toHaveBeenCalledWith({ companyId: 'firmaA', status: 'open' });
  });

  it('lädt Schichten im Zeitraum je nach Ansicht', async () => {
    const { result } = renderHook(() => useSchedule('month', new Date(2026, 6, 15)), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await waitFor(() => expect(getShiftsByDateRange).toHaveBeenCalled());

    const [start, ende, companyId] = getShiftsByDateRange.mock.calls[0];
    expect((start as Date).getDate()).toBe(1);
    expect((ende as Date).getMonth()).toBe(6); // Monatsende Juli
    expect(companyId).toBe('firmaA');
  });

  it('nimmt einen Einsatz an und lehnt einen ab', async () => {
    acceptAssignment.mockResolvedValue(undefined);
    declineAssignment.mockResolvedValue(undefined);
    const { result } = renderHook(() => useSchedule(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.acceptAssignment.mutateAsync('a1');
      await result.current.declineAssignment.mutateAsync('a2');
    });
    expect(acceptAssignment).toHaveBeenCalledWith('a1');
    expect(declineAssignment).toHaveBeenCalledWith('a2');
  });

  it('filtert Einsätze nach Status und Zeitraum', async () => {
    getAssignmentsByUser.mockResolvedValue([
      einsatz(),
      einsatz({ id: 'a2', status: 'accepted', assignedAt: new Date(2026, 6, 22) }),
    ]);
    const { result } = renderHook(() => useSchedule(), { wrapper });
    await waitFor(() => expect(result.current.assignments).toHaveLength(2));

    expect(result.current.getAssignmentsByStatus('accepted')).toHaveLength(1);
    expect(
      result.current.getAssignmentsForDateRange(new Date(2026, 6, 21), new Date(2026, 6, 23))
    ).toHaveLength(1);
  });

  it('erkennt Konflikte mit bereits angenommenen Einsätzen', async () => {
    getAssignmentsByUser.mockResolvedValue([einsatz({ id: 'a2', status: 'accepted' })]);
    const { result } = renderHook(() => useSchedule(), { wrapper });
    await waitFor(() => expect(result.current.assignments).toHaveLength(1));

    expect(result.current.checkConflicts({ id: 'neu', status: 'pending' })).toBe(true);
    expect(result.current.checkConflicts({ id: 'a2', status: 'accepted' })).toBe(false);
  });

  it('liefert Farben für Schichttyp und Status', () => {
    const { result } = renderHook(() => useSchedule(), { wrapper });
    expect(result.current.getShiftTypeColor('Frühdienst')).toBe('#0288D1');
    expect(result.current.getShiftTypeColor('Nachtdienst')).toBe('#7B1FA2');
    expect(result.current.getShiftTypeColor('anders')).toBe('#666');
    expect(result.current.getStatusColor('pending')).toBe('warning');
    expect(result.current.getStatusColor('accepted')).toBe('success');
    expect(result.current.getStatusColor('declined')).toBe('error');
    expect(result.current.getStatusColor('completed')).toBe('info');
    expect(result.current.getStatusColor('anders')).toBe('default');
  });
});

describe('useBrandingSettings', () => {
  it('lädt die Branding-Einstellungen für Admins', async () => {
    const { result } = renderHook(() => useBrandingSettings('admin1'), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.branding).toMatchObject({
      companyName: 'AufAbruf GmbH',
      primaryColor: '#123456',
      showLogo: true,
    });
  });

  it('liefert Nicht-Admins sofort die Standardwerte ohne Firestore-Zugriff', async () => {
    adminZugriff = false;
    const { result } = renderHook(() => useBrandingSettings(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.branding).toMatchObject({ id: 'default', companyName: 'Schichtklar' });
    expect(getSettings).not.toHaveBeenCalled();
  });

  it('fällt bei Ladefehlern auf die Standardwerte zurück', async () => {
    getSettings.mockRejectedValue(new Error('permission-denied'));
    const { result } = renderHook(() => useBrandingSettings('admin1'), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.branding).toMatchObject({ id: 'default', showLogo: true });
  });

  it('speichert Branding-Änderungen', async () => {
    updateBrandingSettings.mockResolvedValue(undefined);
    const { result } = renderHook(() => useBrandingSettings('admin1'), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.updateBranding({ companyName: 'Neu GmbH', showLogo: false });
    });
    expect(updateBrandingSettings).toHaveBeenCalledWith(
      expect.objectContaining({ companyName: 'Neu GmbH', showLogo: false }),
      'admin1'
    );
  });

  it('lädt ein Logo hoch und entfernt es wieder', async () => {
    uploadLogo.mockResolvedValue('https://example.com/neu.png');
    deleteLogo.mockResolvedValue(undefined);
    const { result } = renderHook(() => useBrandingSettings('admin1'), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const datei = new File(['x'], 'logo.png', { type: 'image/png' });
    await act(async () => {
      await result.current.uploadLogo(datei);
      await result.current.deleteLogo();
    });
    expect(uploadLogo).toHaveBeenCalledWith(datei, 'admin1');
    expect(deleteLogo).toHaveBeenCalledWith('admin1');
  });

  it('verweigert den Logo-Upload ohne Benutzerkontext', async () => {
    const { result } = renderHook(() => useBrandingSettings(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const datei = new File(['x'], 'logo.png', { type: 'image/png' });
    await expect(
      act(async () => {
        await result.current.uploadLogo(datei);
      })
    ).rejects.toThrow('Kein Benutzerkontext');
  });
});
