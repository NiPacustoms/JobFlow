import { beforeEach, describe, expect, it, vi } from 'vitest';
import { harness, firestoreModuleMock, ts } from './helpers/firestoreHarness';

/**
 * Warnungen (Dokumentablauf, unbesetzte Schichten, Überstunden).
 * Kritisch: Warnungen dürfen NIE über Firmengrenzen hinweg sichtbar sein.
 */

vi.mock('@/lib/firebase', () => ({ db: {}, getDb: vi.fn(() => ({})) }));
vi.mock('@/lib/utils/companyId', () => ({
  getCompanyIdFromAuth: vi.fn(async () => 'firmaA'),
}));
vi.mock('firebase/firestore', () => firestoreModuleMock());

const lade = async () => (await import('../alerts')).alertService;

const alertDoc = (id: string, daten: Record<string, unknown> = {}) => ({
  id,
  data: {
    userId: 'u1',
    companyId: 'firmaA',
    type: 'document-expiry',
    severity: 'warning',
    title: 'Dokument läuft ab',
    message: 'Führungszeugnis läuft in 14 Tagen ab',
    acknowledged: false,
    createdAt: ts(new Date(2026, 6, 20)),
    ...daten,
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  harness.reset();
});

describe('alertService.create', () => {
  it('legt eine Warnung mit companyId an', async () => {
    const service = await lade();
    const result = await service.create({
      userId: 'u1',
      companyId: 'firmaA',
      type: 'document-expiry',
      severity: 'warning',
      title: 'Test',
      message: 'Nachricht',
    } as never);

    expect(result.id).toBe('neu1');
    expect(result.acknowledged).toBe(false);
    const write = harness.writes.find(w => w.art === 'add');
    expect(write?.daten).toMatchObject({ companyId: 'firmaA', acknowledged: false });
  });

  it('holt die companyId aus dem Nutzerdokument, wenn sie fehlt', async () => {
    harness.setDoc({ id: 'u1', data: { companyId: 'firmaAusUser' } });
    const service = await lade();
    await service.create({ userId: 'u1', type: 'x', severity: 'info', title: 't', message: 'm' } as never);
    const write = harness.writes.find(w => w.art === 'add');
    expect(write?.daten).toMatchObject({ companyId: 'firmaAusUser' });
  });

  it('fällt auf die companyId aus dem Auth-Token zurück', async () => {
    harness.setDoc(null);
    const service = await lade();
    await service.create({ type: 'x', severity: 'info', title: 't', message: 'm' } as never);
    const write = harness.writes.find(w => w.art === 'add');
    expect(write?.daten).toMatchObject({ companyId: 'firmaA' });
  });

  it('wirft, wenn gar keine companyId ermittelbar ist', async () => {
    const { getCompanyIdFromAuth } = await import('@/lib/utils/companyId');
    vi.mocked(getCompanyIdFromAuth).mockResolvedValueOnce(null);
    harness.setDoc(null);
    const service = await lade();
    await expect(
      service.create({ type: 'x', severity: 'info', title: 't', message: 'm' } as never)
    ).rejects.toThrow(/companyId/);
  });
});

describe('alertService.getAlerts', () => {
  it('filtert nach companyId und Nutzer', async () => {
    harness.setDocs([alertDoc('a1')]);
    const service = await lade();
    const result = await service.getAlerts('u1');

    expect(result).toHaveLength(1);
    expect(harness.hatWhere('companyId', 'firmaA')).toBe(true);
    expect(harness.hatWhere('userId', 'u1')).toBe(true);
  });

  it('liefert für Admins die Warnungen aller Nutzer der Firma', async () => {
    harness.setDocs([{ id: 'u1', data: {} }, { id: 'u2', data: {} }], [alertDoc('a1'), alertDoc('a2')]);
    const service = await lade();
    const result = await service.getAlerts();
    expect(result.length).toBeGreaterThan(0);
    expect(harness.hatWhere('companyId', 'firmaA')).toBe(true);
  });

  it('liefert eine leere Liste, wenn die Firma keine Nutzer hat', async () => {
    harness.setDocs([]);
    const service = await lade();
    expect(await service.getAlerts()).toEqual([]);
  });

  it('liefert ohne companyId eine leere Liste statt aller Warnungen', async () => {
    const { getCompanyIdFromAuth } = await import('@/lib/utils/companyId');
    vi.mocked(getCompanyIdFromAuth).mockResolvedValueOnce(null);
    const service = await lade();
    expect(await service.getAlerts()).toEqual([]);
  });

  it('nutzt eine übergebene companyId ohne Auth-Abfrage', async () => {
    harness.setDocs([alertDoc('a1')]);
    const service = await lade();
    await service.getAlerts('u1', 10, 'firmaB');
    expect(harness.hatWhere('companyId', 'firmaB')).toBe(true);
  });
});

describe('alertService.acknowledge und delete', () => {
  it('quittiert eine Warnung', async () => {
    const service = await lade();
    await service.acknowledge('a1', 'u1');
    const write = harness.writes.find(w => w.art === 'update');
    expect(write?.daten).toMatchObject({ acknowledged: true, acknowledgedBy: 'u1' });
  });

  it('löscht eine Warnung', async () => {
    const service = await lade();
    await service.delete('a1');
    expect(harness.writes.some(w => w.art === 'delete')).toBe(true);
  });
});

describe('alertService – Regeln und Einstellungen', () => {
  it('liest die Warnregeln', async () => {
    harness.setDocs([
      { id: 'r1', data: { name: 'Dokumentablauf', enabled: true, createdAt: ts(new Date()) } },
    ]);
    const service = await lade();
    const regeln = await service.getAlertRules();
    expect(regeln).toHaveLength(1);
  });

  it('legt eine Warnregel an', async () => {
    const service = await lade();
    const regel = await service.createAlertRule({
      name: 'Überstunden',
      enabled: true,
      type: 'overtime',
    } as never);
    expect(regel.id).toBe('neu1');
    expect(harness.writes.some(w => w.art === 'add')).toBe(true);
  });

  it('liest Einstellungen eines Nutzers', async () => {
    harness.setDoc({ id: 'u1', data: { emailEnabled: true } });
    const service = await lade();
    const settings = await service.getAlertSettings('u1');
    expect(settings).toMatchObject({ emailEnabled: true });
  });

  it('liefert null, wenn keine Einstellungen hinterlegt sind', async () => {
    harness.setDoc(null);
    const service = await lade();
    expect(await service.getAlertSettings('u1')).toBeNull();
  });

  it('speichert Einstellungen', async () => {
    const service = await lade();
    await service.updateAlertSettings('u1', { emailEnabled: false } as never);
    expect(harness.writes.some(w => w.art === 'set' || w.art === 'update')).toBe(true);
  });
});

describe('alertService.subscribeToAlerts', () => {
  const schnappschuss = (docs: Array<{ id: string; data: Record<string, unknown> }>) => ({
    docs: docs.map(d => ({ id: d.id, data: () => d.data })),
  });

  it('liefert Warnungen eines Nutzers absteigend sortiert (max. 20)', async () => {
    const firestore = await import('firebase/firestore');
    let handler: ((snap: unknown) => void) | undefined;
    vi.mocked(firestore.onSnapshot).mockImplementation(((
      _q: unknown,
      onNext: (snap: unknown) => void
    ) => {
      handler = onNext;
      return () => undefined;
    }) as never);

    const service = await lade();
    const callback = vi.fn();
    const unsub = service.subscribeToAlerts('u1', callback, 'firmaA');

    handler?.(
      schnappschuss([
        alertDoc('alt', { createdAt: ts(new Date(2026, 6, 1)) }),
        alertDoc('neu', { createdAt: ts(new Date(2026, 6, 20)) }),
      ])
    );

    const gemeldet = callback.mock.calls.at(-1)?.[0] as Array<{ id: string }>;
    expect(gemeldet.map(a => a.id)).toEqual(['neu', 'alt']);
    expect(typeof unsub).toBe('function');
  });

  it('meldet bei Berechtigungsfehlern eine leere Liste', async () => {
    const firestore = await import('firebase/firestore');
    vi.mocked(firestore.onSnapshot).mockImplementation(((
      _q: unknown,
      _onNext: unknown,
      onError: (e: unknown) => void
    ) => {
      onError({ code: 'permission-denied', message: 'permission' });
      return () => undefined;
    }) as never);

    const service = await lade();
    const callback = vi.fn();
    service.subscribeToAlerts(null, callback, 'firmaA');
    expect(callback).toHaveBeenCalledWith([]);
  });

  it('fängt Fehler beim Einrichten des Abos ab', async () => {
    const firestore = await import('firebase/firestore');
    vi.mocked(firestore.onSnapshot).mockImplementation((() => {
      throw new Error('kaputt');
    }) as never);

    const service = await lade();
    const callback = vi.fn();
    const unsub = service.subscribeToAlerts('u1', callback);
    expect(callback).toHaveBeenCalledWith([]);
    expect(() => unsub()).not.toThrow();
  });
});

describe('alertService – automatische Prüfungen', () => {
  it('legt Warnungen für ablaufende und abgelaufene Dokumente an', async () => {
    const service = await lade();
    vi.spyOn(service, 'getExpiringDocuments').mockResolvedValue([
      { id: 'd1', userId: 'u1', type: 'Führungszeugnis' } as never,
    ]);
    vi.spyOn(service, 'getExpiredDocuments').mockResolvedValue([
      { id: 'd2', userId: 'u2', type: 'Impfnachweis' } as never,
    ]);
    const createSpy = vi.spyOn(service, 'create').mockResolvedValue({} as never);

    await service.checkDocumentAlerts();
    expect(createSpy).toHaveBeenCalledTimes(2);
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Dokument läuft bald ab', severity: 'medium' })
    );
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Dokument abgelaufen', severity: 'high' })
    );
  });

  it('legt Warnungen für bevorstehende und unbesetzte Schichten an', async () => {
    const service = await lade();
    vi.spyOn(service, 'getUpcomingShifts').mockResolvedValue([
      { id: 's1', title: 'Frühdienst', startTime: '06:00', facilityId: 'f1' } as never,
    ]);
    vi.spyOn(service, 'getUnfilledShifts').mockResolvedValue([
      { id: 's2', title: 'Nachtdienst', facilityId: 'f1' } as never,
    ]);
    const createSpy = vi.spyOn(service, 'create').mockResolvedValue({} as never);

    await service.checkShiftAlerts();
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Schicht beginnt morgen', severity: 'low' })
    );
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Schicht noch nicht besetzt', severity: 'medium' })
    );
  });

  it('legt Warnungen für Tages- und Wochenüberstunden an', async () => {
    const service = await lade();
    vi.spyOn(service, 'getDailyOvertimeUsers').mockResolvedValue([
      { id: 'u1', displayName: 'Anna Muster' } as never,
    ]);
    vi.spyOn(service, 'getWeeklyOvertimeUsers').mockResolvedValue([
      { id: 'u2', displayName: 'Bea Beispiel' } as never,
    ]);
    const createSpy = vi.spyOn(service, 'create').mockResolvedValue({} as never);

    await service.checkOvertimeAlerts();
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Tägliche Überstunden', userId: 'u1' })
    );
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Wöchentliche Überstunden', severity: 'high' })
    );
  });

  it('schluckt Fehler der Prüfungen, statt den Aufrufer zu stören', async () => {
    const service = await lade();
    vi.spyOn(service, 'getExpiringDocuments').mockRejectedValue(new Error('kaputt'));
    vi.spyOn(service, 'getUpcomingShifts').mockRejectedValue(new Error('kaputt'));
    vi.spyOn(service, 'getDailyOvertimeUsers').mockRejectedValue(new Error('kaputt'));

    await expect(service.checkDocumentAlerts()).resolves.toBeUndefined();
    await expect(service.checkShiftAlerts()).resolves.toBeUndefined();
    await expect(service.checkOvertimeAlerts()).resolves.toBeUndefined();
  });

  it('liefert für die Platzhalter-Abfragen leere Listen', async () => {
    // Spione der vorherigen Tests auf dem Service-Singleton zurücknehmen
    vi.restoreAllMocks();
    const service = await lade();
    await expect(service.getExpiringDocuments()).resolves.toEqual([]);
    await expect(service.getExpiredDocuments()).resolves.toEqual([]);
    await expect(service.getUpcomingShifts()).resolves.toEqual([]);
    await expect(service.getUnfilledShifts()).resolves.toEqual([]);
    await expect(service.getDailyOvertimeUsers()).resolves.toEqual([]);
    await expect(service.getWeeklyOvertimeUsers()).resolves.toEqual([]);
  });
});
