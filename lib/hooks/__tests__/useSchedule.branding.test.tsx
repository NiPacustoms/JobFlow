import React, { type ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Branding-Hook (Logo, Farben) des Admin-Bereichs.
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
