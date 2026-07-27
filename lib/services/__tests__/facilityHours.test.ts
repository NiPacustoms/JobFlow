import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Stunden-Übersicht je Einrichtung: geplante Stunden aus Schichten,
 * geleistete Stunden aus Nachweisen, fehlende Einträge und Fehler-Fallbacks.
 */

vi.mock('@/lib/firebase', () => ({ getDb: vi.fn(() => ({})) }));

const getCompanyIdFromAuth = vi.fn();
vi.mock('@/lib/utils/companyId', () => ({
  getCompanyIdFromAuth: (...a: unknown[]) => getCompanyIdFromAuth(...a),
}));

const getAllFacilities = vi.fn();
vi.mock('@/lib/services/facilities', () => ({
  facilityService: { getAll: (...a: unknown[]) => getAllFacilities(...a) },
}));

vi.mock('@/lib/logging', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

type Antwort = { docs: Array<{ data: Record<string, unknown> }> } | { fehler: Error };
// Antworten je Sammlung (shifts, timesheets) in Aufrufreihenfolge
let antworten: Record<string, Antwort[]> = {};

const snapshot = (docs: Array<Record<string, unknown>>) => ({
  forEach(cb: (d: { data: () => Record<string, unknown> }) => void) {
    docs.forEach(d => cb({ data: () => d }));
  },
});

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db: unknown, name: string) => ({ sammlung: name })),
  query: vi.fn((quelle: { sammlung: string }) => ({ sammlung: quelle.sammlung })),
  where: vi.fn(),
  getDocs: vi.fn(async (q: { sammlung: string }) => {
    const naechste = antworten[q.sammlung]?.shift();
    if (naechste && 'fehler' in naechste) throw naechste.fehler;
    return snapshot((naechste?.docs ?? []).map(d => d.data));
  }),
}));

import { facilityHoursService } from '../facilityHours';

