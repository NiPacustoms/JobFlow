import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

/**
 * FCM-Hook: Berechtigung prüfen, Token anfordern/speichern/entfernen und
 * eingehende Nachrichten als Browser-Benachrichtigung anzeigen.
 */

const mockUser: { id?: string } = { id: 'u1' };
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));

const requestNotificationPermission = vi.fn();
const saveFCMToken = vi.fn();
const removeFCMToken = vi.fn();
const onMessageReceived = vi.fn();
vi.mock('@/lib/services/fcmService', () => ({
  requestNotificationPermission: (...a: unknown[]) => requestNotificationPermission(...a),
  saveFCMToken: (...a: unknown[]) => saveFCMToken(...a),
  removeFCMToken: (...a: unknown[]) => removeFCMToken(...a),
  onMessageReceived: (...a: unknown[]) => onMessageReceived(...a),
}));

vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { useFCM } from '../useFCM';

const NotificationStub = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mockUser.id = 'u1';
  requestNotificationPermission.mockResolvedValue('fcm-token-1');
  saveFCMToken.mockResolvedValue(undefined);
  removeFCMToken.mockResolvedValue(undefined);
  onMessageReceived.mockReturnValue(vi.fn());

  const stub = Object.assign(NotificationStub, { permission: 'default' as NotificationPermission });
  vi.stubGlobal('Notification', stub);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Berechtigung und Token', () => {
  it('übernimmt die aktuelle Browser-Berechtigung', async () => {
    vi.stubGlobal('Notification', Object.assign(NotificationStub, { permission: 'denied' }));
    const { result } = renderHook(() => useFCM());
    await waitFor(() => expect(result.current.permission).toBe('denied'));
  });

  it('fordert den Token an und speichert ihn am Benutzer', async () => {
    const { result } = renderHook(() => useFCM());

    await act(async () => {
      const token = await result.current.requestToken();
      expect(token).toBe('fcm-token-1');
    });

    expect(saveFCMToken).toHaveBeenCalledWith('u1', 'fcm-token-1');
    await waitFor(() => expect(result.current.token).toBe('fcm-token-1'));
    expect(result.current.error).toBeNull();
  });

  it('fordert bei erteilter Berechtigung automatisch einen Token an', async () => {
    vi.stubGlobal('Notification', Object.assign(NotificationStub, { permission: 'granted' }));
    const { result } = renderHook(() => useFCM());

    await waitFor(() => expect(result.current.token).toBe('fcm-token-1'));
    expect(saveFCMToken).toHaveBeenCalled();
  });

  it('meldet einen Fehler ohne angemeldeten Benutzer', async () => {
    mockUser.id = undefined;
    const { result } = renderHook(() => useFCM());

    await act(async () => {
      const token = await result.current.requestToken();
      expect(token).toBeNull();
    });
    await waitFor(() => expect(result.current.error).toBe('User nicht angemeldet'));
    expect(requestNotificationPermission).not.toHaveBeenCalled();
  });

  it('meldet, wenn kein Token beschafft werden konnte', async () => {
    requestNotificationPermission.mockResolvedValue(null);
    const { result } = renderHook(() => useFCM());

    await act(async () => {
      await result.current.requestToken();
    });
    await waitFor(() =>
      expect(result.current.error).toBe('Token konnte nicht abgerufen werden')
    );
  });

  it('meldet Fehler beim Speichern des Tokens', async () => {
    saveFCMToken.mockRejectedValue(new Error('Rules verweigern'));
    const { result } = renderHook(() => useFCM());

    await act(async () => {
      const token = await result.current.requestToken();
      expect(token).toBeNull();
    });
    await waitFor(() => expect(result.current.error).toBe('Rules verweigern'));
  });
});

describe('Token entfernen', () => {
  it('entfernt einen vorhandenen Token', async () => {
    const { result } = renderHook(() => useFCM());
    await act(async () => {
      await result.current.requestToken();
    });
    await waitFor(() => expect(result.current.token).toBe('fcm-token-1'));

    await act(async () => {
      await result.current.removeToken();
    });
    expect(removeFCMToken).toHaveBeenCalledWith('u1', 'fcm-token-1');
    await waitFor(() => expect(result.current.token).toBeNull());
  });

  it('tut ohne Token nichts', async () => {
    const { result } = renderHook(() => useFCM());
    await act(async () => {
      await result.current.removeToken();
    });
    expect(removeFCMToken).not.toHaveBeenCalled();
  });

  it('meldet Fehler beim Entfernen', async () => {
    removeFCMToken.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useFCM());
    await act(async () => {
      await result.current.requestToken();
    });
    await waitFor(() => expect(result.current.token).toBe('fcm-token-1'));

    await act(async () => {
      await result.current.removeToken();
    });
    await waitFor(() => expect(result.current.error).toBe('offline'));
  });
});

describe('eingehende Nachrichten', () => {
  it('zeigt bei erteilter Berechtigung eine Browser-Benachrichtigung', async () => {
    vi.stubGlobal('Notification', Object.assign(NotificationStub, { permission: 'granted' }));
    let empfangen: ((payload: unknown) => void) | undefined;
    onMessageReceived.mockImplementation((cb: (payload: unknown) => void) => {
      empfangen = cb;
      return vi.fn();
    });

    renderHook(() => useFCM());
    act(() => {
      empfangen?.({
        notification: { title: 'Neue Schicht', body: 'Morgen 06:00' },
        data: { channelId: 'shifts' },
      });
    });

    expect(NotificationStub).toHaveBeenCalledWith(
      'Neue Schicht',
      expect.objectContaining({ body: 'Morgen 06:00', tag: 'shifts' })
    );
  });

  it('zeigt ohne Berechtigung keine Benachrichtigung', async () => {
    let empfangen: ((payload: unknown) => void) | undefined;
    onMessageReceived.mockImplementation((cb: (payload: unknown) => void) => {
      empfangen = cb;
      return vi.fn();
    });

    renderHook(() => useFCM());
    act(() => {
      empfangen?.({ notification: { title: 'x' } });
    });
    expect(NotificationStub).not.toHaveBeenCalled();
  });

  it('meldet den Handler beim Aufräumen ab', async () => {
    const abmelden = vi.fn();
    onMessageReceived.mockReturnValue(abmelden);

    const { unmount } = renderHook(() => useFCM());
    unmount();
    expect(abmelden).toHaveBeenCalled();
  });
});
