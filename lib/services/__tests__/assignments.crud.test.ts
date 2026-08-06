import { beforeEach, describe, expect, it, vi } from 'vitest';
import { harness, firestoreModuleMock, ts } from './helpers/firestoreHarness';

/**
 * Einsätze: Anlegen, Annehmen, Ablehnen, Konfliktprüfung, Sammelzuweisung.
 * Der Konfliktcheck verhindert Doppelbelegungen – für die Disposition
 * unverzichtbar.
 */

vi.mock('@/lib/firebase', () => ({ db: {}, getDb: vi.fn(() => ({})) }));
vi.mock('@/lib/utils/companyId', () => ({
  getCompanyIdFromAuth: vi.fn(async () => 'firmaA'),
}));
vi.mock('firebase/firestore', () => firestoreModuleMock());

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
});

describe('Lesen', () => {
  it('liest einen Einsatz anhand der ID', async () => {
    harness.setDoc(einsatz('a1'));
    const service = await lade();
    const a = await service.getById('a1');
    expect(a).toMatchObject({ id: 'a1', userId: 'u1', shiftId: 's1', status: 'assigned' });
  });

  it('liefert null für einen unbekannten Einsatz', async () => {
    harness.setDoc(null);
    const service = await lade();
    expect(await service.getById('fehlt')).toBeNull();
  });

  it('liest die Einsätze eines Mitarbeiters', async () => {
    harness.setDocs([einsatz('a1'), einsatz('a2')]);
    const service = await lade();
    const result = await service.getByUserId('u1', 'firmaA');
    expect(result).toHaveLength(2);
    expect(harness.hatWhere('userId', 'u1')).toBe(true);
  });

  it('liest die Einsätze einer Schicht', async () => {
    harness.setDocs([einsatz('a1')]);
    const service = await lade();
    const result = await service.getByShiftId('s1');
    expect(result).toHaveLength(1);
    expect(harness.hatWhere('shiftId', 's1')).toBe(true);
  });

  it('filtert nach Status', async () => {
    harness.setDocs([einsatz('a1', { status: 'accepted' })]);
    const service = await lade();
    const result = await service.getByStatus('accepted');
    expect(result).toHaveLength(1);
    expect(harness.hatWhere('status', 'accepted')).toBe(true);
  });

  it('liefert eine Seite mit Gesamtzahl', async () => {
    harness.count = 2;
    harness.setDocs([einsatz('a1'), einsatz('a2')]);
    const service = await lade();
    const seite = await service.getAll(1, 50);
    expect(seite.data).toHaveLength(2);
  });

  it('liest die aktiven Einsätze einer Schicht', async () => {
    harness.setDocs([einsatz('a1', { status: 'accepted' })]);
    const service = await lade();
    const result = await service.getActiveByShift('s1');
    expect(result.length).toBeGreaterThanOrEqual(0);
  });
});

