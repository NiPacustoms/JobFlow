import { beforeEach, describe, expect, it, vi } from 'vitest';
import { harness, firestoreModuleMock, ts } from './helpers/firestoreHarness';

/**
 * Einrichtungen aus Sicht des Mitarbeiters (Liste, Favoriten, Anfahrt).
 * Jede Abfrage MUSS an userId UND companyId gebunden sein.
 */

vi.mock('@/lib/firebase', () => ({ db: {}, getDb: vi.fn(() => ({})) }));
vi.mock('firebase/firestore', () => firestoreModuleMock());

const lade = async () => (await import('../employeeFacilities')).employeeFacilitiesService;

const scope = { userId: 'u1', companyId: 'firmaA' };

const einrichtung = (id: string, daten: Record<string, unknown> = {}) => ({
  id,
  data: {
    userId: 'u1',
    companyId: 'firmaA',
    name: 'Haus Sonnenschein',
    address: 'Hauptstr. 1, 45699 Herten',
    isFavorite: false,
    createdAt: ts(new Date(2026, 0, 1)),
    updatedAt: ts(new Date(2026, 6, 1)),
    ...daten,
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  harness.reset();
});

describe('Zugriffsprüfung', () => {
  it('verlangt eine userId', async () => {
    const service = await lade();
    await expect(service.getAll({ userId: '', companyId: 'firmaA' })).rejects.toThrow(/userId/);
  });

  it('verlangt eine companyId', async () => {
    const service = await lade();
    await expect(service.getAll({ userId: 'u1', companyId: '' })).rejects.toThrow(/companyId/);
  });
});

describe('getAll', () => {
  it('liest die Einrichtungen des Mitarbeiters', async () => {
    harness.setDocs([einrichtung('e1'), einrichtung('e2', { name: 'Seniorenstift' })]);
    const service = await lade();
    const result = await service.getAll(scope);
    expect(result).toHaveLength(2);
    expect(harness.hatWhere('userId', 'u1')).toBe(true);
    expect(harness.hatWhere('companyId', 'firmaA')).toBe(true);
  });

  it('liefert eine leere Liste, wenn nichts zugeordnet ist', async () => {
    harness.setDocs([]);
    const service = await lade();
    expect(await service.getAll(scope)).toEqual([]);
  });
});

describe('getById', () => {
  it('liest eine einzelne Einrichtung', async () => {
    harness.setDoc(einrichtung('e1'));
    const service = await lade();
    const e = await service.getById(scope, 'e1');
    expect(e).toMatchObject({ name: 'Haus Sonnenschein', id: 'e1' });
  });

  it('liefert null, wenn die Einrichtung nicht existiert', async () => {
    harness.setDoc(null);
    const service = await lade();
    expect(await service.getById(scope, 'fehlt')).toBeNull();
  });

  it('liefert null für eine Einrichtung eines anderen Mitarbeiters', async () => {
    harness.setDoc(einrichtung('e1', { userId: 'fremd' }));
    const service = await lade();
    expect(await service.getById(scope, 'e1')).toBeNull();
  });

  it('liefert null für eine Einrichtung einer anderen Firma', async () => {
    harness.setDoc(einrichtung('e1', { companyId: 'firmaB' }));
    const service = await lade();
    expect(await service.getById(scope, 'e1')).toBeNull();
  });
});

describe('Favoriten', () => {
  it('setzt eine Einrichtung als Favorit', async () => {
    harness.setDocs([]); // noch kein Favoriteneintrag
    harness.setDoc(einrichtung('e1'));
    const service = await lade();
    await service.addToFavorites(scope, 'e1');
    expect(harness.writes.some(w => w.art === 'add')).toBe(true);
    expect(harness.writes.find(w => w.art === 'update')?.daten).toMatchObject({ isFavorite: true });
  });

  it('lehnt einen doppelten Favoriten ab', async () => {
    harness.setDocs([{ id: 'fav1', data: { userId: 'u1', companyId: 'firmaA', facilityId: 'e1' } }]);
    const service = await lade();
    await expect(service.addToFavorites(scope, 'e1')).rejects.toThrow(/bereits in den Favoriten/);
  });

  it('lehnt einen Favoriten für eine fremde Einrichtung ab', async () => {
    harness.setDocs([]);
    harness.setDoc(einrichtung('e1', { userId: 'fremd' }));
    const service = await lade();
    await expect(service.addToFavorites(scope, 'e1')).rejects.toThrow(/gehört nicht/);
  });

  it('entfernt einen Favoriten', async () => {
    harness.setDocs([{ id: 'fav1', data: { userId: 'u1', companyId: 'firmaA', facilityId: 'e1' } }]);
    harness.setDoc(einrichtung('e1', { isFavorite: true }));
    const service = await lade();
    await service.removeFromFavorites(scope, 'e1');
    expect(harness.writes.some(w => w.art === 'delete')).toBe(true);
    expect(harness.writes.find(w => w.art === 'update')?.daten).toMatchObject({ isFavorite: false });
  });

  it('meldet, wenn kein Favoriteneintrag vorhanden ist', async () => {
    harness.setDocs([]);
    const service = await lade();
    await expect(service.removeFromFavorites(scope, 'e1')).rejects.toThrow(/nicht in den Favoriten/);
  });

  it('liest die Favoriten', async () => {
    harness.setDocs([einrichtung('e1', { isFavorite: true })]);
    const service = await lade();
    const result = await service.getFavorites(scope);
    expect(Array.isArray(result)).toBe(true);
  });
});

describe('Anfahrt', () => {
  it('liefert eine Wegbeschreibung zur Einrichtung', async () => {
    harness.setDoc(einrichtung('e1'));
    const service = await lade();
    const route = await service.getDirections(scope, 'e1');
    expect(route.url).toContain('http');
  });

  it('wirft, wenn die Einrichtung nicht existiert', async () => {
    harness.setDoc(null);
    const service = await lade();
    await expect(service.getDirections(scope, 'fehlt')).rejects.toThrow(/nicht gefunden/);
  });

  it('wirft für eine fremde Einrichtung', async () => {
    harness.setDoc(einrichtung('e1', { companyId: 'firmaB' }));
    const service = await lade();
    await expect(service.getDirections(scope, 'e1')).rejects.toThrow();
  });
});

describe('getStats', () => {
  const scope = { userId: 'u1', companyId: 'firmaA' };

  it('berechnet Kennzahlen über alle Einrichtungen', async () => {
    harness.setDocs([
      einrichtung('f1', { shiftCount: 3, rating: 4.5, distance: 12.4, isFavorite: true }),
      einrichtung('f2', { shiftCount: 0, rating: 3.5, distance: 7.6 }),
    ]);
    const service = await lade();

    await expect(service.getStats(scope)).resolves.toEqual({
      totalFacilities: 2,
      activeFacilities: 1,
      favoriteFacilities: 1,
      totalShifts: 3,
      averageRating: 4,
      totalDistance: 20,
    });
  });

  it('liefert Nullwerte ohne Einrichtungen', async () => {
    harness.setDocs([]);
    const service = await lade();

    await expect(service.getStats(scope)).resolves.toMatchObject({
      totalFacilities: 0,
      averageRating: 0,
      totalDistance: 0,
    });
  });
});

describe('updateRating und updateVisit', () => {
  const scope = { userId: 'u1', companyId: 'firmaA' };

  it('speichert eine Bewertung der eigenen Einrichtung', async () => {
    harness.setDoc(einrichtung('f1'));
    const service = await lade();

    await service.updateRating(scope, 'f1', 5);
    const update = harness.writes.find(w => w.art === 'update')?.daten as Record<string, unknown>;
    expect(update.rating).toBe(5);
  });

  it('merkt den letzten Besuch', async () => {
    harness.setDoc(einrichtung('f1'));
    const service = await lade();

    await service.updateVisit(scope, 'f1');
    const update = harness.writes.find(w => w.art === 'update')?.daten as Record<string, unknown>;
    expect(update.lastVisit).toBe('SERVER_TIMESTAMP');
  });

  it('verweigert Bewertung und Besuch für fremde Einrichtungen', async () => {
    harness.setDoc(einrichtung('f1', { userId: 'anderer' }));
    const service = await lade();

    await expect(service.updateRating(scope, 'f1', 5)).rejects.toThrow(/nicht zum aktuellen Benutzer/);
    await expect(service.updateVisit(scope, 'f1')).rejects.toThrow(/nicht zum aktuellen Benutzer/);
  });

  it('verweigert Bewertung für eine nicht vorhandene Einrichtung', async () => {
    harness.setDoc(null);
    const service = await lade();
    await expect(service.updateRating(scope, 'weg', 5)).rejects.toThrow();
  });
});

describe('getNearby und Entfernungsberechnung', () => {
  const scope = { userId: 'u1', companyId: 'firmaA' };
  // Berlin Mitte als Ausgangspunkt
  const start = { lat: 52.52, lon: 13.405 };

  it('liefert nur Einrichtungen im Radius, nach Entfernung sortiert', async () => {
    harness.setDocs([
      // ~5 km entfernt
      einrichtung('nah', { latitude: 52.475, longitude: 13.405 }),
      // ~1 km entfernt
      einrichtung('naeher', { latitude: 52.529, longitude: 13.405 }),
      // ~50 km entfernt
      einrichtung('fern', { latitude: 52.07, longitude: 13.405 }),
      // ohne Koordinaten
      einrichtung('ohne'),
    ]);
    const service = await lade();

    const nahe = await service.getNearby(scope, start.lat, start.lon, 10);
    expect(nahe.map(f => f.id)).toEqual(['naeher', 'nah']);
  });

  it('berechnet die Luftlinie zwischen zwei Punkten', async () => {
    const service = await lade();
    // Berlin – Hamburg sind rund 255 km Luftlinie
    const km = service.calculateDistance(52.52, 13.405, 53.55, 9.993);
    expect(km).toBeGreaterThan(240);
    expect(km).toBeLessThan(270);
    expect(service.calculateDistance(52.52, 13.405, 52.52, 13.405)).toBe(0);
    expect(service.toRadians(180)).toBeCloseTo(Math.PI, 5);
  });

  it('reicht Lesefehler weiter', async () => {
    harness.naechsterFehler = new Error('kein Zugriff');
    const service = await lade();
    await expect(service.getNearby(scope, start.lat, start.lon)).rejects.toThrow('kein Zugriff');
  });
});

describe('exportFacilities', () => {
  it('liefert den Export-Pfad je Format', async () => {
    vi.useFakeTimers();
    const service = await lade();
    const versprechen = service.exportFacilities({ userId: 'u1', companyId: 'firmaA' }, 'csv');
    await vi.advanceTimersByTimeAsync(1000);
    await expect(versprechen).resolves.toBe('/facilities-export.csv');
    vi.useRealTimers();
  });

  it('verlangt einen gültigen Kontext', async () => {
    const service = await lade();
    await expect(
      service.exportFacilities({ userId: '', companyId: 'firmaA' }, 'csv')
    ).rejects.toThrow(/userId/);
  });
});
