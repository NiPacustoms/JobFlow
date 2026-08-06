import React, { type ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Profil-Hook (Stammdaten, Passwortwechsel, Validierungen) und der
 * Benachrichtigungs-Hook des Admin-Bereichs.
 */

const mockUser = { id: 'u1', companyId: 'firmaA', role: 'nurse' };
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));

const getUserById = vi.fn();
const updateUser = vi.fn();
vi.mock('@/lib/services/users', () => ({
  userService: {
    getById: (...a: unknown[]) => getUserById(...a),
    update: (...a: unknown[]) => updateUser(...a),
  },
}));

const reauthenticate = vi.fn();
const setPassword = vi.fn();
vi.mock('firebase/auth', () => ({
  EmailAuthProvider: { credential: vi.fn((email: string, pw: string) => ({ email, pw })) },
  reauthenticateWithCredential: (...a: unknown[]) => reauthenticate(...a),
  updatePassword: (...a: unknown[]) => setPassword(...a),
}));

vi.mock('@/lib/firebase', () => ({
  auth: { currentUser: { email: 'anna@aufabruf.eu' } },
}));

const getNotifications = vi.fn();
const markAsRead = vi.fn();
const markAsUnread = vi.fn();
const markAllAsRead = vi.fn();
const deleteNotification = vi.fn();
const deleteAll = vi.fn();
const updateNotifSettings = vi.fn();
vi.mock('@/lib/services/notifications', () => ({
  notificationService: {
    getAll: (...a: unknown[]) => getNotifications(...a),
    markAsRead: (...a: unknown[]) => markAsRead(...a),
    markAsUnread: (...a: unknown[]) => markAsUnread(...a),
    markAllAsRead: (...a: unknown[]) => markAllAsRead(...a),
    delete: (...a: unknown[]) => deleteNotification(...a),
    deleteAll: (...a: unknown[]) => deleteAll(...a),
    updateSettings: (...a: unknown[]) => updateNotifSettings(...a),
  },
}));

vi.mock('@/lib/utils/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { useProfile } from '../useProfile';
import { useNotifications } from '../useNotifications';

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) =>
  React.createElement(QueryClientProvider, { client }, children);

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  getUserById.mockResolvedValue({
    id: 'u1',
    displayName: 'Anna Muster',
    qualifications: ['Intensivpflege', 'Geriatrie'],
    documents: [{ id: 'd1' }],
  });
  updateUser.mockResolvedValue(undefined);
  getNotifications.mockResolvedValue([]);
});

describe('useProfile', () => {
  it('lädt das Profil und berechnet Kennzahlen', async () => {
    const { result } = renderHook(() => useProfile(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.profile).toMatchObject({ id: 'u1', displayName: 'Anna Muster' });
    expect(result.current.getUserStats()).toMatchObject({
      totalDocuments: 1,
      qualifications: 2,
    });
  });

  it('aktualisiert das Profil', async () => {
    const { result } = renderHook(() => useProfile(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.updateProfile({ displayName: 'Anna Neu' } as never);
    });
    expect(updateUser).toHaveBeenCalledWith('u1', { displayName: 'Anna Neu' });
  });

  it('ändert das Passwort nach erneuter Anmeldung', async () => {
    reauthenticate.mockResolvedValue(undefined);
    setPassword.mockResolvedValue(undefined);
    const { result } = renderHook(() => useProfile(), { wrapper });

    await act(async () => {
      await result.current.updatePassword({ currentPassword: 'alt', newPassword: 'neu12345' });
    });
    expect(reauthenticate).toHaveBeenCalled();
    expect(setPassword).toHaveBeenCalledWith(expect.anything(), 'neu12345');
  });

  it('meldet ein falsches aktuelles Passwort verständlich', async () => {
    reauthenticate.mockRejectedValue({ code: 'auth/wrong-password' });
    const { result } = renderHook(() => useProfile(), { wrapper });

    await expect(
      act(async () => {
        await result.current.updatePassword({ currentPassword: 'falsch', newPassword: 'neu12345' });
      })
    ).rejects.toThrow('Aktuelles Passwort ist falsch');
  });

  it('meldet sonstige Passwortfehler allgemein', async () => {
    reauthenticate.mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => useProfile(), { wrapper });

    await expect(
      act(async () => {
        await result.current.updatePassword({ currentPassword: 'alt', newPassword: 'neu12345' });
      })
    ).rejects.toThrow('Fehler beim Ändern des Passworts');
  });

  it('speichert Benachrichtigungseinstellungen am Profil', async () => {
    const { result } = renderHook(() => useProfile(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.updateNotificationSettings({ email: true } as never);
    });
    expect(updateUser).toHaveBeenCalledWith('u1', { notificationSettings: { email: true } });
  });

  it('liefert Farben für Qualifikationen inkl. Fallback', () => {
    const { result } = renderHook(() => useProfile(), { wrapper });
    expect(result.current.getQualificationColor('Intensivpflege')).toBe('#FF5722');
    expect(result.current.getQualificationColor('Unbekannt')).toBe('#666');
  });

  it('formatiert deutsche Telefonnummern', () => {
    const { result } = renderHook(() => useProfile(), { wrapper });
    expect(result.current.formatPhoneNumber('49171234567')).toBe('+49 171 234 567');
    expect(result.current.formatPhoneNumber('030 123')).toBe('030 123');
  });

  it('validiert E-Mail und Telefonnummer', () => {
    const { result } = renderHook(() => useProfile(), { wrapper });
    expect(result.current.validateEmail('anna@aufabruf.eu')).toBe(true);
    expect(result.current.validateEmail('keine-mail')).toBe(false);
    expect(result.current.validatePhone('+49 171 2345678')).toBe(true);
    expect(result.current.validatePhone('12ab')).toBe(false);
  });
});

