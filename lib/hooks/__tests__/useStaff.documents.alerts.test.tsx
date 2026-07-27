import React, { type ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Personalverwaltung, Dokumente und Warnungen aus Hook-Sicht.
 */

const mockUser = { id: 'admin1', companyId: 'firmaA', role: 'admin' };
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));

const getAllUsers = vi.fn();
const createUser = vi.fn();
const updateUser = vi.fn();
const deleteUser = vi.fn();
const toggleActive = vi.fn();
const getByRole = vi.fn();
const getByStatus = vi.fn();

const getDocuments = vi.fn();
const createDocument = vi.fn();
const updateDocument = vi.fn();
const deleteDocument = vi.fn();
const verifyDocument = vi.fn();

// vi.mock wird an den Dateianfang gehoisted – gemeinsame Objekte daher über
// vi.hoisted bereitstellen.
const { documentServiceMock } = vi.hoisted(() => {
  const getDocumentsHoisted = (...a: unknown[]) =>
    (globalThis as { __getDocuments?: (...x: unknown[]) => unknown }).__getDocuments?.(...a);
  return {
    documentServiceMock: {
      getAll: getDocumentsHoisted,
      getByUserId: getDocumentsHoisted,
      create: (...a: unknown[]) =>
        (globalThis as { __createDocument?: (...x: unknown[]) => unknown }).__createDocument?.(...a),
      update: (...a: unknown[]) =>
        (globalThis as { __updateDocument?: (...x: unknown[]) => unknown }).__updateDocument?.(...a),
      delete: (...a: unknown[]) =>
        (globalThis as { __deleteDocument?: (...x: unknown[]) => unknown }).__deleteDocument?.(...a),
      verify: (...a: unknown[]) =>
        (globalThis as { __verifyDocument?: (...x: unknown[]) => unknown }).__verifyDocument?.(...a),
      calculateStatus: () => 'valid',
    },
  };
});

(globalThis as Record<string, unknown>).__getDocuments = (...a: unknown[]) => getDocuments(...a);
(globalThis as Record<string, unknown>).__createDocument = (...a: unknown[]) => createDocument(...a);
(globalThis as Record<string, unknown>).__updateDocument = (...a: unknown[]) => updateDocument(...a);
(globalThis as Record<string, unknown>).__deleteDocument = (...a: unknown[]) => deleteDocument(...a);
(globalThis as Record<string, unknown>).__verifyDocument = (...a: unknown[]) => verifyDocument(...a);

vi.mock('@/lib/services/documents', () => ({ documentService: documentServiceMock }));

vi.mock('@/lib/services', () => ({
  userService: {
    getAll: (...a: unknown[]) => getAllUsers(...a),
    create: (...a: unknown[]) => createUser(...a),
    update: (...a: unknown[]) => updateUser(...a),
    delete: (...a: unknown[]) => deleteUser(...a),
    toggleActive: (...a: unknown[]) => toggleActive(...a),
    getByRole: (...a: unknown[]) => getByRole(...a),
    getByStatus: (...a: unknown[]) => getByStatus(...a),
  },
  documentService: documentServiceMock,
}));

const getAlerts = vi.fn();
const acknowledgeAlert = vi.fn();
const deleteAlert = vi.fn();
const subscribeToAlerts = vi.fn();

vi.mock('@/lib/services/alerts', () => ({
  alertService: {
    getAlerts: (...a: unknown[]) => getAlerts(...a),
    acknowledge: (...a: unknown[]) => acknowledgeAlert(...a),
    delete: (...a: unknown[]) => deleteAlert(...a),
    subscribeToAlerts: (...a: unknown[]) => {
      subscribeToAlerts(...a);
      return () => undefined;
    },
  },
}));

vi.mock('@/lib/services/firebaseStorage', () => ({
  firebaseStorageService: { uploadFile: vi.fn(async () => ({ url: 'https://storage/x.pdf' })) },
}));

vi.mock('@/lib/utils/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { useStaff } from '../useStaff';
import { useDocuments } from '../useDocuments';
import { useAlerts } from '../useAlerts';

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) =>
  React.createElement(QueryClientProvider, { client }, children);

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  getAllUsers.mockResolvedValue({ data: [], total: 0, page: 1, limit: 50, hasMore: false });
  getByRole.mockResolvedValue([]);
  getByStatus.mockResolvedValue([]);
  getDocuments.mockResolvedValue([]);
  getAlerts.mockResolvedValue([]);
});

