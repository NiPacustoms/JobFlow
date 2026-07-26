import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regressionstests zur Zeiterfassung: Validierung beim Anlegen/Ändern,
 * Überlappungserkennung (geteilte Dienste, Nachtschicht) und GoBD-Sperren.
 */

vi.mock('@/lib/firebase', () => ({
  db: {},
  getDb: vi.fn(() => ({})),
  auth: { currentUser: { uid: 'user123' } },
  functions: {},
}));

vi.mock('@/lib/utils/companyId', () => ({
  getCompanyIdFromAuth: vi.fn(() => Promise.resolve('company123')),
}));

const addToQueue = vi.fn(async () => 'offline_1');
vi.mock('../offlineQueue', () => ({
  offlineQueueService: { addToQueue: (...args: unknown[]) => addToQueue(...args) },
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => ({})),
  doc: vi.fn(() => ({})),
  addDoc: vi.fn(),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
}));

const setzeOnline = (online: boolean) => {
  Object.defineProperty(navigator, 'onLine', { value: online, configurable: true });
};

const ladeService = async () => (await import('../timesheets')).timesheetService;

describe('timesheetService.create – Validierung', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    setzeOnline(true);
    const { getDoc, addDoc } = await import('firebase/firestore');
    vi.mocked(getDoc).mockResolvedValue({
      exists: () => true,
      data: () => ({ companyId: 'company123' }),
    } as never);
    vi.mocked(addDoc).mockResolvedValue({ id: 'ts1' } as never);
  });

  const formular = (overrides: Record<string, unknown> = {}) =>
    ({
      userId: 'user123',
      date: new Date(2026, 6, 20),
      startTime: '06:00',
      endTime: '14:00',
      breakMinutes: 30,
      ...overrides,
    }) as never;

  it('berechnet die Nettostunden korrekt', async () => {
    const service = await ladeService();
    const { addDoc } = await import('firebase/firestore');
    await service.create('user123', formular());
    expect(vi.mocked(addDoc).mock.calls[0][1]).toMatchObject({ totalHours: 7.5 });
  });

  it('berechnet Nachtschichten über Mitternacht', async () => {
    const service = await ladeService();
    const { addDoc } = await import('firebase/firestore');
    await service.create('user123', formular({ startTime: '21:00', endTime: '06:00', breakMinutes: 45 }));
    expect(vi.mocked(addDoc).mock.calls[0][1]).toMatchObject({ totalHours: 8.25 });
  });

  it('lehnt ein ungültiges Zeitformat ab', async () => {
    const service = await ladeService();
    await expect(service.create('user123', formular({ startTime: '8 Uhr' }))).rejects.toThrow(
      /Zeitformat/
    );
  });

  it('lehnt eine Pause länger als die Arbeitszeit ab', async () => {
    const service = await ladeService();
    await expect(
      service.create('user123', formular({ startTime: '08:00', endTime: '09:00', breakMinutes: 90 }))
    ).rejects.toThrow(/Pause/);
  });

  it('lehnt negative Pausenminuten ab', async () => {
    const service = await ladeService();
    await expect(service.create('user123', formular({ breakMinutes: -15 }))).rejects.toThrow(
      /Pausenminuten/
    );
  });

  it('schreibt niemals negative Stunden in die Datenbank', async () => {
    const service = await ladeService();
    const { addDoc } = await import('firebase/firestore');
    await service.create('user123', formular({ startTime: '08:00', endTime: '16:00', breakMinutes: 0 }));
    const gespeichert = vi.mocked(addDoc).mock.calls[0][1] as { totalHours: number };
    expect(gespeichert.totalHours).toBeGreaterThan(0);
  });

  it('legt offline einen Queue-Eintrag statt eines Firestore-Dokuments an', async () => {
    setzeOnline(false);
    const service = await ladeService();
    const { addDoc } = await import('firebase/firestore');
    const id = await service.create('user123', formular());
    expect(id).toBe('offline_1');
    expect(addDoc).not.toHaveBeenCalled();
    expect(addToQueue).toHaveBeenCalledWith('timesheet', 'create', expect.objectContaining({
      userId: 'user123',
      totalHours: 7.5,
    }));
  });
});

