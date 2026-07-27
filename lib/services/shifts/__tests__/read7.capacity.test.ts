import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Dienstplan-Auswertungen: Schichten mit Zuweisungen und die Kapazitätsanzeige
 * (Besetzungsgrad je Schicht mit Ampelfarbe).
 */

vi.mock('@/lib/firebase', () => ({ getDb: vi.fn(() => ({})) }));

const getFacilityById = vi.fn();
vi.mock('../../facilities', () => ({
  facilityService: { getById: (...a: unknown[]) => getFacilityById(...a) },
}));

const getByDateRange = vi.fn();
vi.mock('../read2', () => ({ getByDateRange: (...a: unknown[]) => getByDateRange(...a) }));

// Antworten je Sammlung in Aufrufreihenfolge
let antworten: Record<string, Array<Array<{ id: string; data: Record<string, unknown> }>>> = {};
let nutzer: Record<string, Record<string, unknown> | null> = {};

const whereMock = vi.fn((feld: string, op: string, wert: unknown) => ({ feld, op, wert }));
const orderByMock = vi.fn((feld: string) => ({ orderBy: feld }));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db: unknown, name: string) => ({ sammlung: name })),
  doc: vi.fn((_db: unknown, sammlung: string, id: string) => ({ sammlung, id })),
  query: vi.fn((quelle: { sammlung?: string }, ...teile: unknown[]) => ({
    sammlung: quelle.sammlung,
    teile,
  })),
  where: (...a: never[]) => whereMock(...a),
  orderBy: (...a: never[]) => orderByMock(...a),
  getDocs: vi.fn(async (q: { sammlung: string }) => {
    const naechste = antworten[q.sammlung]?.shift() ?? [];
    return { docs: naechste.map(d => ({ id: d.id, data: () => d.data })) };
  }),
  getDoc: vi.fn(async (ref: { id: string }) => {
    const daten = nutzer[ref.id];
    return { exists: () => !!daten, id: ref.id, data: () => daten };
  }),
}));

import { getShiftsWithAssignments, getCapacityIndicators } from '../read7';

const ts = (d: Date) => ({ toDate: () => d });

beforeEach(() => {
  vi.clearAllMocks();
  antworten = { shifts: [], assignments: [] };
  nutzer = {};
  getByDateRange.mockResolvedValue([]);
  getFacilityById.mockResolvedValue({
    id: 'f1',
    name: 'Haus Sonnenschein',
    stations: [{ id: 'st1', name: 'Station 3' }],
  });
});

describe('getShiftsWithAssignments', () => {
  it('liefert Schichten mit Zuweisungen und den besetzten Mitarbeitern', async () => {
    antworten.shifts = [
      [{ id: 's1', data: { date: ts(new Date(2026, 6, 20)), createdAt: ts(new Date(2026, 6, 1)) } }],
    ];
    antworten.assignments = [
      [
        { id: 'a1', data: { userId: 'u1', shiftId: 's1', status: 'accepted' } },
        { id: 'a2', data: { userId: 'u2', shiftId: 's1', status: 'declined' } },
      ],
    ];
    nutzer = { u1: { displayName: 'Anna Muster', email: 'anna@aufabruf.eu' } };

    const ergebnis = await getShiftsWithAssignments();
    expect(ergebnis).toHaveLength(1);
    expect(ergebnis[0].assignments).toHaveLength(2);
    // nur akzeptierte/zugewiesene Einsätze gelten als Besetzung
    expect(ergebnis[0].assignedUsers).toEqual([
      { id: 'u1', displayName: 'Anna Muster', email: 'anna@aufabruf.eu' },
    ]);
    expect(ergebnis[0].date).toEqual(new Date(2026, 6, 20));
    expect(ergebnis[0].createdAt).toEqual(new Date(2026, 6, 1));
    expect(ergebnis[0].updatedAt).toBeUndefined();
  });

  it('übersetzt alle Filter in Firestore-Bedingungen', async () => {
    antworten.shifts = [[]];
    await getShiftsWithAssignments({
      dateFrom: new Date(2026, 6, 20),
      dateTo: new Date(2026, 6, 26),
      facilityId: 'f1',
      status: 'open',
      type: 'early',
    });

    expect(whereMock).toHaveBeenCalledWith('date', '>=', new Date(2026, 6, 20));
    expect(whereMock).toHaveBeenCalledWith('date', '<=', new Date(2026, 6, 26));
    expect(whereMock).toHaveBeenCalledWith('facilityId', '==', 'f1');
    expect(whereMock).toHaveBeenCalledWith('status', '==', 'open');
    expect(whereMock).toHaveBeenCalledWith('type', '==', 'early');
    expect(orderByMock).toHaveBeenCalledWith('date', 'asc');
  });

  it('überspringt gelöschte Mitarbeiter in der Besetzung', async () => {
    antworten.shifts = [[{ id: 's1', data: { date: ts(new Date(2026, 6, 20)) } }]];
    antworten.assignments = [[{ id: 'a1', data: { userId: 'weg', shiftId: 's1', status: 'assigned' } }]];
    nutzer = {};

    const ergebnis = await getShiftsWithAssignments();
    expect(ergebnis[0].assignedUsers).toEqual([]);
  });
});

