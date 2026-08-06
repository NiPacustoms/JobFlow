import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assignmentService } from '../assignments';

/**
 * Regressionstests zur Signatur- und Nachweiskette (§ 11 AÜG / Stundennachweis).
 * Diese Kette entscheidet, wann der Nachweis erzeugt und verschickt wird –
 * Fehler hier führen zu fehlenden oder verfrühten Nachweisen beim Kunden.
 */

vi.mock('@/lib/firebase', () => ({
  db: {},
  getDb: vi.fn(() => ({})),
}));

vi.mock('@/lib/utils/companyId', () => ({
  getCompanyIdFromAuth: vi.fn(() => Promise.resolve('company123')),
}));

const transaktionsUpdates: Array<Record<string, unknown>> = [];
let transaktionsDokument: { exists: () => boolean; data: () => Record<string, unknown> };

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: vi.fn((_db: unknown, coll: string, id: string) => ({ coll, id })),
  addDoc: vi.fn(),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  runTransaction: vi.fn(async (_db: unknown, fn: (t: unknown) => Promise<void>) => {
    const transaction = {
      get: vi.fn(async () => transaktionsDokument),
      update: vi.fn((_ref: unknown, daten: Record<string, unknown>) => {
        transaktionsUpdates.push(daten);
      }),
    };
    await fn(transaction);
  }),
  serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
}));

const basisAssignment = (overrides: Record<string, unknown> = {}) => ({
  userId: 'user123',
  shiftId: 'shift123',
  companyId: 'company123',
  status: 'accepted',
  assignedAt: { toDate: () => new Date('2026-07-20') },
  createdAt: { toDate: () => new Date('2026-07-20') },
  updatedAt: { toDate: () => new Date('2026-07-20') },
  ...overrides,
});

describe('addRelievingSignature', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transaktionsUpdates.length = 0;
    transaktionsDokument = {
      exists: () => true,
      data: () => basisAssignment({ relievingSignatures: [], signatureSchedule: { collectedDates: [] } }),
    };
  });

  const signatur = (datum: string) => ({
    date: datum,
    signerName: 'Pflegedienstleitung',
    signatureUrl: 'https://example/sig.png',
    signedAt: new Date('2026-07-21T10:00:00Z'),
  });

  it('läuft in einer Transaktion, damit parallele Signaturen sich nicht überschreiben', async () => {
    const { runTransaction } = await import('firebase/firestore');
    await assignmentService.addRelievingSignature('a1', signatur('2026-07-21'));
    expect(runTransaction).toHaveBeenCalledTimes(1);
  });

  it('ergänzt eine neue Signatur und das gesammelte Datum', async () => {
    await assignmentService.addRelievingSignature('a1', signatur('2026-07-21'));
    const update = transaktionsUpdates[0];
    expect((update.relievingSignatures as unknown[]).length).toBe(1);
    expect((update.signatureSchedule as { collectedDates: string[] }).collectedDates).toEqual([
      '2026-07-21',
    ]);
  });

  it('ersetzt eine bestehende Signatur desselben Tages, statt sie zu doppeln', async () => {
    transaktionsDokument = {
      exists: () => true,
      data: () =>
        basisAssignment({
          relievingSignatures: [
            { date: '2026-07-21', signerName: 'Alt', signatureUrl: 'alt.png', signedAt: new Date() },
          ],
          signatureSchedule: { collectedDates: ['2026-07-21'] },
        }),
    };
    await assignmentService.addRelievingSignature('a1', signatur('2026-07-21'));
    const update = transaktionsUpdates[0];
    const signaturen = update.relievingSignatures as Array<{ signerName: string }>;
    expect(signaturen).toHaveLength(1);
    expect(signaturen[0].signerName).toBe('Pflegedienstleitung');
    expect((update.signatureSchedule as { collectedDates: string[] }).collectedDates).toEqual([
      '2026-07-21',
    ]);
  });

  it('behält bereits vorhandene Signaturen anderer Tage', async () => {
    transaktionsDokument = {
      exists: () => true,
      data: () =>
        basisAssignment({
          relievingSignatures: [
            { date: '2026-07-20', signerName: 'Tag1', signatureUrl: 'a.png', signedAt: new Date() },
          ],
          signatureSchedule: { collectedDates: ['2026-07-20'] },
        }),
    };
    await assignmentService.addRelievingSignature('a1', signatur('2026-07-21'));
    const update = transaktionsUpdates[0];
    expect((update.relievingSignatures as unknown[]).length).toBe(2);
    expect((update.signatureSchedule as { collectedDates: string[] }).collectedDates).toEqual([
      '2026-07-20',
      '2026-07-21',
    ]);
  });

  it('wirft, wenn der Einsatz nicht existiert', async () => {
    transaktionsDokument = { exists: () => false, data: () => ({}) };
    await expect(
      assignmentService.addRelievingSignature('fehlt', signatur('2026-07-21'))
    ).rejects.toThrow('Assignment not found');
  });
});