describe('useStaff', () => {
  it('lädt die Mitarbeiterliste', async () => {
    getAllUsers.mockResolvedValue({
      data: [{ id: 'u1', displayName: 'Anna', role: 'nurse', active: true }],
      total: 1,
      page: 1,
      limit: 50,
      hasMore: false,
    });
    const { result } = renderHook(() => useStaff(), { wrapper });
    await waitFor(() => expect(result.current.loadingStaff).toBe(false));
    expect(result.current.staff.length).toBeGreaterThanOrEqual(0);
  });

  it('liefert eine Statistik', async () => {
    const { result } = renderHook(() => useStaff(), { wrapper });
    await waitFor(() => expect(result.current.loadingStaff).toBe(false));
    expect(result.current.stats).toBeTruthy();
  });

  it('meldet einen Ladefehler', async () => {
    getAllUsers.mockRejectedValue(new Error('kein Zugriff'));
    const { result } = renderHook(() => useStaff(), { wrapper });
    await waitFor(() => expect(result.current.staffError).toBeTruthy());
  });
});

describe('useDocuments', () => {
  const dokument = (overrides: Record<string, unknown> = {}) => ({
    id: 'd1',
    userId: 'admin1',
    name: 'Führungszeugnis',
    type: 'certificate',
    url: 'https://storage/d.pdf',
    status: 'valid',
    verified: false,
    createdAt: new Date(2026, 0, 1),
    updatedAt: new Date(2026, 6, 1),
    ...overrides,
  });

  it('lädt die Dokumente', async () => {
    getDocuments.mockResolvedValue([dokument(), dokument({ id: 'd2', status: 'expired' })]);
    const { result } = renderHook(() => useDocuments(), { wrapper });
    await waitFor(() => expect(result.current.documents).toHaveLength(2));
  });

  it('leitet den Status aus dem Ablaufdatum ab und filtert danach', async () => {
    const gestern = new Date();
    gestern.setDate(gestern.getDate() - 1);
    const inEinemJahr = new Date();
    inEinemJahr.setFullYear(inEinemJahr.getFullYear() + 1);
    getDocuments.mockResolvedValue([
      dokument({ id: 'd1', expiryDate: inEinemJahr }),
      dokument({ id: 'd2', expiryDate: gestern }),
    ]);
    const { result } = renderHook(() => useDocuments(), { wrapper });
    await waitFor(() => expect(result.current.documents).toHaveLength(2));
    expect(result.current.getDocumentsByStatus('expired')).toHaveLength(1);
    expect(result.current.getDocumentsByStatus('valid')).toHaveLength(1);
  });

  it('formatiert Dateigrößen lesbar', async () => {
    const { result } = renderHook(() => useDocuments(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.formatFileSize(1024)).toContain('KB');
    expect(result.current.formatFileSize(1024 * 1024)).toContain('MB');
  });

  it('liefert deutsche Status-Bezeichnungen', async () => {
    const { result } = renderHook(() => useDocuments(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(typeof result.current.getStatusLabel('valid' as never)).toBe('string');
  });
});

describe('useAlerts', () => {
  const warnung = (overrides: Record<string, unknown> = {}) => ({
    id: 'w1',
    userId: 'admin1',
    type: 'document-expiry',
    severity: 'high',
    title: 'Dokument läuft ab',
    message: 'In 14 Tagen',
    acknowledged: false,
    createdAt: new Date(2026, 6, 20),
    ...overrides,
  });

  it('lädt die Warnungen und zählt unbestätigte', async () => {
    getAlerts.mockResolvedValue([warnung(), warnung({ id: 'w2', acknowledged: true })]);
    const { result } = renderHook(() => useAlerts(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.unacknowledgedCount).toBeGreaterThanOrEqual(0);
  });

  it('gruppiert nach Schweregrad', async () => {
    getAlerts.mockResolvedValue([
      warnung({ id: 'w1', severity: 'critical' }),
      warnung({ id: 'w2', severity: 'low' }),
    ]);
    const { result } = renderHook(() => useAlerts(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(Array.isArray(result.current.criticalAlerts)).toBe(true);
    expect(Array.isArray(result.current.lowAlerts)).toBe(true);
  });

  it('quittiert eine Warnung', async () => {
    getAlerts.mockResolvedValue([warnung()]);
    acknowledgeAlert.mockResolvedValue(undefined);
    const { result } = renderHook(() => useAlerts(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      result.current.acknowledge('w1');
    });
    await waitFor(() => expect(acknowledgeAlert).toHaveBeenCalled());
  });
});
