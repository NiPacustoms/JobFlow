import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Karten-Service (Anfahrten): Nominatim-Geokodierung und
 * OpenRouteService-Routen mit zweistufigem Cache (Memory + Firestore).
 */

const flags = vi.hoisted(() => ({ IS_PRODUCTION: false }));
vi.mock('@/lib/config/featureFlags', () => ({ FEATURE_FLAGS: flags }));

const getDocMock = vi.fn();
const setDocMock = vi.fn(async () => undefined);
const deleteDocMock = vi.fn(async () => undefined);
vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db: unknown, sammlung: string, id: string) => ({ pfad: `${sammlung}/${id}` })),
  getDoc: (...a: unknown[]) => getDocMock(...a),
  setDoc: (...a: unknown[]) => setDocMock(...a),
  deleteDoc: (...a: unknown[]) => deleteDocMock(...a),
  Timestamp: {
    fromMillis: (ms: number) => ({ toMillis: () => ms }),
    now: () => ({ toMillis: () => Date.now() }),
  },
}));

vi.mock('@/lib/firebase', () => ({ getDb: vi.fn(() => ({})) }));
vi.mock('@/lib/logging', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const recordRequest = vi.fn();
vi.mock('../apiMonitoring', () => ({
  ApiMonitoringService: {
    recordRequest: (...a: unknown[]) => recordRequest(...a),
    canMakeRequest: vi.fn(async () => ({ allowed: true })),
  },
}));

const fetchMock = vi.fn();

const ladeModul = async () => await import('../maps');

const start = { latitude: 52.52, longitude: 13.405 };
const ziel = { latitude: 52.4, longitude: 13.5 };

const routenAntwort = {
  routes: [
    {
      summary: { distance: 12500, duration: 1200 },
      segments: [{ steps: [{ instruction: 'Links abbiegen' }, { instruction: 'Geradeaus' }] }],
    },
  ],
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('NEXT_PUBLIC_ORS_API_KEY', 'ors-key-1');
  flags.IS_PRODUCTION = false;
  getDocMock.mockResolvedValue({ exists: () => false });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('geocodeAddress', () => {
  it('geokodiert eine Adresse und legt sie in den Cache', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [{ lat: '52.52', lon: '13.405' }],
    });
    const { geocodeAddress } = await ladeModul();

    const koordinaten = await geocodeAddress('Hauptstr. 1, Berlin');
    expect(koordinaten).toEqual({ latitude: 52.52, longitude: 13.405 });
    expect(fetchMock.mock.calls[0][0]).toContain('nominatim.openstreetmap.org/search');
    expect(setDocMock).toHaveBeenCalled(); // Firestore-Cache
  });

  it('bedient den zweiten Aufruf aus dem Memory-Cache', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [{ lat: '52.52', lon: '13.405' }],
    });
    const { geocodeAddress } = await ladeModul();

    await geocodeAddress('Hauptstr. 1, Berlin');
    await geocodeAddress('Hauptstr. 1, Berlin');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('liefert null bei Fehlern oder leeren Treffern', async () => {
    const { geocodeAddress } = await ladeModul();

    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    expect(await geocodeAddress('a')).toBeNull();

    fetchMock.mockResolvedValue({ ok: true, json: async () => [] });
    expect(await geocodeAddress('b')).toBeNull();

    fetchMock.mockResolvedValue({ ok: true, json: async () => [{}] });
    expect(await geocodeAddress('c')).toBeNull();
  });
});

describe('getRoute', () => {
  it('holt eine Route mit Schritten und OSM-Link', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => routenAntwort });
    const { getRoute } = await ladeModul();

    const route = await getRoute(start, ziel);
    expect(route).toMatchObject({
      distanceMeters: 12500,
      durationSeconds: 1200,
      steps: ['Links abbiegen', 'Geradeaus'],
    });
    expect(route?.mapUrl).toContain('openstreetmap.org/directions');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('ors-key-1');
  });

  it('bedient wiederholte Anfragen aus dem Cache und zählt den Treffer', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => routenAntwort });
    const { getRoute } = await ladeModul();

    await getRoute(start, ziel);
    const zweite = await getRoute(start, ziel);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(zweite?.distanceMeters).toBe(12500);
    expect(recordRequest).toHaveBeenCalledWith(true, expect.any(Number));
  });

  it('nutzt den Firestore-Cache, wenn der Memory-Cache leer ist', async () => {
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({
        value: { distanceMeters: 999, durationSeconds: 60, steps: [] },
        expiresAt: { toMillis: () => Date.now() + 60_000 },
      }),
    });
    const { getRoute } = await ladeModul();

    const route = await getRoute(start, ziel);
    expect(route?.distanceMeters).toBe(999);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('löscht abgelaufene Firestore-Cache-Einträge und ruft die API', async () => {
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({
        value: { distanceMeters: 999 },
        expiresAt: { toMillis: () => Date.now() - 1 },
      }),
    });
    fetchMock.mockResolvedValue({ ok: true, json: async () => routenAntwort });
    const { getRoute } = await ladeModul();

    const route = await getRoute(start, ziel);
    expect(deleteDocMock).toHaveBeenCalled();
    expect(route?.distanceMeters).toBe(12500);
  });

  it('liefert bei Rate-Limit einen verständlichen Platzhalter', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429 });
    const { getRoute } = await ladeModul();

    const route = await getRoute(start, ziel);
    expect(route?.distanceMeters).toBe(0);
    expect(route?.steps[0]).toContain('Rate-Limit');
  });

  it('liefert null bei sonstigen API-Fehlern', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    const { getRoute } = await ladeModul();
    expect(await getRoute(start, ziel)).toBeNull();
  });

  it('liefert in Produktion ohne API-Key nichts', async () => {
    vi.stubEnv('NEXT_PUBLIC_ORS_API_KEY', '');
    vi.stubEnv('ORS_API_KEY', '');
    flags.IS_PRODUCTION = true;
    const { getRoute } = await ladeModul();

    expect(await getRoute(start, ziel)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('übersteht Firestore-Cache-Fehler (Fail-Silently)', async () => {
    getDocMock.mockRejectedValue(new Error('kein Zugriff'));
    setDocMock.mockRejectedValue(new Error('kein Zugriff'));
    fetchMock.mockResolvedValue({ ok: true, json: async () => routenAntwort });
    const { getRoute } = await ladeModul();

    const route = await getRoute(start, ziel);
    expect(route?.distanceMeters).toBe(12500);
  });
});