describe('getCapacityIndicators', () => {
  const schicht = (overrides: Record<string, unknown> = {}) => ({
    id: 's1',
    facilityId: 'f1',
    stationId: 'st1',
    date: '2026-07-20',
    type: 'early',
    status: 'open',
    assignedCount: 1,
    capacity: 2,
    ...overrides,
  });

  it('berechnet den Besetzungsgrad mit Ampelfarbe', async () => {
    getByDateRange.mockResolvedValue([
      schicht({ id: 'voll', assignedCount: 2, capacity: 2 }),
      schicht({ id: 'fast', assignedCount: 4, capacity: 5 }),
      schicht({ id: 'leer', assignedCount: 1, capacity: 5 }),
    ]);

    const anzeigen = await getCapacityIndicators(new Date(2026, 6, 20), new Date(2026, 6, 26));
    expect(anzeigen.map(a => [a.shiftId, a.percentage, a.color])).toEqual([
      ['voll', 100, 'success'],
      ['fast', 80, 'warning'],
      ['leer', 20, 'error'],
    ]);
  });

  it('ergänzt Einrichtungs- und Stationsnamen', async () => {
    getByDateRange.mockResolvedValue([schicht()]);
    const anzeigen = await getCapacityIndicators(new Date(2026, 6, 20), new Date(2026, 6, 26));

    expect(anzeigen[0]).toMatchObject({
      facilityName: 'Haus Sonnenschein',
      stationName: 'Station 3',
      type: 'early',
      date: '2026-07-20',
      status: 'open',
    });
  });

  it('nennt Fallback-Namen für fehlende Einrichtung oder Station', async () => {
    getFacilityById.mockResolvedValue(null);
    getByDateRange.mockResolvedValue([schicht()]);
    let anzeigen = await getCapacityIndicators(new Date(2026, 6, 20), new Date(2026, 6, 26));
    expect(anzeigen[0].facilityName).toBe('Unbekannte Einrichtung');

    getFacilityById.mockResolvedValue({ id: 'f1', name: 'Haus Sonnenschein', stations: [] });
    getByDateRange.mockResolvedValue([schicht({ stationId: 'st-weg' })]);
    anzeigen = await getCapacityIndicators(new Date(2026, 6, 20), new Date(2026, 6, 26));
    expect(anzeigen[0].stationName).toBe('st-weg');
  });

  it('nimmt fehlende Kapazitätsangaben als eine Stelle an', async () => {
    getByDateRange.mockResolvedValue([
      schicht({ assignedCount: undefined, capacity: undefined, facilityId: undefined }),
    ]);
    const anzeigen = await getCapacityIndicators(new Date(2026, 6, 20), new Date(2026, 6, 26));

    expect(anzeigen[0]).toMatchObject({
      assigned: 0,
      capacity: 1,
      percentage: 0,
      color: 'error',
      facilityName: 'Unbekannte Einrichtung',
    });
  });

  it('lädt jede Einrichtung nur einmal', async () => {
    getByDateRange.mockResolvedValue([schicht({ id: 's1' }), schicht({ id: 's2' })]);
    await getCapacityIndicators(new Date(2026, 6, 20), new Date(2026, 6, 26));
    expect(getFacilityById).toHaveBeenCalledTimes(1);
  });
});
