import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Firebase Cloud Messaging: Initialisierung, Berechtigungs-/Token-Fluss und
 * Token-Verwaltung am Benutzerdokument (max. 5 Geräte).
 */

const getMessagingMock = vi.fn(() => ({ app: 'messaging' }));
const getTokenMock = vi.fn(async () => 'fcm-token-1');
const onMessageMock = vi.fn(() => vi.fn());
vi.mock('firebase/messaging', () => ({
  getMessaging: (...a: unknown[]) => getMessagingMock(...a),
  getToken: (...a: unknown[]) => getTokenMock(...a),
  onMessage: (...a: unknown[]) => onMessageMock(...a),
}));

vi.mock('firebase/app', () => ({ getApp: vi.fn(() => ({ name: 'app' })) }));

const getDocMock = vi.fn();
const updateDocMock = vi.fn(async () => undefined);
vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db: unknown, sammlung: string, id: string) => ({ pfad: `${sammlung}/${id}` })),
  getDoc: (...a: unknown[]) => getDocMock(...a),
  updateDoc: (...a: unknown[]) => updateDocMock(...a),
}));

vi.mock('@/lib/firebase', () => ({ db: {}, getDb: vi.fn(() => ({})) }));
vi.mock('@/lib/logging', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const ladeModul = async () => await import('../fcmService');

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  getMessagingMock.mockReturnValue({ app: 'messaging' } as never);
  getTokenMock.mockResolvedValue('fcm-token-1');
  vi.stubEnv('NEXT_PUBLIC_FIREBASE_VAPID_KEY', 'vapid-123');
  vi.stubGlobal('Notification', {
    permission: 'granted',
    requestPermission: vi.fn(async () => 'granted'),
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('initMessaging', () => {
  it('initialisiert Messaging genau einmal', async () => {
    const { initMessaging } = await ladeModul();
    const erste = initMessaging();
    const zweite = initMessaging();
    expect(erste).toBe(zweite);
    expect(getMessagingMock).toHaveBeenCalledTimes(1);
  });

  it('liefert null, wenn Messaging nicht verfügbar ist', async () => {
    getMessagingMock.mockImplementation(() => {
      throw new Error('nicht unterstützt');
    });
    const { initMessaging } = await ladeModul();
    expect(initMessaging()).toBeNull();
  });
});

describe('requestNotificationPermission', () => {
  it('liefert den FCM-Token bei erteilter Berechtigung', async () => {
    const { requestNotificationPermission } = await ladeModul();
    await expect(requestNotificationPermission()).resolves.toBe('fcm-token-1');
    expect(getTokenMock).toHaveBeenCalledWith(expect.anything(), { vapidKey: 'vapid-123' });
  });

  it('fragt bei noch offener Berechtigung aktiv nach', async () => {
    const anfrage = vi.fn(async () => 'granted');
    vi.stubGlobal('Notification', { permission: 'default', requestPermission: anfrage });
    const { requestNotificationPermission } = await ladeModul();
    await expect(requestNotificationPermission()).resolves.toBe('fcm-token-1');
    expect(anfrage).toHaveBeenCalled();
  });

  it('liefert null bei verweigerter Berechtigung', async () => {
    vi.stubGlobal('Notification', {
      permission: 'denied',
      requestPermission: vi.fn(async () => 'denied'),
    });
    const { requestNotificationPermission } = await ladeModul();
    await expect(requestNotificationPermission()).resolves.toBeNull();
    expect(getTokenMock).not.toHaveBeenCalled();
  });

  it('liefert null ohne konfigurierten VAPID-Key', async () => {
    vi.stubEnv('NEXT_PUBLIC_FIREBASE_VAPID_KEY', '');
    const { requestNotificationPermission } = await ladeModul();
    await expect(requestNotificationPermission()).resolves.toBeNull();
  });

  it('liefert null, wenn Messaging nicht initialisierbar ist', async () => {
    getMessagingMock.mockImplementation(() => {
      throw new Error('nicht unterstützt');
    });
    const { requestNotificationPermission } = await ladeModul();
    await expect(requestNotificationPermission()).resolves.toBeNull();
  });

  it('fängt Fehler beim Token-Abruf ab', async () => {
    getTokenMock.mockRejectedValue(new Error('kein Service Worker'));
    const { requestNotificationPermission } = await ladeModul();
    await expect(requestNotificationPermission()).resolves.toBeNull();
  });
});

describe('saveFCMToken', () => {
  it('hängt einen neuen Token an und pflegt den Haupt-Token', async () => {
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({ fcmTokens: ['alt-1'] }),
    });
    const { saveFCMToken } = await ladeModul();
    await saveFCMToken('u1', 'neu-1');

    expect(updateDocMock).toHaveBeenCalledWith(
      expect.objectContaining({ pfad: 'users/u1' }),
      expect.objectContaining({ fcmToken: 'neu-1', fcmTokens: ['alt-1', 'neu-1'] })
    );
  });

  it('behält höchstens die letzten fünf Tokens', async () => {
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({ fcmTokens: ['t1', 't2', 't3', 't4', 't5'] }),
    });
    const { saveFCMToken } = await ladeModul();
    await saveFCMToken('u1', 't6');

    const update = updateDocMock.mock.calls[0][1] as { fcmTokens: string[] };
    expect(update.fcmTokens).toEqual(['t2', 't3', 't4', 't5', 't6']);
  });

  it('schreibt nichts, wenn der Token bereits registriert ist', async () => {
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({ fcmTokens: ['t1'] }),
    });
    const { saveFCMToken } = await ladeModul();
    await saveFCMToken('u1', 't1');
    expect(updateDocMock).not.toHaveBeenCalled();
  });

  it('wirft, wenn das Benutzerdokument fehlt', async () => {
    getDocMock.mockResolvedValue({ exists: () => false });
    const { saveFCMToken } = await ladeModul();
    await expect(saveFCMToken('u1', 't1')).rejects.toThrow('existiert nicht');
  });
});

