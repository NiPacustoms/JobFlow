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
