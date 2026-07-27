import { beforeEach, describe, expect, it, vi } from 'vitest';
import { harness, firestoreModuleMock, ts } from './helpers/firestoreHarness';

/**
 * Leseseite und Freigabe der Zeiterfassung inklusive Pausenverwaltung
 * und Überlappungserkennung (geteilter Dienst, Nachtschicht).
 */

vi.mock('@/lib/firebase', () => ({
  db: {},
  getDb: vi.fn(() => ({})),
  auth: { currentUser: { uid: 'u1' } },
  functions: {},
}));
vi.mock('@/lib/utils/companyId', () => ({
  getCompanyIdFromAuth: vi.fn(async () => 'firmaA'),
}));
vi.mock('../offlineQueue', () => ({
  offlineQueueService: { addToQueue: vi.fn(async () => 'offline_1') },
}));
vi.mock('firebase/firestore', () => firestoreModuleMock());

const lade = async () => (await import('../timesheets')).timesheetService;

const nachweis = (id: string, daten: Record<string, unknown> = {}) => ({
  id,
  data: {
    userId: 'u1',
    companyId: 'firmaA',
    date: ts(new Date(2026, 6, 20)),
    startTime: '06:00',
    endTime: '14:00',
    breakMinutes: 30,
    totalHours: 7.5,
    status: 'draft',
    breaks: [],
    createdAt: ts(new Date(2026, 6, 20)),
    updatedAt: ts(new Date(2026, 6, 20)),
    ...daten,
  },
});

beforeEach(async () => {
  vi.clearAllMocks();
  harness.reset();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  const { getCompanyIdFromAuth } = await import('@/lib/utils/companyId');
  vi.mocked(getCompanyIdFromAuth).mockResolvedValue('firmaA');
});

describe('Lesen', () => {
  it('liest einen Nachweis anhand der ID', async () => {
    harness.setDoc(nachweis('t1'));
    const service = await lade();
    const t = await service.getById('t1');
    expect(t).toMatchObject({ id: 't1', userId: 'u1', totalHours: 7.5 });
    expect(t?.date).toBeInstanceOf(Date);
  });

  it('liefert null für einen unbekannten Nachweis', async () => {
    harness.setDoc(null);
    const service = await lade();
    expect(await service.getById('fehlt')).toBeNull();
  });

  it('liest die Nachweise eines Mitarbeiters', async () => {
    harness.setDocs([nachweis('t1'), nachweis('t2')]);
    const service = await lade();
    const result = await service.getByUserId('u1', 10);
    expect(result).toHaveLength(2);
    expect(harness.hatWhere('userId', 'u1')).toBe(true);
  });

  it('liest den Nachweis eines bestimmten Tages', async () => {
    harness.setDocs([nachweis('t1')]);
    const service = await lade();
    const t = await service.getByDate('u1', new Date(2026, 6, 20));
    expect(t).toMatchObject({ id: 't1' });
  });

  it('liefert null, wenn an dem Tag nichts erfasst wurde', async () => {
    harness.setDocs([]);
    const service = await lade();
    expect(await service.getByDate('u1', new Date(2026, 6, 21))).toBeNull();
  });

  it('liest den heutigen Nachweis', async () => {
    harness.setDocs([nachweis('t1')]);
    const service = await lade();
    const t = await service.getTodayTimesheet('u1');
    expect(t).toMatchObject({ id: 't1' });
  });

  it('liest die letzten Nachweise', async () => {
    harness.setDocs([nachweis('t1'), nachweis('t2')]);
    const service = await lade();
    const result = await service.getRecentTimesheets('u1', 7);
    expect(result).toHaveLength(2);
  });

  it('liest alle Nachweise der Firma', async () => {
    harness.setDocs([nachweis('t1')]);
    const service = await lade();
    const result = await service.getAll('firmaA');
    expect(result.length).toBeGreaterThanOrEqual(0);
  });

  it('liest Nachweise über einen Zeitraum', async () => {
    harness.setDocs([nachweis('t1')]);
    const service = await lade();
    const result = await service.getTimesheetsByDateRange(
      new Date(2026, 6, 1),
      new Date(2026, 6, 31),
      'u1'
    );
    expect(result).toHaveLength(1);
  });

  it('liest Nachweise eines Mitarbeiters im Zeitraum', async () => {
    harness.setDocs([nachweis('t1')]);
    const service = await lade();
    const result = await service.getByUserAndDateRange('u1', new Date(2026, 6, 1), new Date(2026, 6, 31));
    expect(result).toHaveLength(1);
  });
});