describe('removeFCMToken', () => {
  it('entfernt den Token und rückt den Haupt-Token nach', async () => {
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({ fcmTokens: ['t1', 't2'] }),
    });
    const { removeFCMToken } = await ladeModul();
    await removeFCMToken('u1', 't1');

    expect(updateDocMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ fcmTokens: ['t2'], fcmToken: 't2' })
    );
  });

  it('setzt den Haupt-Token auf null, wenn kein Token übrig bleibt', async () => {
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({ fcmTokens: ['t1'] }),
    });
    const { removeFCMToken } = await ladeModul();
    await removeFCMToken('u1', 't1');

    expect(updateDocMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ fcmTokens: [], fcmToken: null })
    );
  });

  it('tut nichts, wenn das Benutzerdokument fehlt', async () => {
    getDocMock.mockResolvedValue({ exists: () => false });
    const { removeFCMToken } = await ladeModul();
    await removeFCMToken('u1', 't1');
    expect(updateDocMock).not.toHaveBeenCalled();
  });
});

describe('onMessageReceived', () => {
  it('registriert den Handler und liefert die Abmeldefunktion', async () => {
    const abmelden = vi.fn();
    onMessageMock.mockReturnValue(abmelden);
    const { onMessageReceived } = await ladeModul();
    const callback = vi.fn();

    expect(onMessageReceived(callback)).toBe(abmelden);
    expect(onMessageMock).toHaveBeenCalledWith(expect.anything(), callback);
  });

  it('liefert null, wenn Messaging fehlt oder die Registrierung scheitert', async () => {
    getMessagingMock.mockImplementation(() => {
      throw new Error('nicht unterstützt');
    });
    let modul = await ladeModul();
    expect(modul.onMessageReceived(vi.fn())).toBeNull();

    vi.resetModules();
    getMessagingMock.mockReturnValue({ app: 'messaging' } as never);
    onMessageMock.mockImplementation(() => {
      throw new Error('kaputt');
    });
    modul = await ladeModul();
    expect(modul.onMessageReceived(vi.fn())).toBeNull();
  });
});
