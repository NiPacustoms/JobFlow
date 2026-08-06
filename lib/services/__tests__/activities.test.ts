import { beforeEach, describe, expect, it, vi } from 'vitest';
import { harness, firestoreModuleMock, ts } from './helpers/firestoreHarness';

/**
 * Aktivitätsprotokoll (Wer hat wann was geändert).
 * Wichtig: Das Protokollieren darf den Hauptvorgang niemals abbrechen und
 * niemals firmenfremde Einträge liefern.
 */

vi.mock('@/lib/firebase', () => ({ db: {}, getDb: vi.fn(() => ({})) }));
vi.mock('@/lib/utils/companyId', () => ({
  getCompanyIdFromAuth: vi.fn(async () => 'firmaA'),
}));
vi.mock('firebase/firestore', () => firestoreModuleMock());

const lade = async () => (await import('../activities')).activityService;

const eintrag = (id: string, daten: Record<string, unknown> = {}) => ({
  id,
  data: {
    userId: 'u1',
    userName: 'Anna Muster',
    userRole: 'admin',
    type: 'shift',
    action: 'create',
    entityType: 'shift',
    entityId: 's1',
    entityName: 'Frühdienst',
    description: 'Schicht angelegt',
    companyId: 'firmaA',
    timestamp: ts(new Date(2026, 6, 20)),
    ...daten,
  },
});

beforeEach(async () => {
  vi.clearAllMocks();
  harness.reset();
  const { getCompanyIdFromAuth } = await import('@/lib/utils/companyId');
  vi.mocked(getCompanyIdFromAuth).mockResolvedValue('firmaA');
});

describe('activityService.create', () => {
  it('legt einen Eintrag mit Zeitstempel und companyId an', async () => {
    const service = await lade();
    const result = await service.create({
      userId: 'u1',
      userName: 'Anna',
      userRole: 'admin',
      type: 'shift',
      action: 'create',
      entityType: 'shift',
      entityId: 's1',
      entityName: 'Frühdienst',
      description: 'angelegt',
      companyId: 'firmaA',
    } as never);

    expect(result.id).toBe('neu1');
    expect(result.timestamp).toBeInstanceOf(Date);
    expect(harness.writes.find(w => w.art === 'add')?.daten).toMatchObject({ companyId: 'firmaA' });
  });

  it('ergänzt die companyId aus dem Nutzerdokument', async () => {
    harness.setDoc({ id: 'u1', data: { companyId: 'firmaAusUser' } });
    const service = await lade();
    await service.create({
      userId: 'u1',
      userName: 'Anna',
      userRole: 'admin',
      type: 'user',
      action: 'update',
      entityType: 'user',
      entityId: 'u1',
      entityName: 'Anna',
      description: 'geändert',
      companyId: '',
    } as never);
    expect(harness.writes.find(w => w.art === 'add')?.daten).toMatchObject({
      companyId: 'firmaAusUser',
    });
  });

  it('wirft ohne ermittelbare companyId', async () => {
    const { getCompanyIdFromAuth } = await import('@/lib/utils/companyId');
    vi.mocked(getCompanyIdFromAuth).mockResolvedValue(null);
    harness.setDoc(null);
    const service = await lade();
    await expect(
      service.create({
        userName: 'Anna',
        userRole: 'admin',
        type: 'system',
        action: 'create',
        entityType: 'x',
        entityId: 'y',
        entityName: 'z',
        description: 'd',
        companyId: '',
      } as never)
    ).rejects.toThrow(/companyId/);
  });
});

describe('activityService.getAll', () => {
  it('liest Aktivitäten der eigenen Firma', async () => {
    harness.setDocs([eintrag('a1'), eintrag('a2')]);
    const service = await lade();
    const result = await service.getAll();
    expect(result).toHaveLength(2);
    expect(harness.hatWhere('companyId', 'firmaA')).toBe(true);
  });

  it('filtert nach Nutzer', async () => {
    harness.setDocs([eintrag('a1')]);
    const service = await lade();
    await service.getAll({ userId: 'u1' });
    expect(harness.hatWhere('userId', 'u1')).toBe(true);
  });

  it('filtert nach Typ', async () => {
    harness.setDocs([eintrag('a1')]);
    const service = await lade();
    await service.getAll({ type: 'shift' as never });
    expect(harness.hatWhere('type', 'shift')).toBe(true);
  });

  it('liefert ohne companyId eine leere Liste', async () => {
    const { getCompanyIdFromAuth } = await import('@/lib/utils/companyId');
    vi.mocked(getCompanyIdFromAuth).mockResolvedValue(null);
    const service = await lade();
    expect(await service.getAll()).toEqual([]);
  });

  it('liefert bei einem Abfragefehler eine leere Liste statt zu werfen', async () => {
    harness.naechsterFehler = new Error('Index fehlt');
    const service = await lade();
    await expect(service.getAll()).resolves.toBeInstanceOf(Array);
  });
});

