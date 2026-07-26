import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Tests der Stempeluhr (times.ts): Schicht starten/beenden und Pausen.
 * Kernregel für die Zeitarbeit: Arbeitszeit wird nur gegen einen zugewiesenen
 * Einsatz gestempelt, und beim Beenden werden die Pausen des Tages abgezogen.
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
let getDocsAntworten: Array<{ docs: unknown[]; empty: boolean; size: number; forEach: (cb: (d: unknown) => void) => void }> = [];
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
  getDoc: vi.fn(async () => ({ exists: () => true, data: () => ({ companyId: 'company123' }) })),
  getDocs: vi.fn(async () => getDocsAntworten[getDocsIndex++] ?? snapshot([])),
  query: vi.fn(() => ({})),
  where: vi.fn(() => ({})),
  orderBy: vi.fn(() => ({})),
  limit: vi.fn(() => ({})),
  serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
}));

const heute = new Date(2026, 6, 20, 14, 0, 0);

const ladeService = async () => (await import('../times')).timesService;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(heute);
  getDocsAntworten = [];
  getDocsIndex = 0;
  addDoc.mockResolvedValue({ id: 'time1' } as never);
  getShiftById.mockResolvedValue({ id: 's1', date: new Date(2026, 6, 20), facilityId: 'f1' });
});

describe('startShift', () => {
  it('stempelt gegen einen ausdrücklich gewählten Einsatz ein', async () => {
    getAssignmentById.mockResolvedValue({
      id: 'a1',
      userId: 'u1',
      shiftId: 's1',
      status: 'accepted',
      companyId: 'company123',
    });
    const service = await ladeService();
    const id = await service.startShift('u1', 'a1');

    expect(id).toBe('time1');
    expect(addDoc.mock.calls[0][1]).toMatchObject({
      userId: 'u1',
      assignmentId: 'a1',
      type: 'work',
      status: 'active',
      startTime: '14:00',
      companyId: 'company123',
    });
  });

  it('lehnt einen fremden Einsatz ab', async () => {
    getAssignmentById.mockResolvedValue({ id: 'a1', userId: 'anderer', shiftId: 's1', status: 'accepted' });
    const service = await ladeService();
    await expect(service.startShift('u1', 'a1')).rejects.toThrow(/gehört nicht zum Benutzer/);
  });

  it('lehnt einen nicht existierenden Einsatz ab', async () => {
    getAssignmentById.mockResolvedValue(null);
    const service = await ladeService();
    await expect(service.startShift('u1', 'a1')).rejects.toThrow(/nicht gefunden/);
  });

  it('lehnt einen abgelehnten oder abgeschlossenen Einsatz ab', async () => {
    getAssignmentById.mockResolvedValue({ id: 'a1', userId: 'u1', shiftId: 's1', status: 'declined' });
    const service = await ladeService();
    await expect(service.startShift('u1', 'a1')).rejects.toThrow(/nicht aktiv/);
  });

  it('lehnt einen Einsatz ab, dessen Schicht nicht heute ist', async () => {
    getAssignmentById.mockResolvedValue({ id: 'a1', userId: 'u1', shiftId: 's1', status: 'accepted' });
    getShiftById.mockResolvedValue({ id: 's1', date: new Date(2026, 6, 25) });
    const service = await ladeService();
    await expect(service.startShift('u1', 'a1')).rejects.toThrow(/nicht für heute/);
  });

  it('findet ohne Angabe den heutigen Einsatz automatisch', async () => {
    getMyActiveAssignments.mockResolvedValue([
      { id: 'a-morgen', userId: 'u1', shiftId: 's-morgen', status: 'accepted' },
      { id: 'a-heute', userId: 'u1', shiftId: 's-heute', status: 'accepted' },
    ]);
    getShiftById.mockImplementation(async (id: string) =>
      id === 's-heute'
        ? { id: 's-heute', date: new Date(2026, 6, 20) }
        : { id: 's-morgen', date: new Date(2026, 6, 21) }
    );
    const service = await ladeService();
    await service.startShift('u1');
    expect(addDoc.mock.calls[0][1]).toMatchObject({ assignmentId: 'a-heute' });
  });

  it('verweigert das Einstempeln ohne Einsatz für heute', async () => {
    getMyActiveAssignments.mockResolvedValue([]);
    const service = await ladeService();
    await expect(service.startShift('u1')).rejects.toThrow(/Kein aktiver zugewiesener Auftrag/);
  });

  it('übernimmt die companyId aus dem Einsatz, wenn der Claim fehlt', async () => {
    const { getCompanyIdFromAuth } = await import('@/lib/utils/companyId');
    vi.mocked(getCompanyIdFromAuth).mockResolvedValueOnce(null as never);
    getAssignmentById.mockResolvedValue({
      id: 'a1',
      userId: 'u1',
      shiftId: 's1',
      status: 'assigned',
      companyId: 'firmaAusEinsatz',
    });
    const service = await ladeService();
    await service.startShift('u1', 'a1');
    expect(addDoc.mock.calls[0][1]).toMatchObject({ companyId: 'firmaAusEinsatz' });
  });
});