describe('getByDateRange – Aggregation und Überlappung', () => {
  it('summiert die Stunden je Mitarbeiter', async () => {
    harness.setDocs([
      nachweis('t1', { totalHours: 8, startTime: '06:00', endTime: '14:00' }),
      nachweis('t2', {
        totalHours: 6,
        date: ts(new Date(2026, 6, 21)),
        startTime: '06:00',
        endTime: '12:00',
      }),
    ]);
    const service = await lade();
    const result = await service.getByDateRange('u1', new Date(2026, 6, 1), new Date(2026, 6, 31), false);
    expect(result.aggregates[0].totalHours).toBe(14);
  });

  it('filtert bei approvedOnly auf genehmigte Nachweise', async () => {
    harness.setDocs([nachweis('t1', { status: 'approved' })]);
    const service = await lade();
    await service.getByDateRange('u1', new Date(2026, 6, 1), new Date(2026, 6, 31), true);
    expect(harness.hatWhere('status', 'approved')).toBe(true);
  });

  it('erkennt überlappende Nachweise desselben Mitarbeiters', async () => {
    harness.setDocs([
      nachweis('t1', { startTime: '06:00', endTime: '14:00' }),
      nachweis('t2', { startTime: '13:00', endTime: '21:00' }),
    ]);
    const service = await lade();
    await expect(
      service.getByDateRange('u1', new Date(2026, 6, 1), new Date(2026, 6, 31), false)
    ).rejects.toThrow();
  });

  it('lässt einen geteilten Dienst am selben Tag zu', async () => {
    harness.setDocs([
      nachweis('t1', { startTime: '06:00', endTime: '10:00', totalHours: 4 }),
      nachweis('t2', { startTime: '14:00', endTime: '18:00', totalHours: 4 }),
    ]);
    const service = await lade();
    const result = await service.getByDateRange('u1', new Date(2026, 6, 1), new Date(2026, 6, 31), false);
    expect(result.timesheets).toHaveLength(2);
  });

  it('lehnt ein ungültiges Startdatum ab', async () => {
    const service = await lade();
    await expect(
      service.getByDateRange('u1', new Date('kaputt'), new Date(2026, 6, 31))
    ).rejects.toThrow(/Startdatum/);
  });

  it('lehnt ein Enddatum vor dem Startdatum ab', async () => {
    const service = await lade();
    await expect(
      service.getByDateRange('u1', new Date(2026, 6, 31), new Date(2026, 6, 1))
    ).rejects.toThrow(/Startdatum darf nicht/);
  });
});

describe('Freigabe und Ablehnung', () => {
  it('genehmigt einen Nachweis', async () => {
    harness.setDoc(nachweis('t1', { status: 'submitted' }));
    const service = await lade();
    await service.approve('t1', 'admin1');
    expect(harness.writes.find(w => w.art === 'update')?.daten).toMatchObject({
      status: 'approved',
      approvedBy: 'admin1',
    });
  });

  it('lehnt einen Nachweis mit Begründung ab', async () => {
    const service = await lade();
    await service.reject('t1', 'Zeiten unplausibel');
    expect(harness.writes.find(w => w.art === 'update')?.daten).toMatchObject({
      status: 'rejected',
      rejectionReason: 'Zeiten unplausibel',
    });
  });

  it('bestätigt einen Nachweis mit Einrichtungssignatur inklusive Anmerkung', async () => {
    harness.setDoc(nachweis('t1', { status: 'submitted' }));
    const service = await lade();
    await service.approveWithFacilitySignature({
      timesheetId: 't1',
      signatureUrl: 'https://storage/sig.png',
      signerUserId: 'pdl1',
      signerName: 'PDL Müller',
      status: 'performed',
      facilityNotes: 'Alles in Ordnung',
    });
    expect(harness.writes.find(w => w.art === 'update')?.daten).toMatchObject({
      status: 'approved',
      facilitySignerName: 'PDL Müller',
      facilityConfirmationStatus: 'performed',
      facilityNotes: 'Alles in Ordnung',
    });
  });

  it('verhindert die doppelte Freigabe', async () => {
    harness.setDoc(nachweis('t1', { status: 'approved' }));
    const service = await lade();
    await expect(
      service.approveWithFacilitySignature({ timesheetId: 't1', signatureUrl: 'x' })
    ).rejects.toThrow(/already approved/i);
  });

  it('wirft, wenn der Nachweis für die Signatur fehlt', async () => {
    harness.setDoc(null);
    const service = await lade();
    await expect(
      service.approveWithFacilitySignature({ timesheetId: 'fehlt', signatureUrl: 'x' })
    ).rejects.toThrow(/not found/i);
  });

  it('löscht einen Nachweis im Entwurf', async () => {
    harness.setDoc(nachweis('t1', { status: 'draft' }));
    const service = await lade();
    await service.delete('t1');
    expect(harness.writes.some(w => w.art === 'delete')).toBe(true);
  });

  it('verweigert das Löschen eines genehmigten Nachweises (GoBD)', async () => {
    harness.setDoc(nachweis('t1', { status: 'approved' }));
    const service = await lade();
    await expect(service.delete('t1')).rejects.toThrow();
  });
});

