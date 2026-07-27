import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { harness, firestoreModuleMock, ts } from './helpers/firestoreHarness';

/**
 * Einsätze – Datumsfilter (Dienstplan), heutiger/kommende Einsätze und der
 * komplette Stundennachweis-Versand (PDF erzeugen, E-Mails an Mitarbeiter,
 * Admins, Einrichtung und Zentrale, Dokumentablage).
 */

vi.mock('@/lib/firebase', () => ({ db: {}, getDb: vi.fn(() => ({})) }));
vi.mock('@/lib/utils/companyId', () => ({
  getCompanyIdFromAuth: vi.fn(async () => 'firmaA'),
}));
vi.mock('firebase/firestore', () => firestoreModuleMock());

const getShiftById = vi.fn();
vi.mock('../shifts', () => ({
  shiftService: { getById: (...a: unknown[]) => getShiftById(...a) },
}));

const getUserById = vi.fn();
const getAllUsers = vi.fn();
vi.mock('../users', () => ({
  userService: {
    getById: (...a: unknown[]) => getUserById(...a),
    getAll: (...a: unknown[]) => getAllUsers(...a),
  },
}));

const getFacilityById = vi.fn();
vi.mock('../facilities', () => ({
  facilityService: { getById: (...a: unknown[]) => getFacilityById(...a) },
}));

const getTimesheetsByRange = vi.fn();
vi.mock('../timesheets', () => ({
  timesheetService: { getByUserAndDateRange: (...a: unknown[]) => getTimesheetsByRange(...a) },
}));

const generateDocument = vi.fn();
vi.mock('../documentGeneration', () => ({
  documentGenerationService: { generateDocument: (...a: unknown[]) => generateDocument(...a) },
}));

const sendSignatureEmail = vi.fn();
vi.mock('../email', () => ({
  sendAssignmentSignatureEmail: (...a: unknown[]) => sendSignatureEmail(...a),
}));

const createDocument = vi.fn();
vi.mock('../documents', () => ({
  documentService: { create: (...a: unknown[]) => createDocument(...a) },
}));

vi.mock('@/lib/config/legal', () => ({
  getLegalInfo: () => ({ contact: { email: 'info@aufabruf.eu' } }),
}));

const lade = async () => (await import('../assignments')).assignmentService;

const einsatz = (id: string, daten: Record<string, unknown> = {}) => ({
  id,
  data: {
    userId: 'u1',
    shiftId: 's1',
    companyId: 'firmaA',
    status: 'assigned',
    assignedAt: ts(new Date(2026, 6, 18)),
    createdAt: ts(new Date(2026, 6, 18)),
    updatedAt: ts(new Date(2026, 6, 18)),
    ...daten,
  },
});

beforeEach(async () => {
  vi.clearAllMocks();
  harness.reset();
  const { getCompanyIdFromAuth } = await import('@/lib/utils/companyId');
  vi.mocked(getCompanyIdFromAuth).mockResolvedValue('firmaA');
  getShiftById.mockResolvedValue({ id: 's1', date: '2026-07-20', facilityId: 'f1' });
  getUserById.mockResolvedValue({ id: 'u1', displayName: 'Anna Muster', email: 'anna@aufabruf.eu' });
  getAllUsers.mockResolvedValue({ data: [] });
  getFacilityById.mockResolvedValue({ id: 'f1', name: 'Haus Sonnenschein', email: 'info@haus.de' });
  getTimesheetsByRange.mockResolvedValue([{ id: 't1' }]);
  generateDocument.mockResolvedValue({ url: 'https://storage.example/nachweis.pdf', fileSize: 1234 });
  sendSignatureEmail.mockResolvedValue(undefined);
  createDocument.mockResolvedValue('doc1');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('getByUserAndDateRange', () => {
  it('filtert nach dem Schichtdatum, nicht nach dem Zuweisungszeitpunkt', async () => {
    harness.setDocs([einsatz('a1', { shiftId: 's-juli' }), einsatz('a2', { shiftId: 's-august' })]);
    getShiftById.mockImplementation(async (id: string) =>
      id === 's-juli' ? { id, date: '2026-07-22' } : { id, date: '2026-08-15' }
    );

    const service = await lade();
    const ergebnis = await service.getByUserAndDateRange(
      'u1',
      new Date(2026, 6, 20),
      new Date(2026, 6, 26),
      'firmaA'
    );

    expect(ergebnis).toHaveLength(1);
    expect(ergebnis[0].shiftId).toBe('s-juli');
  });

  it('überspringt Einsätze mit nicht ladbaren Schichten', async () => {
    harness.setDocs([einsatz('a1')]);
    getShiftById.mockRejectedValue(new Error('kein Zugriff'));
    const service = await lade();
    await expect(
      service.getByUserAndDateRange('u1', new Date(2026, 6, 20), new Date(2026, 6, 26), 'firmaA')
    ).resolves.toEqual([]);
  });

  it('liefert ohne ermittelbare companyId eine leere Liste', async () => {
    const { getCompanyIdFromAuth } = await import('@/lib/utils/companyId');
    vi.mocked(getCompanyIdFromAuth).mockResolvedValue(null);
    const service = await lade();
    await expect(
      service.getByUserAndDateRange('u1', new Date(2026, 6, 20), new Date(2026, 6, 26))
    ).resolves.toEqual([]);
  });
});

describe('getTodayAssignment / getUpcomingAssignments', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 20, 12, 0, 0));
  });

  it('findet den Einsatz, dessen Schicht heute stattfindet', async () => {
    harness.setDocs([
      einsatz('heute', { status: 'accepted', shiftId: 's-heute' }),
      einsatz('morgen', { status: 'accepted', shiftId: 's-morgen' }),
    ]);
    getShiftById.mockImplementation(async (id: string) =>
      id === 's-heute'
        ? { id, date: new Date(2026, 6, 20, 6, 0) }
        : { id, date: new Date(2026, 6, 21, 6, 0) }
    );

    const service = await lade();
    const heute = await service.getTodayAssignment('u1');
    expect(heute?.id).toBe('heute');
  });

  it('liefert null ohne aktive Einsätze oder ohne heutige Schicht', async () => {
    harness.setDocs([einsatz('a1', { status: 'declined' })]);
    const service = await lade();
    await expect(service.getTodayAssignment('u1')).resolves.toBeNull();
  });

  it('liefert die kommenden Einsätze sortiert und auf fünf begrenzt', async () => {
    const eintraege = Array.from({ length: 7 }, (_, i) =>
      einsatz(`a${i}`, { status: 'accepted', shiftId: `s${i}` })
    );
    harness.setDocs(eintraege);
    getShiftById.mockImplementation(async (id: string) => {
      const i = Number(id.slice(1));
      // s0 liegt heute (zählt nicht), s1–s6 an den Folgetagen
      return { id, date: new Date(2026, 6, 20 + i, 6, 0) };
    });

    const service = await lade();
    const kommende = await service.getUpcomingAssignments('u1');
    expect(kommende).toHaveLength(5);
    expect(kommende[0].shiftId).toBe('s1'); // frühester zukünftiger Einsatz zuerst
  });
});

