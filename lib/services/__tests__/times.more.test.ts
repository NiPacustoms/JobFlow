import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Weitere Stempeluhr-Funktionen (times.ts): Lesen der Zeiteinträge mit
 * Index-Fallback, Pausen anlegen, Krankmeldung, Statistik und Tagesarbeitszeit.
 */

vi.mock('@/lib/firebase', () => ({
  db: {},
  getDb: vi.fn(() => ({})),
  auth: { currentUser: { uid: 'u1' } },
}));

vi.mock('@/lib/utils/companyId', () => ({
  getCompanyIdFromAuth: vi.fn(async () => 'company123'),
}));

const getAssignmentById = vi.fn();
const getMyActiveAssignments = vi.fn();
const getShiftById = vi.fn();

vi.mock('../assignments', () => ({
  assignmentService: {
    getById: (...a: unknown[]) => getAssignmentById(...a),
    getMyActiveAssignments: (...a: unknown[]) => getMyActiveAssignments(...a),
  },
}));
vi.mock('../shifts', () => ({
  shiftService: { getById: (...a: unknown[]) => getShiftById(...a) },
}));

const addDoc = vi.fn(async () => ({ id: 'time1' }));
const updateDoc = vi.fn();

type Antwort =
  | { docs: unknown[]; empty: boolean; size: number; forEach: (cb: (d: unknown) => void) => void }
  | { fehler: Error };
let getDocsAntworten: Antwort[] = [];
let getDocsIndex = 0;

const snapshot = (docs: Array<{ id: string; data: Record<string, unknown> }>) => ({
  docs: docs.map(d => ({ id: d.id, ref: { id: d.id }, data: () => d.data })),
  empty: docs.length === 0,
  size: docs.length,
  forEach(cb: (d: unknown) => void) {
    this.docs.forEach(cb);
  },
});

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => ({})),
  doc: vi.fn(() => ({})),
  addDoc: (...a: unknown[]) => addDoc(...(a as [])),
  updateDoc: (...a: unknown[]) => updateDoc(...a),
  deleteDoc: vi.fn(),
  getDoc: vi.fn(async () => ({ exists: () => true, data: () => ({ companyId: 'companyUser' }) })),
  getDocs: vi.fn(async () => {
    const antwort = getDocsAntworten[getDocsIndex++] ?? snapshot([]);
    if ('fehler' in antwort) throw antwort.fehler;
    return antwort;
  }),
  query: vi.fn(() => ({})),
  where: vi.fn(() => ({})),
  orderBy: vi.fn(() => ({})),
  limit: vi.fn(() => ({})),
  serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
}));

const heute = new Date(2026, 6, 20, 14, 0, 0);
const ts = (d: Date) => ({ toDate: () => d });

const ladeService = async () => (await import('../times')).timesService;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(heute);
  getDocsAntworten = [];
  getDocsIndex = 0;
  addDoc.mockResolvedValue({ id: 'time1' } as never);
  getMyActiveAssignments.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('getAll', () => {
  it('mappt die Firestore-Dokumente mit Standardwerten', async () => {
    getDocsAntworten = [
      snapshot([
        {
          id: 't1',
          data: {
            userId: 'u1',
            date: ts(new Date(2026, 6, 19)),
            type: 'work',
            startTime: '06:00',
            endTime: '14:00',
            hours: 7.5,
            balance: 0.5,
            status: 'completed',
          },
        },
        { id: 't2', data: { userId: 'u1', type: 'sick', status: 'pending' } },
      ]),
    ];
    const times = await (await ladeService()).getAll('u1');

    expect(times).toHaveLength(2);
    expect(times[0]).toMatchObject({ id: 't1', hours: 7.5, balance: 0.5 });
    expect(times[0].date).toEqual(new Date(2026, 6, 19));
    // Fehlende Zahlen werden 0, fehlendes Datum wird "jetzt"
    expect(times[1]).toMatchObject({ hours: 0, balance: 0 });
    expect(times[1].date).toEqual(heute);
  });

  it('reicht Firestore-Fehler durch', async () => {
    getDocsAntworten = [{ fehler: new Error('kein Zugriff') }];
    await expect((await ladeService()).getAll('u1')).rejects.toThrow('kein Zugriff');
  });
});