describe('activityService – abgeleitete Abfragen', () => {
  it('getRecent reicht das Limit durch', async () => {
    harness.setDocs([eintrag('a1')]);
    const service = await lade();
    const result = await service.getRecent(10, 'firmaA');
    expect(result).toHaveLength(1);
  });

  it('getByUserId filtert nach Nutzer', async () => {
    harness.setDocs([eintrag('a1')]);
    const service = await lade();
    await service.getByUserId('u1', 5);
    expect(harness.hatWhere('userId', 'u1')).toBe(true);
  });

  it('getByEntity filtert nach Entitätstyp', async () => {
    harness.setDocs([eintrag('a1')]);
    const service = await lade();
    await service.getByEntity('shift', 's1');
    expect(harness.hatWhere('entityType', 'shift')).toBe(true);
  });

  it('getStats zählt nach Typ, Aktion und Nutzer', async () => {
    harness.setDocs([
      eintrag('a1', { type: 'shift', action: 'create', userName: 'Anna' }),
      eintrag('a2', { type: 'shift', action: 'update', userName: 'Anna' }),
      eintrag('a3', { type: 'user', action: 'create', userName: 'Bea' }),
    ]);
    const service = await lade();
    const stats = await service.getStats();
    expect(stats.total).toBe(3);
    expect(stats.byType.shift).toBe(2);
    expect(stats.byAction.create).toBe(2);
    // byUser wird nach Anzeigenamen gruppiert (Auswertung für die Oberfläche)
    expect(stats.byUser.Anna).toBe(2);
    expect(stats.byUser.Bea).toBe(1);
    expect(stats.recent).toHaveLength(3);
  });
});

describe('activityService – Protokoll-Hilfsmethoden', () => {
  it.each([
    ['logShiftActivity', ['u1', 'Anna', 'admin', 'create', 's1', 'Frühdienst', 'angelegt']],
    ['logAssignmentActivity', ['u1', 'Anna', 'admin', 'create', 'a1', 'Einsatz', 'angelegt']],
    ['logTimesheetActivity', ['u1', 'Anna', 'nurse', 'create', 't1', 'Nachweis', 'erfasst']],
    ['logDocumentActivity', ['u1', 'Anna', 'admin', 'create', 'd1', 'Vertrag', 'hochgeladen']],
    ['logFacilityActivity', ['u1', 'Anna', 'admin', 'create', 'f1', 'Haus', 'angelegt']],
  ] as const)('%s legt einen Eintrag an', async (methode, args) => {
    const service = await lade();
    await (service as unknown as Record<string, (...a: unknown[]) => Promise<void>>)[methode](
      ...(args as unknown[])
    );
    expect(harness.writes.filter(w => w.art === 'add')).toHaveLength(1);
  });

  it('logUserActivity legt einen Eintrag an', async () => {
    const service = await lade();
    await service.logUserActivity(
      'u1',
      'Anna',
      'admin' as never,
      'update' as never,
      'user',
      'u2',
      'Bea',
      'Rolle geändert'
    );
    expect(harness.writes.filter(w => w.art === 'add')).toHaveLength(1);
  });

  it('bricht den Hauptvorgang NICHT ab, wenn das Protokollieren scheitert', async () => {
    const { getCompanyIdFromAuth } = await import('@/lib/utils/companyId');
    vi.mocked(getCompanyIdFromAuth).mockResolvedValue(null);
    harness.setDoc(null);
    const service = await lade();
    await expect(
      service.logShiftActivity('u1', 'Anna', 'admin' as never, 'create' as never, 's1', 'F', 'd')
    ).resolves.toBeUndefined();
  });

  it('logSystemActivity legt einen Eintrag ohne Nutzerbezug an', async () => {
    const service = await lade();
    await service.logSystemActivity('create' as never, 'system', 'sys1', 'Wartung', 'Lauf gestartet');
    expect(harness.writes.filter(w => w.art === 'add')).toHaveLength(1);
  });
});
