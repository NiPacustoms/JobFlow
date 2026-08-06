import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * API-Monitoring für OpenRouteService: Tages- und Minutenlimits,
 * Aufruf-Statistiken und Bereinigung alter Einträge.
 */

const getDocMock = vi.fn();
const setDocMock = vi.fn(async () => undefined);
const updateDocMock = vi.fn(async () => undefined);
const getDocsMock = vi.fn();
const deleteDocMock = vi.fn(async () => undefined);
vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db: unknown, name: string) => ({ sammlung: name })),
  doc: vi.fn((_db: unknown, sammlung: string, id: string) => ({ pfad: `${sammlung}/${id}` })),
  getDoc: (...a: unknown[]) => getDocMock(...a),
  setDoc: (...a: unknown[]) => setDocMock(...a),
  updateDoc: (...a: unknown[]) => updateDocMock(...a),
  getDocs: (...a: unknown[]) => getDocsMock(...a),
  deleteDoc: (...a: unknown[]) => deleteDocMock(...a),
  increment: vi.fn((n: number) => ({ __inkrement: n })),
  serverTimestamp: vi.fn(() => 'server-zeit'),
  query: vi.fn((...teile: unknown[]) => ({ teile })),
  where: vi.fn((feld: string, op: string, wert: unknown) => ({ feld, op, wert })),
  orderBy: vi.fn(),
  limit: vi.fn(),
  Timestamp: class {},
}));

vi.mock('@/lib/firebase', () => ({ getDb: vi.fn(() => ({})) }));
vi.mock('@/lib/logging', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { ApiMonitoringService } from '../apiMonitoring';

// Feste Uhrzeit, damit die Minutenfenster deterministisch sind.
const JETZT = new Date('2026-07-27T10:30:00.000Z');
const heute = JETZT.toISOString().split('T')[0];
const aktuelleMinute = `${heute}-${String(JETZT.getHours()).padStart(2, '0')}-${String(
  JETZT.getMinutes()
).padStart(2, '0')}`;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(JETZT);
  getDocMock.mockResolvedValue({ exists: () => false });
  getDocsMock.mockResolvedValue({ docs: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('canMakeRequest', () => {
  it('erlaubt den ersten Aufruf des Tages', async () => {
    await expect(ApiMonitoringService.canMakeRequest()).resolves.toEqual({
      allowed: true,
      dailyCount: 0,
    });
  });

  it('blockiert bei erreichtem Tageslimit', async () => {
    getDocMock.mockResolvedValue({ exists: () => true, data: () => ({ count: 2000 }) });
    const ergebnis = await ApiMonitoringService.canMakeRequest();
    expect(ergebnis.allowed).toBe(false);
    expect(ergebnis.reason).toContain('Tägliches Limit');
    expect(ergebnis.dailyCount).toBe(2000);
  });

  it('blockiert bei erreichtem Minutenlimit', async () => {
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({ count: 10, rateLimitWindow: [{ minute: aktuelleMinute, count: 40 }] }),
    });
    const ergebnis = await ApiMonitoringService.canMakeRequest();
    expect(ergebnis.allowed).toBe(false);
    expect(ergebnis.reason).toContain('Rate Limit');
  });

  it('erlaubt unterhalb der Limits', async () => {
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({ count: 10, rateLimitWindow: [{ minute: aktuelleMinute, count: 5 }] }),
    });
    await expect(ApiMonitoringService.canMakeRequest()).resolves.toEqual({
      allowed: true,
      dailyCount: 10,
    });
  });

  it('erlaubt bei Monitoring-Fehlern (Fail-Open)', async () => {
    getDocMock.mockRejectedValueOnce(new Error('kein Zugriff'));
    await expect(ApiMonitoringService.canMakeRequest()).resolves.toEqual({ allowed: true });
  });
});