describe('useNotifications', () => {
  const hinweis = (overrides: Record<string, unknown> = {}) => ({
    id: 'n1',
    title: 'Schichtänderung',
    message: 'Frühdienst beginnt 06:00',
    type: 'info',
    read: false,
    important: false,
    userId: 'u1',
    createdAt: new Date(2026, 6, 20),
    updatedAt: new Date(2026, 6, 20),
    ...overrides,
  });

  it('lädt Benachrichtigungen und berechnet die Statistik', async () => {
    getNotifications.mockResolvedValue([
      hinweis(),
      hinweis({ id: 'n2', read: true, important: true }),
    ]);
    const { result } = renderHook(() => useNotifications(), { wrapper });
    await waitFor(() => expect(result.current.notifications).toHaveLength(2));

    expect(result.current.getNotificationStats()).toEqual({
      total: 2,
      unread: 1,
      read: 1,
      important: 1,
    });
  });

  it('markiert als gelesen und wieder ungelesen', async () => {
    markAsRead.mockResolvedValue(undefined);
    markAsUnread.mockResolvedValue(undefined);
    const { result } = renderHook(() => useNotifications(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.markAsRead('n1');
      await result.current.markAsUnread('n1');
    });
    expect(markAsRead).toHaveBeenCalledWith('n1');
    expect(markAsUnread).toHaveBeenCalledWith('n1');
  });

  it('markiert alle als gelesen', async () => {
    markAllAsRead.mockResolvedValue(undefined);
    const { result } = renderHook(() => useNotifications(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.markAllAsRead();
    });
    expect(markAllAsRead).toHaveBeenCalledWith('u1');
  });

  it('löscht einzelne und alle Benachrichtigungen', async () => {
    deleteNotification.mockResolvedValue(undefined);
    deleteAll.mockResolvedValue(undefined);
    const { result } = renderHook(() => useNotifications(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.deleteNotification('n1');
      await result.current.deleteAllNotifications();
    });
    expect(deleteNotification).toHaveBeenCalledWith('n1');
    expect(deleteAll).toHaveBeenCalledWith('u1');
  });

  it('speichert Einstellungen', async () => {
    updateNotifSettings.mockResolvedValue(undefined);
    const { result } = renderHook(() => useNotifications(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.updateNotificationSettings({ emailEnabled: false });
    });
    expect(updateNotifSettings).toHaveBeenCalledWith('u1', { emailEnabled: false });
  });

  it('meldet Fehler beim Markieren über den Toast', async () => {
    markAsRead.mockRejectedValue(new Error('kein Zugriff'));
    const { result } = renderHook(() => useNotifications(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await expect(
      act(async () => {
        await result.current.markAsRead('n1');
      })
    ).rejects.toThrow('kein Zugriff');
    const { toast } = await import('@/lib/utils/toast');
    expect(toast.error).toHaveBeenCalled();
  });
});
