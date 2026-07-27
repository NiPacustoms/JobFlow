import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Konflikt-Erkennung im Dienstplan: überlappende Einsätze desselben
 * Mitarbeiters (getConflicts) und Prüfung vor einer Neuzuweisung.
 */

vi.mock('@/lib/firebase', () => ({ getDb: vi.fn(() => ({})) }));

const getFacilityById = vi.fn();
vi.mock('../../facilities', () => ({
  facilityService: { getById: (...a: unknown[]) => getFacilityById(...a) },
}));

const getDocsMock = vi.fn();
// Schicht-Dokumente je ID
let schichten: Record<string, Record<string, unknown> | null> = {};

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db: unknown, name: string) => ({ sammlung: name })),
  doc: vi.fn((_db: unknown, _sammlung: string, id: string) => ({ id })),
  query: vi.fn((...teile: unknown[]) => ({ teile })),
  where: vi.fn(),
  getDocs: (...a: unknown[]) => getDocsMock(...a),
  getDoc: vi.fn(async (ref: { id: string }) => {
    const daten = schichten[ref.id];
    return { exists: () => !!daten, id: ref.id, data: () => daten };
  }),
}));

import { getConflicts, detectConflictForUser } from '../read6';

const einsatzSnapshot = (
  einsaetze: Array<{ id: string; userId: string; shiftId: string; status?: string }>
) => ({
  docs: einsaetze.map(e => ({ id: e.id, data: () => ({ status: 'accepted', ...e }) })),
});

beforeEach(() => {
  vi.clearAllMocks();
  schichten = {};
  getFacilityById.mockResolvedValue({
    id: 'f1',
    name: 'Haus Sonnenschein',
    stations: [{ id: 'st1', name: 'Station 3' }],
  });
});

describe('getConflicts', () => {
  const zeitraum: [Date, Date] = [new Date(2026, 6, 20), new Date(2026, 6, 26)];

  it('findet überlappende Einsätze desselben Mitarbeiters', async () => {
    getDocsMock.mockResolvedValue(
      einsatzSnapshot([
        { id: 'a1', userId: 'u1', shiftId: 's1' },
        { id: 'a2', userId: 'u1', shiftId: 's2' },
      ])
    );
    schichten = {
      s1: { facilityId: 'f1', stationId: 'st1', date: '2026-07-20', startTime: '06:00', endTime: '14:00' },
      s2: { facilityId: 'f1', date: '2026-07-20', startTime: '12:00', endTime: '20:00' },
    };

    const konflikte = (await getConflicts(...zeitraum)) as Array<Record<string, unknown>>;
    expect(konflikte).toHaveLength(1);
    expect(konflikte[0]).toMatchObject({
      userId: 'u1',
      shiftId1: 's1',
      shiftId2: 's2',
      facilityName: 'Haus Sonnenschein',
      stationName: 'Station 3',
    });
  });

  it('ignoriert Mitarbeiter mit nur einem Einsatz', async () => {
    getDocsMock.mockResolvedValue(einsatzSnapshot([{ id: 'a1', userId: 'u1', shiftId: 's1' }]));
    await expect(getConflicts(...zeitraum)).resolves.toEqual([]);
  });

  it('meldet nichts bei überschneidungsfreien Einsätzen', async () => {
    getDocsMock.mockResolvedValue(
      einsatzSnapshot([
        { id: 'a1', userId: 'u1', shiftId: 's1' },
        { id: 'a2', userId: 'u1', shiftId: 's2' },
      ])
    );
    schichten = {
      s1: { facilityId: 'f1', date: '2026-07-20', startTime: '06:00', endTime: '12:00' },
      s2: { facilityId: 'f1', date: '2026-07-20', startTime: '14:00', endTime: '20:00' },
    };
    await expect(getConflicts(...zeitraum)).resolves.toEqual([]);
  });

  it('überspringt gelöschte Schichten', async () => {
    getDocsMock.mockResolvedValue(
      einsatzSnapshot([
        { id: 'a1', userId: 'u1', shiftId: 's1' },
        { id: 'a2', userId: 'u1', shiftId: 'weg' },
      ])
    );
    schichten = {
      s1: { facilityId: 'f1', date: '2026-07-20', startTime: '06:00', endTime: '14:00' },
      weg: null,
    };
    await expect(getConflicts(...zeitraum)).resolves.toEqual([]);
  });

  it('nennt Fallback-Namen für unbekannte Einrichtungen und Stationen', async () => {
    getFacilityById.mockResolvedValue(null);
    getDocsMock.mockResolvedValue(
      einsatzSnapshot([
        { id: 'a1', userId: 'u1', shiftId: 's1' },
        { id: 'a2', userId: 'u1', shiftId: 's2' },
      ])
    );
    schichten = {
      s1: { facilityId: 'f1', date: '2026-07-20', startTime: '06:00', endTime: '14:00' },
      s2: { date: '2026-07-20', startTime: '12:00', endTime: '20:00' },
    };
    const konflikte = (await getConflicts(...zeitraum)) as Array<Record<string, unknown>>;
    expect(konflikte[0]).toMatchObject({
      facilityName: 'Unbekannte Einrichtung',
      stationName: 'Unbekannte Station',
    });
  });
});

describe('detectConflictForUser', () => {
  it('erkennt eine Überlappung mit bestehenden Einsätzen', async () => {
    schichten = {
      neu: { date: '2026-07-20', startTime: '12:00', endTime: '20:00' },
      alt: { date: '2026-07-20', startTime: '06:00', endTime: '14:00' },
    };
    getDocsMock.mockResolvedValue(einsatzSnapshot([{ id: 'a1', userId: 'u1', shiftId: 'alt' }]));

    await expect(detectConflictForUser('u1', 'neu')).resolves.toBe(true);
  });

  it('meldet keinen Konflikt bei freier Zeit', async () => {
    schichten = {
      neu: { date: '2026-07-21', startTime: '06:00', endTime: '14:00' },
      alt: { date: '2026-07-20', startTime: '06:00', endTime: '14:00' },
    };
    getDocsMock.mockResolvedValue(einsatzSnapshot([{ id: 'a1', userId: 'u1', shiftId: 'alt' }]));

    await expect(detectConflictForUser('u1', 'neu')).resolves.toBe(false);
  });

  it('meldet false, wenn die neue Schicht nicht existiert', async () => {
    schichten = {};
    await expect(detectConflictForUser('u1', 'fehlt')).resolves.toBe(false);
  });

  it('überspringt gelöschte Bestandsschichten', async () => {
    schichten = {
      neu: { date: '2026-07-20', startTime: '12:00', endTime: '20:00' },
      weg: null,
    };
    getDocsMock.mockResolvedValue(einsatzSnapshot([{ id: 'a1', userId: 'u1', shiftId: 'weg' }]));
    await expect(detectConflictForUser('u1', 'neu')).resolves.toBe(false);
  });
});