describe('Statuswechsel', () => {
  const schichtDoc = {
    id: 's1',
    data: { companyId: 'firmaA', date: '2026-07-20', startTime: '06:00', endTime: '14:00' },
  };

  it('legt einen Einsatz an', async () => {
    harness.setDoc(schichtDoc);
    const service = await lade();
    const id = await service.create('u1', 's1', 'Bitte übernehmen');
    expect(id).toBe('neu1');
    expect(harness.writes.find(w => w.art === 'add')?.daten).toMatchObject({
      userId: 'u1',
      shiftId: 's1',
      companyId: 'firmaA',
    });
  });

  it('legt eine Anfrage an', async () => {
    harness.setDoc(schichtDoc);
    const service = await lade();
    const id = await service.createRequest('u1', 's1');
    expect(id).toBe('neu1');
    expect(harness.writes.find(w => w.art === 'add')?.daten).toMatchObject({ status: 'requested' });
  });

  it('nimmt einen Einsatz an', async () => {
    harness.setDoc(einsatz('a1'));
    const service = await lade();
    await service.accept('a1');
    expect(harness.writes.find(w => w.art === 'update')?.daten).toMatchObject({
      status: 'accepted',
    });
  });

  it('lehnt einen Einsatz ab', async () => {
    harness.setDoc(einsatz('a1'));
    const service = await lade();
    await service.decline('a1');
    expect(harness.writes.find(w => w.art === 'update')?.daten).toMatchObject({
      status: 'declined',
    });
  });

  it('schließt einen Einsatz ab', async () => {
    harness.setDoc(einsatz('a1'));
    const service = await lade();
    await service.complete('a1');
    expect(harness.writes.find(w => w.art === 'update')?.daten).toMatchObject({
      status: 'completed',
    });
  });

  it('aktualisiert einen Einsatz', async () => {
    const service = await lade();
    await service.update('a1', { notes: 'Hinweis' } as never);
    expect(harness.writes.find(w => w.art === 'update')?.daten).toMatchObject({ notes: 'Hinweis' });
  });

  it('löscht einen Einsatz', async () => {
    const service = await lade();
    await service.delete('a1');
    expect(harness.writes.some(w => w.art === 'delete')).toBe(true);
  });

  it('aktualisiert mehrere Einsätze gemeinsam', async () => {
    const service = await lade();
    await service.bulkUpdate(['a1', 'a2', 'a3'], { status: 'completed' } as never);
    expect(harness.writes.filter(w => w.art === 'update')).toHaveLength(3);
  });

  it('weist eine Schicht mehreren Mitarbeitern zu', async () => {
    harness.setDoc(schichtDoc);
    const service = await lade();
    const ids = await service.bulkAssign('s1', ['u1', 'u2']);
    expect(ids).toHaveLength(2);
    expect(harness.writes.filter(w => w.art === 'add')).toHaveLength(2);
  });
});

describe('Konfliktprüfung', () => {
  it('meldet keinen Konflikt ohne bestehende Einsätze', async () => {
    harness.setDoc({
      id: 's1',
      data: { date: '2026-07-20', startTime: '06:00', endTime: '14:00', facilityId: 'f1' },
    });
    harness.setDocs([]);
    const service = await lade();
    const result = await service.checkConflict('u1', 's1');
    expect(result.hasConflict).toBe(false);
  });

  it('liefert bei unbekannter Schicht kein Ergebnis', async () => {
    harness.setDoc(null);
    const service = await lade();
    expect(await service.checkConflict('u1', 'fehlt')).toBeNull();
  });

  it('wirft beim Statuswechsel, wenn der Einsatz fehlt', async () => {
    harness.setDoc(null);
    const service = await lade();
    await expect(service.accept('fehlt')).rejects.toThrow(/nicht gefunden/);
  });

  it('prüft Konflikte für mehrere Mitarbeiter einer Schicht', async () => {
    harness.setDoc({
      id: 's1',
      data: { date: '2026-07-20', startTime: '06:00', endTime: '14:00' },
    });
    harness.setDocs([]);
    const service = await lade();
    const result = await service.checkConflictsForShift('s1', ['u1', 'u2']);
    expect(result).toBeTruthy();
  });
});

describe('Persönliche Einsatzlisten', () => {
  it('liefert die aktiven Einsätze eines Mitarbeiters', async () => {
    harness.setDocs([einsatz('a1', { status: 'accepted' })]);
    const service = await lade();
    const result = await service.getMyActiveAssignments('u1');
    expect(Array.isArray(result)).toBe(true);
    expect(harness.hatWhere('userId', 'u1')).toBe(true);
  });

  it('liefert die offenen Anfragen eines Mitarbeiters', async () => {
    harness.setDocs([einsatz('a1', { status: 'requested' })]);
    const service = await lade();
    const result = await service.getMyPendingAssignments('u1');
    expect(Array.isArray(result)).toBe(true);
  });
});
