import React, { type ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Schnell-Erfassungs-Hook (Tagesnachweis inkl. Nachtschicht-Rollover) und
 * der Push-Benachrichtigungs-Hook des Mitarbeiters.
 */

const mockUser = { id: 'u1', companyId: 'firmaA', role: 'nurse' };
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));

const getByDate = vi.fn();
const getTimesheetsByUser = vi.fn();
const createTimesheet = vi.fn();
const updateTimesheet = vi.fn();
const submitTimesheet = vi.fn();
vi.mock('@/lib/services', () => ({
  timesheetService: {
    getByDate: (...a: unknown[]) => getByDate(...a),
    getByUserId: (...a: unknown[]) => getTimesheetsByUser(...a),
    create: (...a: unknown[]) => createTimesheet(...a),
    update: (...a: unknown[]) => updateTimesheet(...a),
    submit: (...a: unknown[]) => submitTimesheet(...a),
  },
}));

const getFCMToken = vi.fn();
const saveFCMToken = vi.fn();
const setupMessageListener = vi.fn();
const isPushSupported = vi.fn();
const requestNotificationPermission = vi.fn();
const sendPushNotification = vi.fn();
vi.mock('@/lib/services/pushNotifications', () => ({
  getFCMToken: (...a: unknown[]) => getFCMToken(...a),
  saveFCMToken: (...a: unknown[]) => saveFCMToken(...a),
  setupMessageListener: (...a: unknown[]) => setupMessageListener(...a),
  isPushNotificationSupported: (...a: unknown[]) => isPushSupported(...a),
  requestNotificationPermission: (...a: unknown[]) => requestNotificationPermission(...a),
  sendPushNotification: (...a: unknown[]) => sendPushNotification(...a),
}));

vi.mock('@/lib/utils/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock('@/lib/logging', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { useTimesheet } from '../useTimesheet';
import { usePushNotifications } from '../usePushNotifications';
import { toast } from '@/lib/utils/toast';

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) =>
  React.createElement(QueryClientProvider, { client }, children);

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  getByDate.mockResolvedValue(null);
  getTimesheetsByUser.mockResolvedValue([]);
  isPushSupported.mockReturnValue(true);
  getFCMToken.mockResolvedValue('fcm-1');
  saveFCMToken.mockResolvedValue(undefined);
  setupMessageListener.mockReturnValue(vi.fn());
  vi.stubGlobal('Notification', { permission: 'granted' });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useTimesheet', () => {
  it('lädt den Nachweis des Tages und die letzten Nachweise', async () => {
    getByDate.mockResolvedValue({ id: 't1', status: 'draft', startTime: '06:00' });
    getTimesheetsByUser.mockResolvedValue([{ id: 't0' }]);
    const { result } = renderHook(() => useTimesheet(new Date(2026, 6, 20)), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.timesheet).toMatchObject({ id: 't1' });
    expect(result.current.recentTimesheets).toHaveLength(1);
    expect(getTimesheetsByUser).toHaveBeenCalledWith('u1', 3);
  });

  it('greift ohne Datumsvorgabe auf die offene Nachtschicht des Vortags zurück', async () => {
    getByDate
      .mockResolvedValueOnce(null) // heute leer
      .mockResolvedValueOnce({ id: 'nacht', status: 'draft', startTime: '22:00', endTime: '' });
    const { result } = renderHook(() => useTimesheet(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.timesheet).toMatchObject({ id: 'nacht' });
    expect(getByDate).toHaveBeenCalledTimes(2);
  });

  it('übernimmt keine bereits abgeschlossene Vortagsschicht', async () => {
    getByDate
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'alt', status: 'draft', startTime: '22:00', endTime: '06:00' });
    const { result } = renderHook(() => useTimesheet(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.timesheet).toBeNull();
  });

  it('legt an, aktualisiert und reicht ein', async () => {
    createTimesheet.mockResolvedValue('t1');
    updateTimesheet.mockResolvedValue(undefined);
    submitTimesheet.mockResolvedValue(undefined);
    const { result } = renderHook(() => useTimesheet(new Date(2026, 6, 20)), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.createTimesheet.mutateAsync({ startTime: '06:00' } as never);
      await result.current.updateTimesheet.mutateAsync({ id: 't1', data: { endTime: '14:00' } });
      await result.current.submitTimesheet.mutateAsync('t1');
    });
    expect(createTimesheet).toHaveBeenCalledWith('u1', { startTime: '06:00' });
    expect(updateTimesheet).toHaveBeenCalledWith('t1', { endTime: '14:00' });
    expect(submitTimesheet).toHaveBeenCalledWith('t1');
  });

  it('berechnet die Gesamtstunden inkl. Nachtschicht über Mitternacht', () => {
    const { result } = renderHook(() => useTimesheet(new Date(2026, 6, 20)), { wrapper });

    expect(result.current.calculateTotalHours('06:00', '14:00', 30)).toBe(7.5);
    expect(result.current.calculateTotalHours('22:00', '06:00', 0)).toBe(8);
    expect(result.current.calculateTotalHours('', '14:00', 0)).toBe(0);
  });

  it('warnt bei zu kurzer Pause nach ArbZG', () => {
    const { result } = renderHook(() => useTimesheet(new Date(2026, 6, 20)), { wrapper });

    // > 6h Arbeit verlangt 30 Minuten Pause
    expect(result.current.needsBreakWarning(7 * 60, 15)).toBe(true);
    expect(result.current.needsBreakWarning(7 * 60, 30)).toBe(false);
    expect(result.current.needsBreakWarning(5 * 60, 0)).toBe(false);
  });
});