describe('getByUserId', () => {
  it('sortiert absteigend und übernimmt Krankmeldungs-Zeiträume', async () => {
    getDocsAntworten = [
      snapshot([
        {
          id: 'alt',
          data: { userId: 'u1', date: ts(new Date(2026, 6, 1)), type: 'work', status: 'completed' },
        },
        {
          id: 'neu',
          data: {
            userId: 'u1',
            date: ts(new Date(2026, 6, 19)),
            type: 'sick',
            status: 'approved',
            startDate: ts(new Date(2026, 6, 19)),
            endDate: new Date(2026, 6, 21),
            days: 3,
          },
        },
      ]),
    ];
    const times = await (await ladeService()).getByUserId('u1');

    expect(times.map(t => t.id)).toEqual(['neu', 'alt']);
    const krank = times[0] as (typeof times)[0] & { startDate?: Date; endDate?: Date; days?: number };
    expect(krank.startDate).toEqual(new Date(2026, 6, 19));
    expect(krank.endDate).toEqual(new Date(2026, 6, 21));
    expect(krank.days).toBe(3);
  });

  it('weicht bei fehlendem Index auf die Abfrage ohne Sortierung aus', async () => {
    getDocsAntworten = [
      { fehler: Object.assign(new Error('The query requires an index'), { code: 'failed-precondition' }) },
      snapshot([
        { id: 't1', data: { userId: 'u1', date: ts(new Date(2026, 6, 19)), type: 'work', status: 'completed' } },
      ]),
    ];
    const times = await (await ladeService()).getByUserId('u1');
    expect(times).toHaveLength(1);
  });

  it('liefert eine leere Liste, wenn auch der Fallback scheitert', async () => {
    getDocsAntworten = [
      { fehler: Object.assign(new Error('requires an index'), { code: 'failed-precondition' }) },
      { fehler: new Error('immer noch kaputt') },
    ];
    await expect((await ladeService()).getByUserId('u1')).resolves.toEqual([]);
  });

  it('liefert bei anderen Fehlern eine leere Liste', async () => {
    getDocsAntworten = [{ fehler: new Error('kein Zugriff') }];
    await expect((await ladeService()).getByUserId('u1')).resolves.toEqual([]);
  });
});

describe('addBreak', () => {
  it('legt eine Pause gegen einen ausdrücklich gewählten Einsatz an', async () => {
    getAssignmentById.mockResolvedValue({
      id: 'a1',
      userId: 'u1',
      status: 'accepted',
      companyId: 'companyA',
    });
    const id = await (await ladeService()).addBreak('u1', { reason: 'Mittag', duration: 30 }, 'a1');

    expect(id).toBe('time1');
    const daten = addDoc.mock.calls[0][1] as Record<string, unknown>;
    expect(daten).toMatchObject({
      userId: 'u1',
      assignmentId: 'a1',
      type: 'break',
      hours: 0.5,
      balance: -0.5,
      status: 'active',
      reason: 'Mittag',
      companyId: 'company123',
    });
  });

  it('lehnt fremde oder inaktive Einsätze ab', async () => {
    getAssignmentById.mockResolvedValue({ id: 'a1', userId: 'anderer', status: 'accepted' });
    await expect(
      (await ladeService()).addBreak('u1', { reason: 'Mittag', duration: 30 }, 'a1')
    ).rejects.toThrow('gehört nicht zum Benutzer');

    getAssignmentById.mockResolvedValue({ id: 'a1', userId: 'u1', status: 'pending' });
    await expect(
      (await ladeService()).addBreak('u1', { reason: 'Mittag', duration: 30 }, 'a1')
    ).rejects.toThrow('nicht aktiv');
  });

  it('findet den Einsatz über den laufenden Arbeitseintrag', async () => {
    getDocsAntworten = [
      snapshot([{ id: 'w1', data: { userId: 'u1', type: 'work', status: 'active', assignmentId: 'a7' } }]),
    ];
    getAssignmentById.mockResolvedValue({ id: 'a7', userId: 'u1', status: 'accepted', companyId: 'companyA' });

    await (await ladeService()).addBreak('u1', { reason: 'Kaffee', duration: 15 });
    const daten = addDoc.mock.calls[0][1] as Record<string, unknown>;
    expect(daten.assignmentId).toBe('a7');
  });

  it('findet andernfalls den heutigen Einsatz über die Zuweisungen', async () => {
    getDocsAntworten = [snapshot([])]; // kein laufender Arbeitseintrag
    getMyActiveAssignments.mockResolvedValue([{ id: 'a9', userId: 'u1', shiftId: 's9', status: 'accepted' }]);
    getShiftById.mockResolvedValue({ id: 's9', date: new Date(2026, 6, 20) });

    await (await ladeService()).addBreak('u1', { reason: 'Kaffee', duration: 15 });
    const daten = addDoc.mock.calls[0][1] as Record<string, unknown>;
    expect(daten.assignmentId).toBe('a9');
  });

  it('verweigert die Pause ohne aktiven Einsatz', async () => {
    getDocsAntworten = [snapshot([])];
    getMyActiveAssignments.mockResolvedValue([]);
    await expect(
      (await ladeService()).addBreak('u1', { reason: 'Kaffee', duration: 15 })
    ).rejects.toThrow('Kein aktiver zugewiesener Auftrag');
  });
});

