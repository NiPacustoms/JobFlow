import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Client-Wrapper der Cloud Functions für die Schichtverwaltung:
 * typisierte Aufrufe und Übersetzung der Fehlercodes in verständliche Meldungen.
 */

const aufrufe = new Map<string, ReturnType<typeof vi.fn>>();
const callableFuer = (name: string) => {
  if (!aufrufe.has(name)) aufrufe.set(name, vi.fn(async () => ({ data: {} })));
  return aufrufe.get(name)!;
};

vi.mock('firebase/functions', () => ({
  httpsCallable: vi.fn((_fns: unknown, name: string) => callableFuer(name)),
}));

vi.mock('@/lib/firebase', () => ({ functions: {} }));
vi.mock('@/lib/logging', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { cloudFunctions } from '../cloudFunctions';

beforeEach(() => {
  aufrufe.forEach(fn => fn.mockReset().mockResolvedValue({ data: {} }));
});

describe('assignShiftToUser', () => {
  it('reicht das Ergebnis der Cloud Function durch', async () => {
    callableFuer('assignShift').mockResolvedValue({ data: { success: true, assignmentId: 'a1' } });
    const ergebnis = await cloudFunctions.assignShiftToUser('s1', 'u1');
    expect(ergebnis).toEqual({ success: true, assignmentId: 'a1' });
    expect(callableFuer('assignShift')).toHaveBeenCalledWith({
      shiftId: 's1',
      userId: 'u1',
      isRequest: false,
      adminOverride: false,
    });
  });

  it.each([
    ['Missing qualifications: xyz', 'Qualifikationen'],
    ['Time conflicts detected', 'Zeitkonflikt'],
    ['Shift is already full', 'voll besetzt'],
  ])('übersetzt failed-precondition (%s)', async (nachricht, erwartet) => {
    callableFuer('assignShift').mockRejectedValue({
      code: 'functions/failed-precondition',
      message: nachricht,
    });
    await expect(cloudFunctions.assignShiftToUser('s1', 'u1')).rejects.toThrow(erwartet);
  });

  it('übersetzt Berechtigungs-, Notfound- und interne Fehler', async () => {
    callableFuer('assignShift').mockRejectedValue({ code: 'functions/permission-denied' });
    await expect(cloudFunctions.assignShiftToUser('s1', 'u1')).rejects.toThrow('Keine Berechtigung');

    callableFuer('assignShift').mockRejectedValue({ code: 'functions/not-found' });
    await expect(cloudFunctions.assignShiftToUser('s1', 'u1')).rejects.toThrow('nicht gefunden');

    callableFuer('assignShift').mockRejectedValue({ code: 'functions/internal' });
    await expect(cloudFunctions.assignShiftToUser('s1', 'u1')).rejects.toThrow('interner Fehler');
  });

  it('reicht unbekannte Fehlermeldungen durch', async () => {
    callableFuer('assignShift').mockRejectedValue({ message: 'Spezialfall' });
    await expect(cloudFunctions.assignShiftToUser('s1', 'u1')).rejects.toThrow('Spezialfall');
  });
});

describe('unassignUser', () => {
  it('nimmt eine Zuweisung zurück', async () => {
    callableFuer('unassignShift').mockResolvedValue({ data: { success: true, message: 'ok' } });
    const ergebnis = await cloudFunctions.unassignUser('a1', 'krank');
    expect(ergebnis.success).toBe(true);
    expect(callableFuer('unassignShift')).toHaveBeenCalledWith({ assignmentId: 'a1', reason: 'krank' });
  });

  it('übersetzt Fehlercodes', async () => {
    callableFuer('unassignShift').mockRejectedValue({ code: 'functions/permission-denied' });
    await expect(cloudFunctions.unassignUser('a1')).rejects.toThrow('Keine Berechtigung');

    callableFuer('unassignShift').mockRejectedValue({ code: 'functions/not-found' });
    await expect(cloudFunctions.unassignUser('a1')).rejects.toThrow('Zuweisung nicht gefunden');

    callableFuer('unassignShift').mockRejectedValue({});
    await expect(cloudFunctions.unassignUser('a1')).rejects.toThrow('Fehler beim Rücknehmen');
  });
});

describe('declineAssignment', () => {
  it('lehnt mit Unterschrifts-Workflow ab', async () => {
    callableFuer('declineAssignment').mockResolvedValue({
      data: { success: true, message: 'ok', requiresSignature: true, newStatus: 'declined' },
    });
    const ergebnis = await cloudFunctions.declineAssignment({ assignmentId: 'a1' } as never);
    expect(ergebnis.requiresSignature).toBe(true);
  });

  it('übersetzt Statusfehler', async () => {
    callableFuer('declineAssignment').mockRejectedValue({ code: 'functions/failed-precondition' });
    await expect(cloudFunctions.declineAssignment({ assignmentId: 'a1' } as never)).rejects.toThrow(
      'aktuellen Status'
    );

    callableFuer('declineAssignment').mockRejectedValue({ code: 'functions/permission-denied' });
    await expect(cloudFunctions.declineAssignment({ assignmentId: 'a1' } as never)).rejects.toThrow(
      'Keine Berechtigung'
    );
  });
});

describe('requestShiftAssignment', () => {
  it('sendet eine Schichtanfrage', async () => {
    callableFuer('requestShift').mockResolvedValue({
      data: { success: true, assignmentId: 'a1', message: 'ok' },
    });
    const ergebnis = await cloudFunctions.requestShiftAssignment('s1', 'gern früh');
    expect(ergebnis.assignmentId).toBe('a1');
  });

  it('übersetzt Doppelanfrage und vergebene Schicht', async () => {
    callableFuer('requestShift').mockRejectedValue({
      code: 'functions/failed-precondition',
      message: 'already requested',
    });
    await expect(cloudFunctions.requestShiftAssignment('s1')).rejects.toThrow('bereits eine Anfrage');

    callableFuer('requestShift').mockRejectedValue({
      code: 'functions/failed-precondition',
      message: 'no longer available',
    });
    await expect(cloudFunctions.requestShiftAssignment('s1')).rejects.toThrow('nicht mehr verfügbar');
  });
});

describe('findAvailableCandidates', () => {
  it('liefert Kandidaten mit Filtern', async () => {
    callableFuer('findCandidates').mockResolvedValue({
      data: { success: true, candidates: [{ userId: 'u1' }], totalFound: 1, shiftInfo: { id: 's1' } },
    });
    const ergebnis = await cloudFunctions.findAvailableCandidates('s1', { onlyQualified: true });
    expect(ergebnis.totalFound).toBe(1);
    expect(callableFuer('findCandidates')).toHaveBeenCalledWith({
      shiftId: 's1',
      filters: { onlyQualified: true },
    });
  });

  it('übersetzt Fehlercodes', async () => {
    callableFuer('findCandidates').mockRejectedValue({ code: 'functions/not-found' });
    await expect(cloudFunctions.findAvailableCandidates('s1')).rejects.toThrow('Schicht nicht gefunden');

    callableFuer('findCandidates').mockRejectedValue({ code: 'functions/permission-denied' });
    await expect(cloudFunctions.findAvailableCandidates('s1')).rejects.toThrow('Keine Berechtigung');
  });
});

describe('weitere Cloud-Function-Wrapper', () => {
  it('stößt geplante Berichte manuell an', async () => {
    callableFuer('runScheduledReportsNow').mockResolvedValue({ data: { success: true } });
    await expect(cloudFunctions.runScheduledReportsNow()).resolves.toEqual({ success: true });
  });

  it('liefert verfügbare Mitarbeiter für einen Zeitschlitz (beide Feldnamen)', async () => {
    callableFuer('getAvailableEmployeeIdsForSlot').mockResolvedValue({
      data: { availableUserIds: ['u1'] },
    });
    let ergebnis = await cloudFunctions.getAvailableEmployeeIdsForSlot({ companyId: 'firmaA' });
    expect(ergebnis.availableUserIds).toEqual(['u1']);

    callableFuer('getAvailableEmployeeIdsForSlot').mockResolvedValue({
      data: { employeeIds: ['u2'] },
    });
    ergebnis = await cloudFunctions.getAvailableEmployeeIdsForSlot({ companyId: 'firmaA' }, 'token1');
    expect(ergebnis.availableUserIds).toEqual(['u2']);
    expect(callableFuer('getAvailableEmployeeIdsForSlot')).toHaveBeenLastCalledWith(
      expect.objectContaining({ idToken: 'token1' })
    );

    callableFuer('getAvailableEmployeeIdsForSlot').mockResolvedValue({ data: {} });
    ergebnis = await cloudFunctions.getAvailableEmployeeIdsForSlot({});
    expect(ergebnis.availableUserIds).toEqual([]);
  });

  it('benachrichtigt die Einrichtung und lehnt mit Unterschrift ab', async () => {
    callableFuer('notifyFacilityForAssignment').mockResolvedValue({ data: { success: true } });
    await expect(
      cloudFunctions.notifyFacilityForAssignment({ assignmentId: 'a1', employeeName: 'Anna' })
    ).resolves.toEqual({ success: true });

    callableFuer('declineAssignmentWithSignature').mockResolvedValue({ data: { success: true } });
    await expect(
      cloudFunctions.declineAssignmentWithSignature({
        assignmentId: 'a1',
        reason: 'krank',
        signatureDataUrl: 'data:image/png;base64,x',
      })
    ).resolves.toEqual({ success: true });
  });

  it('legt einen Einsatz mit Matching an', async () => {
    callableFuer('createAssignmentWithMatching').mockResolvedValue({ data: { assignmentId: 'a9' } });
    const ergebnis = await cloudFunctions.createAssignmentWithMatching(
      {
        facilityId: 'f1',
        companyId: 'firmaA',
        startDate: '2026-07-28',
        startTime: '06:00',
        endTime: '14:00',
      },
      'token1'
    );
    expect(ergebnis.assignmentId).toBe('a9');
    expect(callableFuer('createAssignmentWithMatching')).toHaveBeenCalledWith(
      expect.objectContaining({ idToken: 'token1' })
    );
  });
});