describe('endShift', () => {
  it('wirft, wenn keine Schicht läuft', async () => {
    getDocsAntworten = [snapshot([])];
    const service = await ladeService();
    await expect(service.endShift('u1')).rejects.toThrow('Keine aktive Schicht gefunden');
  });

  it('rechnet die Arbeitszeit ohne Pause korrekt ab', async () => {
    getDocsAntworten = [
      snapshot([
        { id: 'w1', data: { date: new Date(2026, 6, 20), startTime: '06:00', assignmentId: 'a1' } },
      ]),
      snapshot([]), // keine Pausen
    ];
    const service = await ladeService();
    await service.endShift('u1');

    expect(updateDoc.mock.calls[0][1]).toMatchObject({
      endTime: '14:00',
      hours: 8,
      balance: 0,
      status: 'completed',
    });
  });

  it('zieht Pausen desselben Einsatzes ab', async () => {
    getDocsAntworten = [
      snapshot([
        { id: 'w1', data: { date: new Date(2026, 6, 20), startTime: '06:00', assignmentId: 'a1' } },
      ]),
      snapshot([
        { id: 'b1', data: { date: new Date(2026, 6, 20), assignmentId: 'a1', hours: 0.5, startTime: '10:00' } },
      ]),
    ];
    const service = await ladeService();
    await service.endShift('u1');
    expect(updateDoc.mock.calls[0][1]).toMatchObject({ hours: 7.5, balance: -0.5 });
  });

  it('ignoriert Pausen eines anderen Einsatzes', async () => {
    getDocsAntworten = [
      snapshot([
        { id: 'w1', data: { date: new Date(2026, 6, 20), startTime: '06:00', assignmentId: 'a1' } },
      ]),
      snapshot([
        { id: 'b1', data: { date: new Date(2026, 6, 20), assignmentId: 'a2', hours: 2, startTime: '10:00' } },
      ]),
    ];
    const service = await ladeService();
    await service.endShift('u1');
    expect(updateDoc.mock.calls[0][1]).toMatchObject({ hours: 8 });
  });

  it('ignoriert Pausen eines anderen Tages', async () => {
    getDocsAntworten = [
      snapshot([
        { id: 'w1', data: { date: new Date(2026, 6, 20), startTime: '06:00', assignmentId: 'a1' } },
      ]),
      snapshot([
        { id: 'b1', data: { date: new Date(2026, 6, 19), assignmentId: 'a1', hours: 3, startTime: '10:00' } },
      ]),
    ];
    const service = await ladeService();
    await service.endShift('u1');
    expect(updateDoc.mock.calls[0][1]).toMatchObject({ hours: 8 });
  });

  it('berücksichtigt Altdaten ohne assignmentId anhand der Uhrzeit', async () => {
    getDocsAntworten = [
      snapshot([{ id: 'w1', data: { date: new Date(2026, 6, 20), startTime: '06:00' } }]),
      snapshot([
        // innerhalb der Schicht → zählt
        { id: 'b1', data: { date: new Date(2026, 6, 20), hours: 0.5, startTime: '10:00' } },
        // vor Schichtbeginn → zählt nicht
        { id: 'b2', data: { date: new Date(2026, 6, 20), hours: 1, startTime: '05:00' } },
      ]),
    ];
    const service = await ladeService();
    await service.endShift('u1');
    expect(updateDoc.mock.calls[0][1]).toMatchObject({ hours: 7.5 });
  });

  it('wird bei überlangen Pausen nicht negativ', async () => {
    getDocsAntworten = [
      snapshot([
        { id: 'w1', data: { date: new Date(2026, 6, 20), startTime: '13:00', assignmentId: 'a1' } },
      ]),
      snapshot([
        { id: 'b1', data: { date: new Date(2026, 6, 20), assignmentId: 'a1', hours: 5, startTime: '13:10' } },
      ]),
    ];
    const service = await ladeService();
    await service.endShift('u1');
    expect(updateDoc.mock.calls[0][1]).toMatchObject({ hours: 0 });
  });

  it('verarbeitet Firestore-Timestamps im Datumsfeld', async () => {
    getDocsAntworten = [
      snapshot([
        {
          id: 'w1',
          data: {
            date: { toDate: () => new Date(2026, 6, 20) },
            startTime: '06:00',
            assignmentId: 'a1',
          },
        },
      ]),
      snapshot([]),
    ];
    const service = await ladeService();
    await service.endShift('u1');
    expect(updateDoc.mock.calls[0][1]).toMatchObject({ hours: 8 });
  });
});