describe('reportSick', () => {
  it('meldet einen mehrtägigen Zeitraum mit 8 Stunden je Tag', async () => {
    const id = await (await ladeService()).reportSick('u1', {
      startDate: new Date(2026, 6, 20),
      endDate: new Date(2026, 6, 22),
      reason: 'Grippe',
      doctorNote: 'Attest liegt vor',
    });

    expect(id).toBe('time1');
    const daten = addDoc.mock.calls[0][1] as Record<string, unknown>;
    expect(daten).toMatchObject({
      userId: 'u1',
      type: 'sick',
      days: 3,
      hours: 24,
      balance: -24,
      status: 'pending',
      reason: 'Grippe',
      doctorNote: 'Attest liegt vor',
    });
  });

  it('zählt einen einzelnen Krankheitstag als einen Tag', async () => {
    await (await ladeService()).reportSick('u1', {
      startDate: new Date(2026, 6, 20),
      endDate: new Date(2026, 6, 20),
      reason: 'Migräne',
    });
    const daten = addDoc.mock.calls[0][1] as Record<string, unknown>;
    expect(daten.days).toBe(1);
    expect(daten.hours).toBe(8);
  });
});

describe('exportTimes', () => {
  const arbeitseintrag = {
    id: 'z1',
    data: {
      userId: 'u1',
      date: ts(new Date(2026, 6, 20)),
      type: 'work',
      startTime: '06:00',
      endTime: '14:00',
      hours: 7.5,
      balance: 0,
      status: 'completed',
    },
  };

  it('erzeugt für PDF ein gebrandetes Dokument mit den Einträgen', async () => {
    vi.useRealTimers();
    getDocsAntworten = [snapshot([arbeitseintrag])];
    const generateDocument = vi.fn(async () => ({
      url: 'https://storage.example/zeiten.pdf',
      fileName: 'Meine_Zeiten.pdf',
      fileSize: 1234,
      createdAt: new Date(),
    }));
    vi.doMock('../documentGeneration', () => ({
      documentGenerationService: { generateDocument },
    }));

    const service = await ladeService();
    await expect(service.exportTimes('pdf', 'u1')).resolves.toEqual({
      art: 'url',
      wert: 'https://storage.example/zeiten.pdf',
    });
    expect(generateDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'time-entries-report',
        userId: 'u1',
        timeEntries: [expect.objectContaining({ type: 'work', hours: 7.5 })],
      })
    );
    vi.doUnmock('../documentGeneration');
  });

  it('erzeugt für CSV eine lokale Datei über den ExportService', async () => {
    vi.useRealTimers();
    getDocsAntworten = [snapshot([arbeitseintrag])];
    const exportToCSV = vi.fn(async (_zeilen: unknown, o: { filename: string }) => o.filename);
    vi.doMock('../exportService', () => ({
      ExportService: { exportToCSV, exportToExcel: vi.fn() },
    }));

    const service = await ladeService();
    const ergebnis = await service.exportTimes('csv', 'u1');
    expect(ergebnis.art).toBe('datei');
    expect(ergebnis.wert).toMatch(/^meine-zeiten-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(exportToCSV).toHaveBeenCalledWith(
      [expect.objectContaining({ Art: 'Arbeit', Stunden: 7.5 })],
      expect.anything()
    );
    vi.doUnmock('../exportService');
  });

  it('verweigert den Export ohne Benutzer-ID oder ohne Einträge', async () => {
    const service = await ladeService();
    await expect(service.exportTimes('csv')).rejects.toThrow('Benutzer-ID');

    getDocsAntworten = [snapshot([])];
    await expect(service.exportTimes('csv', 'u1')).rejects.toThrow('Keine Zeiteinträge');
  });
});

describe('getStats', () => {
  it('summiert Arbeit, Überstunden und Krankheit', async () => {
    getDocsAntworten = [
      snapshot([
        { id: 't1', data: { type: 'work', hours: 8, balance: 1 } },
        { id: 't2', data: { type: 'work', hours: 7, balance: -0.5 } },
        { id: 't3', data: { type: 'sick', hours: 16, balance: -16 } },
        { id: 't4', data: { type: 'break', hours: 0.5, balance: -0.5 } },
      ]),
    ];
    await expect((await ladeService()).getStats()).resolves.toEqual({
      totalHours: 31.5,
      workHours: 15,
      overtimeHours: 1,
      sickHours: 16,
      totalBalance: -16,
    });
  });
});

describe('getTodayWorkTime', () => {
  it('kombiniert laufende und abgeschlossene Einträge des Tages', async () => {
    getDocsAntworten = [
      snapshot([
        // läuft seit 10:00, Systemzeit 14:00 → 240 Minuten
        { id: 'aktiv', data: { status: 'active', startTime: '10:00', date: ts(new Date(2026, 6, 20)) } },
        // abgeschlossen mit 2 Stunden → 120 Minuten
        { id: 'fertig', data: { status: 'completed', hours: 2, date: ts(new Date(2026, 6, 20)) } },
      ]),
    ];
    await expect((await ladeService()).getTodayWorkTime()).resolves.toEqual({
      hours: '6h 0min',
      minutes: 360,
    });
  });

  it('liefert 0 ohne Einträge', async () => {
    getDocsAntworten = [snapshot([])];
    await expect((await ladeService()).getTodayWorkTime()).resolves.toEqual({
      hours: '0h 0min',
      minutes: 0,
    });
  });
});