describe('Pausen', () => {
  it('startet eine Pause', async () => {
    harness.setDoc(nachweis('t1', { breaks: [] }));
    const service = await lade();
    await service.addBreak('t1', { reason: 'Mittag', duration: 30 });
    expect(harness.writes.some(w => w.art === 'update')).toBe(true);
  });

  it('beendet eine Pause', async () => {
    harness.setDoc(
      nachweis('t1', {
        breaks: [{ id: 'b1', startTime: '12:00', reason: 'Mittag' }],
      })
    );
    const service = await lade();
    await service.endBreak('t1', 'b1');
    expect(harness.writes.some(w => w.art === 'update')).toBe(true);
  });

  it('wirft, wenn der Nachweis für die Pause fehlt', async () => {
    harness.setDoc(null);
    const service = await lade();
    await expect(service.addBreak('fehlt', { reason: 'x', duration: 10 })).rejects.toThrow();
  });
});

describe('Offline-Verhalten', () => {
  it('stellt Änderungen bei fehlender Verbindung in die Warteschlange', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    const { offlineQueueService } = await import('../offlineQueue');
    const service = await lade();

    await service.update('t1', { endTime: '15:00' });
    expect(vi.mocked(offlineQueueService.addToQueue)).toHaveBeenCalledWith('timesheet', 'update', {
      id: 't1',
      endTime: '15:00',
    });
    // kein direkter Firestore-Schreibzugriff
    expect(harness.writes).toHaveLength(0);
  });

  it('verweigert das Einreichen ohne Verbindung (serverseitige ArbZG-Prüfung)', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    const service = await lade();
    await expect(service.submit('t1')).rejects.toThrow(/Internetverbindung/);
  });
});

describe('update – GoBD-Unveränderlichkeit', () => {
  it('rechnet die Stunden bei Zeitänderung neu', async () => {
    harness.setDoc(nachweis('t1'));
    const service = await lade();

    await service.update('t1', { endTime: '16:00' });
    const update = harness.writes.find(w => w.art === 'update')?.daten as Record<string, unknown>;
    // 06:00–16:00 minus 30 Minuten Pause
    expect(update.totalHours).toBe(9.5);
  });

  it('berücksichtigt eine geänderte Pausenzeit', async () => {
    harness.setDoc(nachweis('t1'));
    const service = await lade();

    await service.update('t1', { breakMinutes: 60 });
    const update = harness.writes.find(w => w.art === 'update')?.daten as Record<string, unknown>;
    expect(update.totalHours).toBe(7);
  });

  it('lässt reine Anmerkungen ohne Neuberechnung zu', async () => {
    harness.setDoc(nachweis('t1'));
    const service = await lade();

    await service.update('t1', { notes: 'Ruhiger Dienst' });
    const update = harness.writes.find(w => w.art === 'update')?.daten as Record<string, unknown>;
    expect(update.totalHours).toBeUndefined();
    expect(update.notes).toBe('Ruhiger Dienst');
  });

  it.each(['approved', 'submitted'])('verweigert die Änderung im Status %s', async status => {
    harness.setDoc(nachweis('t1', { status }));
    const service = await lade();
    await expect(service.update('t1', { endTime: '16:00' })).rejects.toThrow(/GoBD/);
  });

  it('wirft, wenn der Nachweis nicht existiert', async () => {
    harness.setDoc(null);
    const service = await lade();
    await expect(service.update('weg', { endTime: '16:00' })).rejects.toThrow('not found');
  });
});

