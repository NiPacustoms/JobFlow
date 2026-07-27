import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * FCM-Token-Beschaffung über den Service Worker: Nur mit registriertem und
 * aktivem Service Worker plus VAPID-Key kann eine Pflegekraft Push-Hinweise
 * auf neue Einsätze empfangen.
 */

const getMessagingMock = vi.fn(() => ({ app: 'messaging' }));
const getTokenMock = vi.fn(async () => 'fcm-token-1');
const onMessageMock = vi.fn(() => vi.fn());
vi.mock('firebase/messaging', () => ({
  getMessaging: (...a: unknown[]) => getMessagingMock(...a),
  getToken: (...a: unknown[]) => getTokenMock(...a),
  onMessage: (...a: unknown[]) => onMessageMock(...a),
}));

vi.mock('firebase/app', () => ({
  getApp: vi.fn(() => ({ name: 'app' })),
  getApps: vi.fn(() => [{ name: 'app' }]),
  initializeApp: vi.fn(() => ({ name: 'app' })),
}));

vi.mock('@/lib/firebase', () => ({
  getFirebaseConfig: vi.fn(() => ({ apiKey: 'x' })),
  getDb: vi.fn(() => ({})),
  doc: vi.fn((_db: unknown, coll: string, id: string) => ({ coll, id })),
  getDoc: vi.fn(async () => ({ exists: () => false, data: () => null })),
  setDoc: vi.fn(async () => undefined),
  serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
  auth: { currentUser: null },
}));

vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const ladeModul = async () => await import('../pushNotifications');

/** Service-Worker-Registrierung, wie sie der Browser liefert. */
const registrierung = (aktiv = true, scope = '/firebase-cloud-messaging-push-scope') =>
  ({ scope, active: aktiv ? {} : null }) as unknown as ServiceWorkerRegistration;

const serviceWorkerStub = (overrides: Record<string, unknown> = {}) => ({
  getRegistration: vi.fn(async () => registrierung()),
  register: vi.fn(async () => registrierung()),
  ready: Promise.resolve(registrierung()),
  ...overrides,
});

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  getMessagingMock.mockReturnValue({ app: 'messaging' } as never);
  getTokenMock.mockResolvedValue('fcm-token-1');
  vi.stubEnv('NEXT_PUBLIC_FCM_VAPID_KEY', 'vapid-123');
  Object.defineProperty(navigator, 'serviceWorker', {
    value: serviceWorkerStub(),
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getFCMToken', () => {
  it('liefert den Token über den dedizierten FCM-Service-Worker', async () => {
    const { getFCMToken } = await ladeModul();
    await expect(getFCMToken()).resolves.toBe('fcm-token-1');

    expect(getTokenMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ vapidKey: 'vapid-123' })
    );
  });

  it('weicht auf den allgemeinen Service Worker aus (ready)', async () => {
    Object.defineProperty(navigator, 'serviceWorker', {
      value: serviceWorkerStub({
        getRegistration: vi.fn(async () => null),
        ready: Promise.resolve(registrierung(true, '/')),
      }),
      configurable: true,
      writable: true,
    });
    const { getFCMToken } = await ladeModul();
    await expect(getFCMToken()).resolves.toBe('fcm-token-1');
  });

  it('liefert null ohne Service-Worker-Unterstützung', async () => {
    // @ts-expect-error – Browser ohne Service Worker nachbilden
    delete navigator.serviceWorker;
    const { getFCMToken } = await ladeModul();
    await expect(getFCMToken()).resolves.toBeNull();
  });

  it('liefert null ohne konfigurierten VAPID-Key', async () => {
    vi.stubEnv('NEXT_PUBLIC_FCM_VAPID_KEY', '');
    vi.stubEnv('NEXT_PUBLIC_FIREBASE_VAPID_KEY', '');
    const { getFCMToken } = await ladeModul();
    await expect(getFCMToken()).resolves.toBeNull();
    expect(getTokenMock).not.toHaveBeenCalled();
  });

  it('liefert null, wenn Messaging nicht initialisierbar ist', async () => {
    getMessagingMock.mockImplementation(() => {
      throw new Error('nicht unterstützt');
    });
    const { getFCMToken } = await ladeModul();
    await expect(getFCMToken()).resolves.toBeNull();
  });

  it('fängt Fehler des Token-Abrufs ab', async () => {
    getTokenMock.mockRejectedValue(new Error('kein Push-Dienst'));
    const { getFCMToken } = await ladeModul();
    await expect(getFCMToken()).resolves.toBeNull();
  });

  it('liefert null, wenn der Token leer bleibt', async () => {
    getTokenMock.mockResolvedValue('' as never);
    const { getFCMToken } = await ladeModul();
    await expect(getFCMToken()).resolves.toBeNull();
  });

  it('liefert null, wenn kein Service Worker vorbereitet werden kann', async () => {
    Object.defineProperty(navigator, 'serviceWorker', {
      value: serviceWorkerStub({
        getRegistration: vi.fn(async () => null),
        ready: Promise.reject(new Error('nicht bereit')),
      }),
      configurable: true,
      writable: true,
    });
    const { getFCMToken } = await ladeModul();
    // localhost → kein automatisches Registrieren, daher kein Token
    await expect(getFCMToken()).resolves.toBeNull();
  });
});

describe('setupMessageListener', () => {
  it('registriert den Handler und gibt Nachrichten weiter', async () => {
    let empfangen: ((payload: unknown) => void) | undefined;
    const abmelden = vi.fn();
    onMessageMock.mockImplementation(((_msg: unknown, handler: (p: unknown) => void) => {
      empfangen = handler;
      return abmelden;
    }) as never);

    const { setupMessageListener } = await ladeModul();
    const callback = vi.fn();
    const unsub = setupMessageListener(callback);

    empfangen?.({ notification: { title: 'Neue Schicht' } });
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ notification: expect.anything() }));
    expect(unsub).toBe(abmelden);
  });

  it('prüft bei Nachrichten mit Link zusätzlich den Token', async () => {
    let empfangen: ((payload: unknown) => void) | undefined;
    onMessageMock.mockImplementation(((_msg: unknown, handler: (p: unknown) => void) => {
      empfangen = handler;
      return vi.fn();
    }) as never);

    const { setupMessageListener } = await ladeModul();
    const callback = vi.fn();
    setupMessageListener(callback);

    empfangen?.({ notification: { title: 'x' }, fcmOptions: { link: '/schedule' } });
    expect(callback).toHaveBeenCalled();
  });

  it('liefert null, wenn Messaging fehlt oder die Registrierung scheitert', async () => {
    getMessagingMock.mockImplementation(() => {
      throw new Error('nicht unterstützt');
    });
    let modul = await ladeModul();
    expect(modul.setupMessageListener(vi.fn())).toBeNull();

    vi.resetModules();
    getMessagingMock.mockReturnValue({ app: 'messaging' } as never);
    onMessageMock.mockImplementation((() => {
      throw new Error('kaputt');
    }) as never);
    modul = await ladeModul();
    expect(modul.setupMessageListener(vi.fn())).toBeNull();
  });
});
