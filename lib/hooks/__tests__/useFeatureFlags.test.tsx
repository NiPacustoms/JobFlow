import React, { type ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Feature-Flags: Der Admin schaltet Bereiche frei; zusätzlich entscheidet die
 * Rolle. Ein für Mitarbeitende gedachtes Feature darf einem Admin nicht
 * denselben Zugang eröffnen und umgekehrt.
 */

const rolle = { wert: 'admin' as string };
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', companyId: 'firmaA', role: rolle.wert } }),
}));

const adminZugriff = { wert: true };
vi.mock('@/contexts/PermissionsContext', () => ({
  usePermissions: () => ({ canAccessAdminArea: adminZugriff.wert }),
}));

const getSettings = vi.fn();
vi.mock('@/lib/services/settingsService', () => ({
  settingsService: { getSettings: (...a: unknown[]) => getSettings(...a) },
}));

import { useFeatureFlags } from '../useFeatureFlags';
import { DEFAULT_FEATURE_FLAGS } from '@/lib/types/featureFlags';

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) =>
  React.createElement(QueryClientProvider, { client }, children);

const alleAn = {
  enableReports: true,
  enableAssignments: true,
  enableAuditLogs: true,
  enableTemplates: true,
  enableEmployeeDocuments: true,
  enableEmployeeReports: true,
  enableEmployeeAssignments: true,
  enableEmployeeFacilities: true,
  enableEmployeeNotifications: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  rolle.wert = 'admin';
  adminZugriff.wert = true;
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  getSettings.mockResolvedValue({ id: 'main', features: alleAn });
});

describe('Admin-Bereiche', () => {
  it('gibt einem Admin die freigeschalteten Admin-Bereiche', async () => {
    const { result } = renderHook(() => useFeatureFlags(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.canAccessAdminReports).toBe(true);
    expect(result.current.canAccessAssignments).toBe(true);
    expect(result.current.canAccessAuditLogs).toBe(true);
    expect(result.current.canAccessTemplates).toBe(true);
  });

  it('sperrt abgeschaltete Admin-Bereiche trotz Adminrechten', async () => {
    getSettings.mockResolvedValue({
      id: 'main',
      features: { ...alleAn, enableReports: false, enableAuditLogs: false },
    });
    const { result } = renderHook(() => useFeatureFlags(), { wrapper });
    await waitFor(() => expect(result.current.features.enableReports).toBe(false));

    expect(result.current.canAccessAdminReports).toBe(false);
    expect(result.current.canAccessAuditLogs).toBe(false);
    expect(result.current.canAccessAssignments).toBe(true);
  });

  it('sperrt Admin-Bereiche ohne Adminrechte', async () => {
    adminZugriff.wert = false;
    const { result } = renderHook(() => useFeatureFlags(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.canAccessAdminReports).toBe(false);
    expect(result.current.canAccessTemplates).toBe(false);
    // Die Flags selbst bleiben sichtbar, nur der Zugang ist gesperrt
    expect(result.current.adminFeatures.reports).toBe(true);
  });
});

describe('Mitarbeiter-Bereiche', () => {
  beforeEach(() => {
    rolle.wert = 'nurse';
    adminZugriff.wert = false;
  });

  it('gibt einer Pflegekraft die freigeschalteten Bereiche', async () => {
    const { result } = renderHook(() => useFeatureFlags(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.canAccessEmployeeDocuments).toBe(true);
    expect(result.current.canAccessEmployeeReports).toBe(true);
    expect(result.current.canAccessEmployeeAssignments).toBe(true);
    expect(result.current.canAccessEmployeeFacilities).toBe(true);
    expect(result.current.canAccessEmployeeNotifications).toBe(true);
  });

  it('sperrt abgeschaltete Mitarbeiter-Bereiche', async () => {
    getSettings.mockResolvedValue({
      id: 'main',
      features: { ...alleAn, enableEmployeeFacilities: false },
    });
    const { result } = renderHook(() => useFeatureFlags(), { wrapper });
    await waitFor(() => expect(result.current.features.enableEmployeeFacilities).toBe(false));

    expect(result.current.canAccessEmployeeFacilities).toBe(false);
    expect(result.current.canAccessEmployeeDocuments).toBe(true);
  });

  it('gibt einem Admin keine Mitarbeiter-Bereiche', async () => {
    rolle.wert = 'admin';
    adminZugriff.wert = true;
    const { result } = renderHook(() => useFeatureFlags(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.canAccessEmployeeDocuments).toBe(false);
    expect(result.current.canAccessEmployeeNotifications).toBe(false);
  });
});

describe('Fallbacks', () => {
  it('nutzt die Standard-Flags, solange nichts geladen ist', async () => {
    // Platzhalterdaten greifen sofort, noch vor der Antwort
    getSettings.mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() => useFeatureFlags(), { wrapper });

    expect(result.current.features).toEqual(DEFAULT_FEATURE_FLAGS);
  });

  it('fällt bei fehlenden Features auf die Standardwerte zurück', async () => {
    getSettings.mockResolvedValue({ id: 'main' });
    const { result } = renderHook(() => useFeatureFlags(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.features).toEqual(DEFAULT_FEATURE_FLAGS);
  });

  it('meldet einen Ladefehler und bleibt bei den Standardwerten', async () => {
    getSettings.mockRejectedValue(new Error('kein Zugriff'));
    const { result } = renderHook(() => useFeatureFlags(), { wrapper });
    await waitFor(() => expect(result.current.error).toBeTruthy());

    expect(result.current.features).toEqual(DEFAULT_FEATURE_FLAGS);
  });

  it('meldet unbekannte Flags als abgeschaltet', async () => {
    const { result } = renderHook(() => useFeatureFlags(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isFeatureEnabled('gibtEsNicht' as never)).toBe(false);
    expect(result.current.isFeatureEnabled('enableReports')).toBe(true);
  });
});
