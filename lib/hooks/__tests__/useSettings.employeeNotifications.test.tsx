import React, { type ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Einstellungs-Hook (System, Rollen, Dokumenttypen) und der
 * Benachrichtigungs-Posteingang des Mitarbeiters.
 */

const mockUser = { id: 'u1', companyId: 'firmaA', role: 'nurse' };
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));

const getSettingsAll = vi.fn();
const updateSection = vi.fn();
const createUserRole = vi.fn();
const updateUserRole = vi.fn();
const deleteUserRole = vi.fn();
const createDocType = vi.fn();
const updateDocType = vi.fn();
const deleteDocType = vi.fn();

vi.mock('@/lib/services/settings', () => ({
  settingsService: {
    getAll: (...a: unknown[]) => getSettingsAll(...a),
    updateSection: (...a: unknown[]) => updateSection(...a),
    createUserRole: (...a: unknown[]) => createUserRole(...a),
    updateUserRole: (...a: unknown[]) => updateUserRole(...a),
    deleteUserRole: (...a: unknown[]) => deleteUserRole(...a),
    createDocumentType: (...a: unknown[]) => createDocType(...a),
    updateDocumentType: (...a: unknown[]) => updateDocType(...a),
    deleteDocumentType: (...a: unknown[]) => deleteDocType(...a),
    exportSettings: vi.fn(async () => new Blob(['{}'])),
    importSettings: vi.fn(async () => undefined),
    initializeDefaultSettings: vi.fn(async () => undefined),
  },
}));

const getNotifications = vi.fn();
const getNotifSettings = vi.fn();
const markAsRead = vi.fn();
const markAllAsRead = vi.fn();
const deleteNotification = vi.fn();
const updateNotifSettings = vi.fn();
const getUnreadCount = vi.fn();

vi.mock('@/lib/services/employeeNotifications', () => ({
  employeeNotificationsService: {
    getAll: (...a: unknown[]) => getNotifications(...a),
    getSettings: (...a: unknown[]) => getNotifSettings(...a),
    markAsRead: (...a: unknown[]) => markAsRead(...a),
    markAsUnread: vi.fn(async () => undefined),
    markAllAsRead: (...a: unknown[]) => markAllAsRead(...a),
    deleteNotification: (...a: unknown[]) => deleteNotification(...a),
    deleteAllNotifications: vi.fn(async () => undefined),
    updateSettings: (...a: unknown[]) => updateNotifSettings(...a),
    getUnreadCount: (...a: unknown[]) => getUnreadCount(...a),
    starNotification: vi.fn(async () => undefined),
    unstarNotification: vi.fn(async () => undefined),
    archiveNotification: vi.fn(async () => undefined),
  },
}));

vi.mock('@/lib/utils/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { useSettings } from '../useSettings';
import { useEmployeeNotifications } from '../useEmployeeNotifications';

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) =>
  React.createElement(QueryClientProvider, { client }, children);

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  getSettingsAll.mockResolvedValue({
    general: { systemName: 'Schichtklar' },
    userRoles: [],
    documentTypes: [],
  });
  getNotifications.mockResolvedValue([]);
  getNotifSettings.mockResolvedValue({ emailNotifications: true });
  getUnreadCount.mockResolvedValue(0);
});

describe('useSettings', () => {
  it('lädt die Einstellungen', async () => {
    const { result } = renderHook(() => useSettings(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.settings).toBeTruthy();
  });

  it('aktualisiert einen Bereich', async () => {
    updateSection.mockResolvedValue(undefined);
    const { result } = renderHook(() => useSettings(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.updateSettings('general' as never, { systemName: 'Neu' } as never);
    });
    expect(updateSection).toHaveBeenCalled();
  });

  it('verwaltet Nutzerrollen', async () => {
    createUserRole.mockResolvedValue('r1');
    deleteUserRole.mockResolvedValue(undefined);
    const { result } = renderHook(() => useSettings(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.createUserRole({ name: 'Disponent' } as never);
      await result.current.deleteUserRole('r1');
    });
    expect(createUserRole).toHaveBeenCalled();
    expect(deleteUserRole).toHaveBeenCalledWith('r1');
  });

  it('meldet einen Ladefehler', async () => {
    getSettingsAll.mockRejectedValue(new Error('kein Zugriff'));
    const { result } = renderHook(() => useSettings(), { wrapper });
    await waitFor(() => expect(result.current.error).toBeTruthy());
  });
});

describe('useEmployeeNotifications', () => {
  const hinweis = (overrides: Record<string, unknown> = {}) => ({
    id: 'n1',
    userId: 'u1',
    title: 'Neue Schicht',
    message: 'Morgen 06:00',
    type: 'shift',
    priority: 'medium',
    read: false,
    starred: false,
    archived: false,
    createdAt: new Date(2026, 6, 20),
    updatedAt: new Date(2026, 6, 20),
    ...overrides,
  });

  it('lädt Posteingang und Einstellungen', async () => {
    getNotifications.mockResolvedValue([hinweis(), hinweis({ id: 'n2', read: true })]);
    const { result } = renderHook(() => useEmployeeNotifications(), { wrapper });
    await waitFor(() => expect(result.current.notifications).toHaveLength(2));
    expect(result.current.settings.emailNotifications).toBe(true);
  });

  it('liefert Standardeinstellungen, solange nichts geladen ist', async () => {
    getNotifSettings.mockResolvedValue(null);
    const { result } = renderHook(() => useEmployeeNotifications(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.settings.quietHoursStart).toBe('22:00');
  });

  it('markiert eine Benachrichtigung als gelesen', async () => {
    getNotifications.mockResolvedValue([hinweis()]);
    markAsRead.mockResolvedValue(undefined);
    const { result } = renderHook(() => useEmployeeNotifications(), { wrapper });
    await waitFor(() => expect(result.current.notifications).toHaveLength(1));

    await act(async () => {
      await result.current.markAsRead('n1');
    });
    expect(markAsRead).toHaveBeenCalledWith('n1');
  });

  it('markiert alle als gelesen', async () => {
    markAllAsRead.mockResolvedValue(undefined);
    const { result } = renderHook(() => useEmployeeNotifications(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.markAllAsRead();
    });
    expect(markAllAsRead).toHaveBeenCalled();
  });

  it('löscht eine Benachrichtigung', async () => {
    getNotifications.mockResolvedValue([hinweis()]);
    deleteNotification.mockResolvedValue(undefined);
    const { result } = renderHook(() => useEmployeeNotifications(), { wrapper });
    await waitFor(() => expect(result.current.notifications).toHaveLength(1));

    await act(async () => {
      await result.current.deleteNotification('n1');
    });
    expect(deleteNotification).toHaveBeenCalledWith('n1');
  });

  it('speichert geänderte Einstellungen', async () => {
    updateNotifSettings.mockResolvedValue(undefined);
    const { result } = renderHook(() => useEmployeeNotifications(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.updateNotificationSettings({ emailNotifications: false } as never);
    });
    expect(updateNotifSettings).toHaveBeenCalled();
  });
});