describe('usePushNotifications', () => {
  it('initialisiert bei erteilter Berechtigung und speichert den Token', async () => {
    const { result } = renderHook(() => usePushNotifications(), { wrapper });

    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    expect(result.current.isSupported).toBe(true);
    expect(result.current.token).toBe('fcm-1');
    expect(saveFCMToken).toHaveBeenCalledWith('u1', 'fcm-1');
    expect(setupMessageListener).toHaveBeenCalled();
  });

  it('zeigt eingehende Vordergrund-Nachrichten als Toast', async () => {
    let empfangen: ((payload: unknown) => void) | undefined;
    setupMessageListener.mockImplementation((cb: (payload: unknown) => void) => {
      empfangen = cb;
      return vi.fn();
    });
    const { result } = renderHook(() => usePushNotifications(), { wrapper });
    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    act(() => {
      empfangen?.({ notification: { title: 'Neue Schicht' }, data: { link: '/schedule' } });
    });
    expect(toast.info).toHaveBeenCalledWith('Neue Schicht');
  });

  it('initialisiert nicht ohne erteilte Berechtigung', async () => {
    vi.stubGlobal('Notification', { permission: 'default' });
    const { result } = renderHook(() => usePushNotifications(), { wrapper });

    await waitFor(() => expect(result.current.permission).toBe('default'));
    expect(getFCMToken).not.toHaveBeenCalled();
    expect(result.current.isInitialized).toBe(false);
  });

  it('fragt die Berechtigung auf Wunsch an und initialisiert danach', async () => {
    vi.stubGlobal('Notification', { permission: 'default' });
    requestNotificationPermission.mockResolvedValue('granted');
    const { result } = renderHook(() => usePushNotifications(), { wrapper });

    await act(async () => {
      const antwort = await result.current.requestPermission();
      expect(antwort).toBe('granted');
    });
    expect(requestNotificationPermission).toHaveBeenCalled();
  });

  it('versendet Push-Nachrichten für den angemeldeten Benutzer', async () => {
    sendPushNotification.mockResolvedValue(undefined);
    const { result } = renderHook(() => usePushNotifications(), { wrapper });
    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    await act(async () => {
      await result.current.sendNotification({ title: 'Hallo', body: 'Testnachricht' });
    });
    expect(sendPushNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', title: 'Hallo' })
    );
  });

  it('meldet fehlende Browser-Unterstützung', async () => {
    isPushSupported.mockReturnValue(false);
    const { result } = renderHook(() => usePushNotifications(), { wrapper });
    await waitFor(() => expect(result.current.isSupported).toBe(false));
    expect(getFCMToken).not.toHaveBeenCalled();
  });

  it('fängt Fehler beim Token-Abruf ab', async () => {
    getFCMToken.mockRejectedValue(new Error('kein Service Worker'));
    const { result } = renderHook(() => usePushNotifications(), { wrapper });

    await waitFor(() => expect(getFCMToken).toHaveBeenCalled());
    expect(result.current.isInitialized).toBe(false);
  });
});