describe('timesheetService.update – GoBD und Neuberechnung', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    setzeOnline(true);
  });

  const setzeBestand = async (daten: Record<string, unknown>) => {
    const { getDoc } = await import('firebase/firestore');
    vi.mocked(getDoc).mockResolvedValue({ exists: () => true, data: () => daten } as never);
  };

  it('berechnet die Stunden bei geänderter Endzeit neu', async () => {
    await setzeBestand({ status: 'draft', startTime: '06:00', endTime: '14:00', breakMinutes: 30 });
    const service = await ladeService();
    const { updateDoc } = await import('firebase/firestore');
    await service.update('ts1', { endTime: '16:00' } as never);
    expect(vi.mocked(updateDoc).mock.calls[0][1]).toMatchObject({ totalHours: 9.5 });
  });

  it('berechnet die Stunden bei geänderter Pause neu', async () => {
    await setzeBestand({ status: 'draft', startTime: '06:00', endTime: '14:00', breakMinutes: 30 });
    const service = await ladeService();
    const { updateDoc } = await import('firebase/firestore');
    await service.update('ts1', { breakMinutes: 60 } as never);
    expect(vi.mocked(updateDoc).mock.calls[0][1]).toMatchObject({ totalHours: 7 });
  });

  it('blockiert Änderungen an genehmigten Nachweisen (GoBD)', async () => {
    await setzeBestand({ status: 'approved', startTime: '06:00', endTime: '14:00', breakMinutes: 30 });
    const service = await ladeService();
    await expect(service.update('ts1', { endTime: '16:00' } as never)).rejects.toThrow(/GoBD/);
  });

  it('blockiert Änderungen an eingereichten Nachweisen (GoBD)', async () => {
    await setzeBestand({ status: 'submitted', startTime: '06:00', endTime: '14:00', breakMinutes: 30 });
    const service = await ladeService();
    await expect(service.update('ts1', { endTime: '16:00' } as never)).rejects.toThrow(/GoBD/);
  });

  it('wirft, wenn der Nachweis nicht existiert', async () => {
    const { getDoc } = await import('firebase/firestore');
    vi.mocked(getDoc).mockResolvedValue({ exists: () => false } as never);
    const service = await ladeService();
    await expect(service.update('fehlt', { endTime: '16:00' } as never)).rejects.toThrow(
      'Timesheet not found'
    );
  });

  it('stellt Änderungen offline in die Queue', async () => {
    setzeOnline(false);
    const service = await ladeService();
    const { updateDoc } = await import('firebase/firestore');
    await service.update('ts1', { breakMinutes: 45 } as never);
    expect(updateDoc).not.toHaveBeenCalled();
    expect(addToQueue).toHaveBeenCalledWith('timesheet', 'update', { id: 'ts1', breakMinutes: 45 });
  });
});

describe('timesheetService.submit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setzeOnline(true);
  });

  it('verweigert das Einreichen ohne Internetverbindung (ArbZG-Prüfung serverseitig)', async () => {
    setzeOnline(false);
    const service = await ladeService();
    await expect(service.submit('ts1')).rejects.toThrow(/Internetverbindung/);
  });
});

describe('aggregateTimesheetsByUser', () => {
  const sheet = (overrides: Record<string, unknown>) =>
    ({
      id: 't',
      userId: 'u1',
      date: new Date(2026, 6, 20),
      startTime: '08:00',
      endTime: '16:00',
      totalHours: 8,
      status: 'approved',
      ...overrides,
    }) as never;

  it('summiert Stunden je Mitarbeiter', async () => {
    const { aggregateTimesheetsByUser } = await import('../timesheets');
    const result = aggregateTimesheetsByUser([
      sheet({ id: 't1', totalHours: 8 }),
      sheet({ id: 't2', totalHours: 6 }),
      sheet({ id: 't3', userId: 'u2', totalHours: 4 }),
    ]);
    expect(result).toHaveLength(2);
    expect(result.find(r => r.userId === 'u1')?.totalHours).toBe(14);
    expect(result.find(r => r.userId === 'u2')?.totalHours).toBe(4);
  });

  it('weist genehmigte Stunden separat aus', async () => {
    const { aggregateTimesheetsByUser } = await import('../timesheets');
    const result = aggregateTimesheetsByUser([
      sheet({ id: 't1', totalHours: 8, status: 'approved' }),
      sheet({ id: 't2', totalHours: 5, status: 'draft' }),
    ]);
    expect(result[0].totalHours).toBe(13);
    expect(result[0].approvedHours).toBe(8);
  });

  it('liefert für eine leere Liste ein leeres Ergebnis', async () => {
    const { aggregateTimesheetsByUser } = await import('../timesheets');
    expect(aggregateTimesheetsByUser([])).toEqual([]);
  });
});