const einrichtung = (id: string, name: string) => ({ id, name, companyId: 'firmaA' });

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 6, 22, 12, 0, 0)); // Mittwoch
  antworten = { shifts: [], timesheets: [] };
  getCompanyIdFromAuth.mockResolvedValue('firmaA');
  getAllFacilities.mockResolvedValue([einrichtung('f1', 'Haus Sonnenschein')]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('getSummary', () => {
  it('summiert geplante und geleistete Stunden einer Einrichtung', async () => {
    antworten.shifts = [
      {
        docs: [
          // 8h-Schicht mit 2 Plätzen → 16 geplante Stunden
          { data: { startTime: '06:00', endTime: '14:00', capacity: 2 } },
          // Nachtschicht über Mitternacht → 8 Stunden
          { data: { startTime: '22:00', endTime: '06:00' } },
        ],
      },
    ];
    antworten.timesheets = [
      {
        docs: [
          { data: { status: 'approved', totalHours: 7.5 } },
          // ohne totalHours → aus den Uhrzeiten berechnet (8h)
          { data: { status: 'submitted', startTime: '06:00', endTime: '14:00' } },
          { data: { status: 'draft', totalHours: 3 } }, // zählt als offen
        ],
      },
    ];

    const zusammenfassung = await facilityHoursService.getSummary({
      startDate: new Date(2026, 6, 20),
      endDate: new Date(2026, 6, 26),
    });

    expect(zusammenfassung).toHaveLength(1);
    expect(zusammenfassung[0]).toMatchObject({
      facilityId: 'f1',
      facilityName: 'Haus Sonnenschein',
      plannedHours: 24,
      workedHours: 15.5,
      shiftCount: 2,
      timesheetCount: 2,
      pendingTimesheets: 1,
      missingEntries: 0,
    });
  });

  it('nutzt durationMinutes und die höchste Platzzahl, wenn vorhanden', async () => {
    antworten.shifts = [
      { docs: [{ data: { durationMinutes: 480, assignedCount: 1, maxStaff: 3 } }] },
    ];
    antworten.timesheets = [{ docs: [] }];

    const zusammenfassung = await facilityHoursService.getSummary();
    expect(zusammenfassung[0].plannedHours).toBe(24); // 8h × 3 Plätze
    expect(zusammenfassung[0].missingEntries).toBe(1);
  });

  it('filtert auf eine einzelne Einrichtung', async () => {
    getAllFacilities.mockResolvedValue([
      einrichtung('f1', 'Haus Sonnenschein'),
      einrichtung('f2', 'Klinik Nord'),
    ]);
    antworten.shifts = [{ docs: [] }];
    antworten.timesheets = [{ docs: [] }];

    const zusammenfassung = await facilityHoursService.getSummary({ facilityId: 'f2' });
    expect(zusammenfassung).toHaveLength(1);
    expect(zusammenfassung[0].facilityId).toBe('f2');
  });

  it('sortiert die Einrichtungen alphabetisch', async () => {
    getAllFacilities.mockResolvedValue([
      einrichtung('f2', 'Zentrum Süd'),
      einrichtung('f1', 'Ambulanz West'),
    ]);
    antworten.shifts = [{ docs: [] }, { docs: [] }];
    antworten.timesheets = [{ docs: [] }, { docs: [] }];

    const zusammenfassung = await facilityHoursService.getSummary();
    expect(zusammenfassung.map(s => s.facilityName)).toEqual(['Ambulanz West', 'Zentrum Süd']);
  });

  it('liefert ohne Company-ID oder ohne Einrichtungen eine leere Liste', async () => {
    getCompanyIdFromAuth.mockResolvedValue(null);
    await expect(facilityHoursService.getSummary()).resolves.toEqual([]);

    getCompanyIdFromAuth.mockResolvedValue('firmaA');
    getAllFacilities.mockResolvedValue([]);
    await expect(facilityHoursService.getSummary()).resolves.toEqual([]);
  });

  it('überspringt Einrichtungen ohne companyId', async () => {
    getAllFacilities.mockResolvedValue([{ id: 'f1', name: 'Ohne Firma' }]);
    await expect(facilityHoursService.getSummary()).resolves.toEqual([]);
  });

  it('markiert Einrichtungen ohne Leserecht als unvollständig statt zu scheitern', async () => {
    antworten.shifts = [{ fehler: Object.assign(new Error('nope'), { code: 'permission-denied' }) }];
    antworten.timesheets = [{ docs: [] }];

    const zusammenfassung = await facilityHoursService.getSummary();
    expect(zusammenfassung[0]).toMatchObject({
      facilityId: 'f1',
      plannedHours: 0,
      incompleteData: true,
    });
  });

  it('macht fehlende Firestore-Indizes als AppError sichtbar', async () => {
    antworten.shifts = [
      { fehler: Object.assign(new Error('The query requires an index'), { code: 'failed-precondition' }) },
    ];
    antworten.timesheets = [{ docs: [] }];

    await expect(facilityHoursService.getSummary()).rejects.toMatchObject({
      code: 'FIREBASE_MISSING_INDEX',
    });
  });

  it('reicht sonstige Fehler durch', async () => {
    antworten.shifts = [{ fehler: new Error('netzwerk kaputt') }];
    antworten.timesheets = [{ docs: [] }];
    await expect(facilityHoursService.getSummary()).rejects.toThrow('netzwerk kaputt');
  });

  it('vertauscht ein verdrehtes Datumsintervall', async () => {
    antworten.shifts = [{ docs: [] }];
    antworten.timesheets = [{ docs: [] }];
    const zusammenfassung = await facilityHoursService.getSummary({
      startDate: new Date(2026, 6, 26),
      endDate: new Date(2026, 6, 20),
    });
    expect(zusammenfassung[0].range.startDate.getDate()).toBe(20);
    expect(zusammenfassung[0].range.endDate.getDate()).toBe(26);
  });

  it('ignoriert Schichten mit unbrauchbaren Uhrzeiten', async () => {
    antworten.shifts = [
      { docs: [{ data: { startTime: 'ab:cd', endTime: '14:00' } }, { data: {} }] },
    ];
    antworten.timesheets = [{ docs: [] }];
    const zusammenfassung = await facilityHoursService.getSummary();
    expect(zusammenfassung[0].plannedHours).toBe(0);
    expect(zusammenfassung[0].shiftCount).toBe(2);
  });
});