describe('generateSignaturePDFAndSendEmails', () => {
  it('erzeugt den Nachweis und verschickt ihn an alle Beteiligten', async () => {
    harness.setDoc(einsatz('a1'));
    getAllUsers.mockResolvedValue({
      data: [
        { id: 'admin1', email: 'chef@aufabruf.eu' },
        { id: 'admin2' }, // ohne E-Mail: bekommt nur die Dokumentablage
      ],
    });

    const service = await lade();
    const ergebnis = await service.generateSignaturePDFAndSendEmails('a1');

    expect(ergebnis).toEqual({ pdfUrl: 'https://storage.example/nachweis.pdf', emailsSent: true });
    expect(generateDocument).toHaveBeenCalledWith({
      type: 'assignment-signatures',
      assignmentId: 'a1',
      timesheetIds: ['t1'],
    });

    // Mitarbeiter, Admin mit Mail, Einrichtung, Zentrale = 4 E-Mails
    expect(sendSignatureEmail).toHaveBeenCalledTimes(4);
    const empfaenger = sendSignatureEmail.mock.calls.map(c => (c[0] as { to: string }).to);
    expect(empfaenger).toEqual(
      expect.arrayContaining(['anna@aufabruf.eu', 'chef@aufabruf.eu', 'info@haus.de', 'info@aufabruf.eu'])
    );

    // Dokumentablage für beide Admins
    expect(createDocument).toHaveBeenCalledTimes(2);

    // PDF-Status am Einsatz fortgeschrieben
    const updates = harness.writes.filter(w => w.art === 'update');
    expect(updates.some(w => (w.daten as Record<string, unknown>).pdfGenerated === true)).toBe(true);
    expect(
      updates.some(w => {
        const sentTo = (w.daten as { pdfSentTo?: Record<string, boolean> }).pdfSentTo;
        return sentTo?.employee === true && sentTo?.admin === true && sentTo?.facility === true;
      })
    ).toBe(true);
  });

  it('liefert den vorhandenen Nachweis, statt ihn erneut zu erzeugen', async () => {
    harness.setDoc(
      einsatz('a1', {
        pdfGenerated: true,
        pdfUrl: 'https://storage.example/alt.pdf',
        pdfSentTo: { employee: true, admin: true, facility: true },
      })
    );
    const service = await lade();
    const ergebnis = await service.generateSignaturePDFAndSendEmails('a1');

    expect(ergebnis).toEqual({ pdfUrl: 'https://storage.example/alt.pdf', emailsSent: true });
    expect(generateDocument).not.toHaveBeenCalled();
  });

  it('wirft, wenn Einsatz oder Schicht fehlen', async () => {
    harness.setDoc(null);
    const service = await lade();
    await expect(service.generateSignaturePDFAndSendEmails('fehlt')).rejects.toThrow(
      'Assignment not found'
    );

    harness.reset();
    harness.setDoc(einsatz('a1'));
    getShiftById.mockResolvedValue(null);
    await expect(service.generateSignaturePDFAndSendEmails('a1')).rejects.toThrow('Shift not found');
  });

  it('scheitert nicht an einzelnen E-Mail-Fehlern', async () => {
    harness.setDoc(einsatz('a1'));
    sendSignatureEmail.mockRejectedValue(new Error('SMTP down'));
    const service = await lade();

    const ergebnis = await service.generateSignaturePDFAndSendEmails('a1');
    expect(ergebnis.pdfUrl).toBe('https://storage.example/nachweis.pdf');
    // Mitarbeiter- und Einrichtungs-Mail wurden versucht → gilt als versendet-Kennzeichen
    expect(ergebnis.emailsSent).toBe(true);
  });

  it('kommt ohne Einrichtung und ohne Admins aus', async () => {
    harness.setDoc(einsatz('a1'));
    getShiftById.mockResolvedValue({ id: 's1', date: '2026-07-20' }); // keine facilityId
    getUserById.mockResolvedValue({ id: 'u1', displayName: 'Anna Muster' }); // keine E-Mail
    const service = await lade();

    const ergebnis = await service.generateSignaturePDFAndSendEmails('a1');
    expect(ergebnis.emailsSent).toBe(false);
    // nur die Zentrale erhält eine Mail
    expect(sendSignatureEmail).toHaveBeenCalledTimes(1);
  });
});
