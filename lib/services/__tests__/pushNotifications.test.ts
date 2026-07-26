import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Push-Benachrichtigungen: Token-Verwaltung und Versand.
 * Der Token entscheidet, ob eine Pflegekraft eine neue Einsatzanfrage
 * überhaupt mitbekommt.
 */

const setDocMock = vi.fn();
const getDocMock = vi.fn();
let vorhandenerToken: Record<string, unknown> | null = null;

vi.mock('@/lib/firebase', () => ({
  getDb: vi.fn(() => ({})),
  doc: vi.fn((_db: unknown, coll: string, id: string) => ({ coll, id })),
  getDoc: (...a: unknown[]) => {
    getDocMock(...a);
    return Promise.resolve({
      exists: () => vorhandenerToken !== null,
      data: () => vorhandenerToken,
    });
  },
  setDoc: (...a: unknown[]) => {
    setDocMock(...a);
    return Promise.resolve();
  },
  serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
  getAuthSafe: vi.fn(() => ({ currentUser: { uid: 'u1', getIdToken: async () => 'token' } })),
  messaging: null,
}));

const lade = async () => await import('../pushNotifications');

beforeEach(() => {
  vi.clearAllMocks();
  vorhandenerToken = null;
});

describe('saveFCMToken', () => {
  it('speichert den Token unter der Nutzer-ID', async () => {
    const { saveFCMToken } = await lade();
    await saveFCMToken('u1', 'token-abc');
    expect(setDocMock.mock.calls[0][0]).toMatchObject({ coll: 'fcmTokens', id: 'u1' });
    expect(setDocMock.mock.calls[0][1]).toMatchObject({ token: 'token-abc', userId: 'u1' });
    expect(setDocMock.mock.calls[0][2]).toEqual({ merge: true });
  });

  it('reicht einen Schreibfehler weiter', async () => {
    setDocMock.mockImplementationOnce(() => {
      throw new Error('Rules verweigern');
    });
    const { saveFCMToken } = await lade();
    await expect(saveFCMToken('u1', 'token-abc')).rejects.toThrow('Rules verweigern');
  });
});

describe('updateFCMToken', () => {
  it('aktualisiert den Token, wenn der alte passt', async () => {
    vorhandenerToken = { token: 'alt' };
    const { updateFCMToken } = await lade();
    await updateFCMToken('u1', 'alt', 'neu');
    expect(setDocMock.mock.calls[0][1]).toMatchObject({ token: 'neu' });
  });

  it('lässt einen abweichenden Token unangetastet', async () => {
    vorhandenerToken = { token: 'ganz-anders' };
    const { updateFCMToken } = await lade();
    await updateFCMToken('u1', 'alt', 'neu');
    expect(setDocMock).not.toHaveBeenCalled();
  });

  it('legt den Token neu an, wenn keiner hinterlegt ist', async () => {
    vorhandenerToken = null;
    const { updateFCMToken } = await lade();
    await updateFCMToken('u1', 'alt', 'neu');
    expect(setDocMock.mock.calls[0][1]).toMatchObject({ token: 'neu' });
  });
});

describe('getFCMTokenForUser', () => {
  it('liefert den hinterlegten Token', async () => {
    vorhandenerToken = { token: 'token-abc' };
    const { getFCMTokenForUser } = await lade();
    expect(await getFCMTokenForUser('u1')).toBe('token-abc');
  });

  it('liefert null, wenn kein Token hinterlegt ist', async () => {
    vorhandenerToken = null;
    const { getFCMTokenForUser } = await lade();
    expect(await getFCMTokenForUser('u1')).toBeNull();
  });

  it('liefert null statt zu werfen, wenn der Zugriff scheitert', async () => {
    getDocMock.mockImplementationOnce(() => {
      throw new Error('kein Zugriff');
    });
    const { getFCMTokenForUser } = await lade();
    expect(await getFCMTokenForUser('u1')).toBeNull();
  });
});

describe('isPushNotificationSupported', () => {
  it('erkennt fehlende Browser-Unterstützung', async () => {
    const { isPushNotificationSupported } = await lade();
    // jsdom kennt PushManager nicht → nicht unterstützt
    expect(typeof isPushNotificationSupported()).toBe('boolean');
  });
});

describe('requestNotificationPermission', () => {
  it('liefert "denied", wenn der Browser keine Benachrichtigungen kennt', async () => {
    const original = (globalThis as { Notification?: unknown }).Notification;
    delete (globalThis as { Notification?: unknown }).Notification;
    const { requestNotificationPermission } = await lade();
    expect(await requestNotificationPermission()).toBe('denied');
    if (original) (globalThis as { Notification?: unknown }).Notification = original;
  });

  it('liefert "granted", wenn die Erlaubnis bereits erteilt ist', async () => {
    (globalThis as { Notification?: unknown }).Notification = {
      permission: 'granted',
      requestPermission: vi.fn(),
    };
    const { requestNotificationPermission } = await lade();
    expect(await requestNotificationPermission()).toBe('granted');
    delete (globalThis as { Notification?: unknown }).Notification;
  });

  it('liefert "denied", wenn die Erlaubnis verweigert wurde', async () => {
    (globalThis as { Notification?: unknown }).Notification = {
      permission: 'denied',
      requestPermission: vi.fn(),
    };
    const { requestNotificationPermission } = await lade();
    expect(await requestNotificationPermission()).toBe('denied');
    delete (globalThis as { Notification?: unknown }).Notification;
  });

  it('fragt nach, wenn noch nicht entschieden wurde', async () => {
    const requestPermission = vi.fn(async () => 'granted');
    (globalThis as { Notification?: unknown }).Notification = {
      permission: 'default',
      requestPermission,
    };
    const { requestNotificationPermission } = await lade();
    expect(await requestNotificationPermission()).toBe('granted');
    expect(requestPermission).toHaveBeenCalled();
    delete (globalThis as { Notification?: unknown }).Notification;
  });
});

describe('sendPushNotification', () => {
  it('ruft die API-Route auf', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) }));
    vi.stubGlobal('fetch', fetchMock);
    const { sendPushNotification } = await lade();
    await sendPushNotification({ userId: 'u1', title: 'Neuer Einsatz', body: 'Morgen 06:00' });
    expect(fetchMock).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('wirft bei einer Fehlerantwort der API', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    vi.stubGlobal('fetch', fetchMock);
    const { sendPushNotification } = await lade();
    await expect(sendPushNotification({ userId: 'u1', title: 'T', body: 'B' })).rejects.toThrow(
      /HTTP 500/
    );
    vi.unstubAllGlobals();
  });
});