describe('recordRequest', () => {
  it('legt am Tagesanfang ein Dokument mit erstem echten Aufruf an', async () => {
    await ApiMonitoringService.recordRequest(false, 120);
    expect(setDocMock).toHaveBeenCalledWith(
      expect.objectContaining({ pfad: `api_monitoring/${heute}` }),
      expect.objectContaining({
        count: 1,
        cacheMisses: 1,
        cacheHits: 0,
        rateLimitWindow: [{ minute: aktuelleMinute, count: 1 }],
        totalResponseTime: 120,
        responseTimeCount: 1,
      })
    );
  });

  it('zählt Cache-Treffer nicht auf das API-Limit', async () => {
    await ApiMonitoringService.recordRequest(true);
    expect(setDocMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ count: 0, cacheHits: 1, rateLimitWindow: [] })
    );
  });

  it('erhöht Zähler und Minutenfenster bei bestehendem Dokument', async () => {
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({
        count: 5,
        rateLimitWindow: [
          { minute: aktuelleMinute, count: 3 },
          { minute: '2026-07-27-08-00', count: 7 }, // veraltet, fliegt raus
        ],
        totalResponseTime: 100,
        responseTimeCount: 1,
      }),
    });
    await ApiMonitoringService.recordRequest(false, 50);

    const update = updateDocMock.mock.calls[0][1] as Record<string, unknown>;
    expect(update.count).toEqual({ __inkrement: 1 });
    expect(update.cacheMisses).toEqual({ __inkrement: 1 });
    expect(update.rateLimitWindow).toEqual([{ minute: aktuelleMinute, count: 4 }]);
    expect(update.totalResponseTime).toBe(150);
    expect(update.responseTimeCount).toBe(2);
  });

  it('beginnt eine neue Minute mit Zähler 1', async () => {
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({ count: 5, rateLimitWindow: [] }),
    });
    await ApiMonitoringService.recordRequest(false);
    const update = updateDocMock.mock.calls[0][1] as Record<string, unknown>;
    expect(update.rateLimitWindow).toEqual([{ minute: aktuelleMinute, count: 1 }]);
  });

  it('aktualisiert bei Cache-Treffern nur die Cache-Statistik', async () => {
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({ count: 5, rateLimitWindow: [{ minute: aktuelleMinute, count: 3 }] }),
    });
    await ApiMonitoringService.recordRequest(true);
    const update = updateDocMock.mock.calls[0][1] as Record<string, unknown>;
    expect(update.count).toBeUndefined();
    expect(update.cacheHits).toEqual({ __inkrement: 1 });
    expect(update.rateLimitWindow).toEqual([{ minute: aktuelleMinute, count: 3 }]);
  });

  it('schluckt Schreibfehler (Monitoring blockiert nie)', async () => {
    getDocMock.mockRejectedValueOnce(new Error('kein Zugriff'));
    await expect(ApiMonitoringService.recordRequest()).resolves.toBeUndefined();
  });
});

describe('getStats', () => {
  it('liefert Nullwerte ohne Tagesdokument', async () => {
    const stats = await ApiMonitoringService.getStats();
    expect(stats).toMatchObject({ dailyCount: 0, remaining: 2000, percentageUsed: 0 });
  });

  it('berechnet Auslastung, Cache-Rate und Antwortzeiten', async () => {
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({
        count: 500,
        lastCallAt: { toDate: () => JETZT },
        cacheHits: 30,
        cacheMisses: 10,
        totalResponseTime: 400,
        responseTimeCount: 4,
      }),
    });
    const stats = await ApiMonitoringService.getStats();
    expect(stats.dailyCount).toBe(500);
    expect(stats.remaining).toBe(1500);
    expect(stats.percentageUsed).toBe(25);
    expect(stats.cacheHitRate).toBe(75);
    expect(stats.averageResponseTime).toBe(100);
    expect(stats.lastCallAt).toEqual(JETZT);
  });

  it('liefert bei Fehlern die Standardwerte', async () => {
    getDocMock.mockRejectedValueOnce(new Error('kein Zugriff'));
    const stats = await ApiMonitoringService.getStats();
    expect(stats).toMatchObject({ dailyCount: 0, remaining: 2000 });
  });
});

describe('getHistoricalStats', () => {
  it('liefert die Historie aufsteigend sortiert', async () => {
    getDocsMock.mockResolvedValue({
      docs: [
        {
          id: '2026-07-27',
          data: () => ({ date: '2026-07-27', count: 10, cacheHits: 1, cacheMisses: 1 }),
        },
        {
          id: '2026-07-26',
          data: () => ({ date: '2026-07-26', count: 5, totalResponseTime: 100, responseTimeCount: 2 }),
        },
      ],
    });
    const historie = await ApiMonitoringService.getHistoricalStats(7);
    expect(historie.map(h => h.date)).toEqual(['2026-07-26', '2026-07-27']);
    expect(historie[0].averageResponseTime).toBe(50);
    expect(historie[1].cacheHitRate).toBe(50);
  });

  it('liefert bei Fehlern eine leere Liste', async () => {
    getDocsMock.mockRejectedValueOnce(new Error('kein Zugriff'));
    await expect(ApiMonitoringService.getHistoricalStats()).resolves.toEqual([]);
  });
});

describe('cleanupOldRecords', () => {
  it('löscht alle veralteten Einträge', async () => {
    getDocsMock.mockResolvedValue({
      docs: [{ ref: { pfad: 'api_monitoring/2026-07-01' } }, { ref: { pfad: 'api_monitoring/2026-07-02' } }],
    });
    await ApiMonitoringService.cleanupOldRecords();
    expect(deleteDocMock).toHaveBeenCalledTimes(2);
  });

  it('schluckt Fehler beim Bereinigen', async () => {
    getDocsMock.mockRejectedValueOnce(new Error('kein Zugriff'));
    await expect(ApiMonitoringService.cleanupOldRecords()).resolves.toBeUndefined();
  });
});
