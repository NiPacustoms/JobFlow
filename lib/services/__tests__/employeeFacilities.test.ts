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