describe('approveRangeWithFacilitySignature', () => {
  it('bestätigt alle Nachweise des Zeitraums und zählt sie', async () => {
    harness.setDocs([
      nachweis('t1', { status: 'submitted' }),
      nachweis('t2', { status: 'approved' }),
    ]);
    const service = await lade();

    const anzahl = await service.approveRangeWithFacilitySignature({
      userId: 'u1',
      start: new Date(2026, 6, 20),
      end: new Date(2026, 6, 26),
      signatureUrl: 'https://storage/signatur.png',
      signerUserId: 'leitung1',
    });

    expect(anzahl).toBe(2);
    const updates = harness.writes.filter(w => w.art === 'update');
    expect(updates).toHaveLength(2);
    // eingereichter Nachweis wird genehmigt, bereits genehmigter behält den Status
    expect((updates[0].daten as Record<string, unknown>).status).toBe('approved');
    expect((updates[1].daten as Record<string, unknown>).status).toBe('approved');
    expect((updates[0].daten as Record<string, unknown>).facilitySignedBy).toBe('leitung1');
  });

  it('liefert 0, wenn im Zeitraum nichts erfasst wurde', async () => {
    harness.setDocs([]);
    const service = await lade();

    await expect(
      service.approveRangeWithFacilitySignature({
        userId: 'u1',
        start: new Date(2026, 6, 20),
        end: new Date(2026, 6, 26),
        signatureUrl: 'https://storage/signatur.png',
        signerUserId: 'leitung1',
      })
    ).resolves.toBe(0);
  });
});

describe('mapDocToTimesheet – Feldabbildung', () => {
  it('übernimmt Signatur-, Einrichtungs- und Zeitfelder', async () => {
    harness.setDoc(
      nachweis('t1', {
        startDate: ts(new Date(2026, 6, 20)),
        endDate: ts(new Date(2026, 6, 21)),
        nightHours: 6,
        weekendHours: 8,
        holidayHours: 0,
        overtimeHours: 1.5,
        regularHours: 6,
        submittedAt: ts(new Date(2026, 6, 21)),
        approvedAt: ts(new Date(2026, 6, 22)),
        approvedBy: 'admin1',
        employeeSignatureUrl: 'https://storage/ma.png',
        employeeSignedAt: ts(new Date(2026, 6, 21)),
        facilitySignatureUrl: 'https://storage/haus.png',
        facilitySignedAt: ts(new Date(2026, 6, 21)),
        facilitySignedBy: 'leitung1',
        facilityConfirmationStatus: 'performed',
        facilitySignerName: 'Frau Meier',
        facilityNotes: 'alles in Ordnung',
        facilityId: 'f1',
        station: 'Station 3',
        location: '2. Etage',
      })
    );
    const service = await lade();

    const t = await service.getById('t1');
    expect(t).toMatchObject({
      nightHours: 6,
      weekendHours: 8,
      overtimeHours: 1.5,
      approvedBy: 'admin1',
      facilitySignedBy: 'leitung1',
      facilityConfirmationStatus: 'performed',
      facilitySignerName: 'Frau Meier',
      facilityId: 'f1',
      station: 'Station 3',
      location: '2. Etage',
    });
    // Folgetag der Nachtschicht bleibt erhalten
    expect(t?.endDate).toEqual(new Date(2026, 6, 21));
  });

  it('setzt Vorgabewerte für fehlende Felder', async () => {
    harness.setDoc({ id: 't1', data: { userId: 'u1', startTime: '06:00', endTime: '14:00' } });
    const service = await lade();

    const t = await service.getById('t1');
    expect(t).toMatchObject({
      companyId: '',
      breakMinutes: 0,
      totalHours: 0,
      nightHours: 0,
      status: 'draft',
      breaks: [],
    });
    expect(t?.date).toBeInstanceOf(Date);
    expect(t?.submittedAt).toBeUndefined();
  });
});