describe('endBreak', () => {
  it('verlangt eine Benutzer-ID', async () => {
    const service = await ladeService();
    await expect(service.endBreak('')).rejects.toThrow('User ID ist erforderlich');
  });

  it('wirft, wenn keine Pause läuft', async () => {
    getDocsAntworten = [snapshot([]), snapshot([])];
    const service = await ladeService();
    await expect(service.endBreak('u1')).rejects.toThrow(/Keine aktive Pause/);
  });

  it('beendet die laufende Pause und schreibt die Dauer fort', async () => {
    getDocsAntworten = [
      snapshot([
        {
          id: 'b1',
          data: { date: new Date(2026, 6, 20), startTime: '13:30', assignmentId: 'a1', type: 'break' },
        },
      ]),
    ];
    const service = await ladeService();
    await service.endBreak('u1');
    expect(updateDoc).toHaveBeenCalled();
    const daten = updateDoc.mock.calls[0][1] as { status: string; hours: number };
    expect(daten.status).toBe('completed');
    expect(daten.hours).toBeCloseTo(0.5, 2);
  });
});

describe('getCurrentStatus', () => {
  it('meldet "working", wenn eine Schicht läuft', async () => {
    getDocsAntworten = [snapshot([{ id: 'w1', data: {} }])];
    const service = await ladeService();
    expect(await service.getCurrentStatus()).toBe('working');
  });

  it('meldet "break", wenn eine Pause läuft', async () => {
    getDocsAntworten = [snapshot([]), snapshot([{ id: 'b1', data: {} }])];
    const service = await ladeService();
    expect(await service.getCurrentStatus()).toBe('break');
  });

  it('meldet "sick" bei genehmigter Krankmeldung', async () => {
    getDocsAntworten = [snapshot([]), snapshot([]), snapshot([{ id: 's1', data: {} }])];
    const service = await ladeService();
    expect(await service.getCurrentStatus()).toBe('sick');
  });

  it('meldet "off", wenn nichts läuft', async () => {
    getDocsAntworten = [snapshot([]), snapshot([]), snapshot([])];
    const service = await ladeService();
    expect(await service.getCurrentStatus()).toBe('off');
  });
});