describe('checkAndGeneratePDFIfComplete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const setzeAssignment = async (daten: Record<string, unknown>) => {
    const { getDoc } = await import('firebase/firestore');
    vi.mocked(getDoc).mockResolvedValue({
      exists: () => true,
      id: 'a1',
      data: () => basisAssignment(daten),
    } as never);
  };

  it('erzeugt nichts, wenn ein Pflichttag noch fehlt', async () => {
    const spy = vi
      .spyOn(assignmentService, 'generateSignaturePDFAndSendEmails')
      .mockResolvedValue({ pdfUrl: '', emailsSent: false });
    await setzeAssignment({
      signatureSchedule: {
        requiredDates: [{ toDate: () => new Date(2026, 6, 20) }, { toDate: () => new Date(2026, 6, 21) }],
        collectedDates: ['2026-07-20'],
      },
    });

    await assignmentService.checkAndGeneratePDFIfComplete('a1');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('lässt sich NICHT durch eine Signatur an einem nicht geforderten Tag täuschen', async () => {
    const spy = vi
      .spyOn(assignmentService, 'generateSignaturePDFAndSendEmails')
      .mockResolvedValue({ pdfUrl: '', emailsSent: false });
    await setzeAssignment({
      signatureSchedule: {
        requiredDates: [{ toDate: () => new Date(2026, 6, 20) }, { toDate: () => new Date(2026, 6, 21) }],
        // Gleiche Anzahl, aber der 21. fehlt – der 25. war nie gefordert.
        collectedDates: ['2026-07-20', '2026-07-25'],
      },
    });

    await assignmentService.checkAndGeneratePDFIfComplete('a1');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('erzeugt den Nachweis, sobald alle Pflichttage unterschrieben sind', async () => {
    const spy = vi
      .spyOn(assignmentService, 'generateSignaturePDFAndSendEmails')
      .mockResolvedValue({ pdfUrl: 'https://example/nachweis.pdf', emailsSent: true });
    await setzeAssignment({
      signatureSchedule: {
        requiredDates: [{ toDate: () => new Date(2026, 6, 20) }, { toDate: () => new Date(2026, 6, 21) }],
        collectedDates: ['2026-07-20', '2026-07-21'],
      },
    });

    await assignmentService.checkAndGeneratePDFIfComplete('a1');
    expect(spy).toHaveBeenCalledWith('a1');
    spy.mockRestore();
  });

  it('verlangt KEINE Einrichtungssignatur (Entscheidung: Versand direkt nach MA-Signatur)', async () => {
    const spy = vi
      .spyOn(assignmentService, 'generateSignaturePDFAndSendEmails')
      .mockResolvedValue({ pdfUrl: 'https://example/nachweis.pdf', emailsSent: true });
    await setzeAssignment({
      facilitySignatureUrl: undefined,
      signatureSchedule: {
        requiredDates: [{ toDate: () => new Date(2026, 6, 20) }],
        collectedDates: ['2026-07-20'],
      },
    });

    await assignmentService.checkAndGeneratePDFIfComplete('a1');
    expect(spy).toHaveBeenCalledWith('a1');
    spy.mockRestore();
  });

  it('erzeugt nichts erneut, wenn der Nachweis bereits vorliegt', async () => {
    const spy = vi
      .spyOn(assignmentService, 'generateSignaturePDFAndSendEmails')
      .mockResolvedValue({ pdfUrl: '', emailsSent: false });
    await setzeAssignment({
      pdfGenerated: true,
      pdfUrl: 'https://example/vorhanden.pdf',
      signatureSchedule: { requiredDates: [], collectedDates: [] },
    });

    await assignmentService.checkAndGeneratePDFIfComplete('a1');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('wird durch die Einsatzmitteilung (formPdfUrl) nicht blockiert', async () => {
    const spy = vi
      .spyOn(assignmentService, 'generateSignaturePDFAndSendEmails')
      .mockResolvedValue({ pdfUrl: 'https://example/nachweis.pdf', emailsSent: true });
    await setzeAssignment({
      // Einsatzmitteilung liegt vor – sie darf den Nachweislauf nicht verhindern.
      formPdfUrl: 'https://example/einsatzmitteilung.pdf',
      formStatus: 'acknowledged',
      signatureSchedule: {
        requiredDates: [{ toDate: () => new Date(2026, 6, 20) }],
        collectedDates: ['2026-07-20'],
      },
    });

    await assignmentService.checkAndGeneratePDFIfComplete('a1');
    expect(spy).toHaveBeenCalledWith('a1');
    spy.mockRestore();
  });

  it('behandelt einen leeren Zeitplan als vollständig', async () => {
    const spy = vi
      .spyOn(assignmentService, 'generateSignaturePDFAndSendEmails')
      .mockResolvedValue({ pdfUrl: '', emailsSent: true });
    await setzeAssignment({ signatureSchedule: undefined });

    await assignmentService.checkAndGeneratePDFIfComplete('a1');
    expect(spy).toHaveBeenCalledWith('a1');
    spy.mockRestore();
  });
});

describe('mapDocToAssignment', () => {
  it('bildet Nachweis- und Formularfelder getrennt ab', () => {
    const assignment = assignmentService.mapDocToAssignment({
      id: 'a1',
      data: () =>
        basisAssignment({
          pdfGenerated: true,
          pdfUrl: 'https://example/nachweis.pdf',
          formPdfUrl: 'https://example/einsatzmitteilung.pdf',
          formStatus: 'acknowledged',
          formNotes: 'Station 3',
        }),
    } as never);

    expect(assignment.pdfUrl).toBe('https://example/nachweis.pdf');
    expect(assignment.formPdfUrl).toBe('https://example/einsatzmitteilung.pdf');
    expect(assignment.pdfGenerated).toBe(true);
    expect(assignment.formStatus).toBe('acknowledged');
    expect(assignment.formNotes).toBe('Station 3');
  });
});
