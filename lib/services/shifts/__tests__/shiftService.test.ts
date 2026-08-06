import { beforeEach, describe, expect, it, vi } from 'vitest';
import { harness, firestoreModuleMock, ts } from '../../__tests__/helpers/firestoreHarness';

/**
 * Schichtdienst: Anlegen, Ändern, Zuweisen, Kapazität, Konflikte.
 * Der Dienstplan ist das Herz der Einsatzplanung – hier zählt vor allem, dass
 * die Mandantenbindung sitzt und Kapazitäten nicht überbucht werden.
 */

vi.mock('@/lib/firebase', () => ({ db: {}, getDb: vi.fn(() => ({})) }));
vi.mock('@/lib/utils/companyId', () => ({
  getCompanyIdFromAuth: vi.fn(async () => 'firmaA'),
}));
vi.mock('@/lib/services/auditLogService', () => ({ writeAuditLog: vi.fn(async () => undefined) }));
vi.mock('firebase/auth', () => ({ getAuth: () => ({ currentUser: { uid: 'admin1' } }) }));
vi.mock('firebase/firestore', () => firestoreModuleMock());

const lade = async () => (await import('../index')).shiftService;

const schichtDaten = (daten: Record<string, unknown> = {}) => ({
  facilityId: 'f1',
  companyId: 'firmaA',
  date: '2026-07-20T00:00:00.000Z',
  startTime: '06:00',
  endTime: '14:00',
  type: 'Frühdienst',
  capacity: 2,
  assignedCount: 0,
  status: 'open',
  assignedTo: [],
  createdAt: ts(new Date(2026, 6, 18)),
  updatedAt: ts(new Date(2026, 6, 18)),
  ...daten,
});

beforeEach(async () => {
  vi.clearAllMocks();
  harness.reset();
  const { getCompanyIdFromAuth } = await import('@/lib/utils/companyId');
  vi.mocked(getCompanyIdFromAuth).mockResolvedValue('firmaA');
});

describe('getById', () => {
  it('liefert die Schicht abgebildet zurück', async () => {
    harness.setDoc({ id: 's1', data: schichtDaten() });
    const service = await lade();
    const shift = await service.getById('s1');
    expect(shift).toMatchObject({ id: 's1', facilityId: 'f1', date: '2026-07-20', capacity: 2 });
  });

  it('liefert null, wenn die Schicht nicht existiert', async () => {
    harness.setDoc(null);
    const service = await lade();
    expect(await service.getById('fehlt')).toBeNull();
  });
});

describe('create', () => {
  it('legt eine Schicht mit companyId an', async () => {
    const service = await lade();
    const id = await service.create(schichtDaten() as never);
    expect(id).toBe('neu1');
    expect(harness.writes.find(w => w.art === 'add')?.daten).toMatchObject({ companyId: 'firmaA' });
  });

  it('übernimmt die companyId aus der Einrichtung, wenn sie fehlt', async () => {
    harness.setDoc({ id: 'f1', data: { companyId: 'firmaAusEinrichtung' } });
    const service = await lade();
    await service.create(schichtDaten({ companyId: undefined }) as never);
    expect(harness.writes.find(w => w.art === 'add')?.daten).toMatchObject({
      companyId: 'firmaAusEinrichtung',
    });
  });

  it('wirft ohne ermittelbare companyId', async () => {
    const { getCompanyIdFromAuth } = await import('@/lib/utils/companyId');
    vi.mocked(getCompanyIdFromAuth).mockResolvedValue(null);
    harness.setDoc(null);
    const service = await lade();
    await expect(
      service.create(schichtDaten({ companyId: undefined, facilityId: undefined }) as never)
    ).rejects.toThrow();
  });
});

describe('update, updateStatus und delete', () => {
  it('aktualisiert eine Schicht', async () => {
    harness.setDoc({ id: 's1', data: schichtDaten() });
    const service = await lade();
    await service.update('s1', { notes: 'Geändert' } as never);
    expect(harness.writes.find(w => w.art === 'update')?.daten).toMatchObject({ notes: 'Geändert' });
  });

  it('setzt den Status', async () => {
    const service = await lade();
    await service.updateStatus('s1', 'cancelled');
    expect(harness.writes.find(w => w.art === 'update')?.daten).toMatchObject({
      status: 'cancelled',
    });
  });

  it('löscht eine Schicht', async () => {
    harness.setDoc({ id: 's1', data: schichtDaten() });
    const service = await lade();
    await service.delete('s1');
    expect(harness.writes.some(w => w.art === 'delete')).toBe(true);
  });
});

describe('Abfragen', () => {
  it('liest Schichten einer Einrichtung', async () => {
    harness.setDocs([{ id: 's1', data: schichtDaten() }]);
    const service = await lade();
    const result = await service.getByFacility('f1');
    expect(result).toHaveLength(1);
    expect(harness.hatWhere('facilityId', 'f1')).toBe(true);
  });

  it('liest offene Schichten', async () => {
    harness.setDocs([{ id: 's1', data: schichtDaten({ status: 'open' }) }]);
    const service = await lade();
    const result = await service.getOpenShifts();
    expect(result).toHaveLength(1);
  });

  it('liest Schichten in einem Zeitraum', async () => {
    harness.setDocs([{ id: 's1', data: schichtDaten() }]);
    const service = await lade();
    const result = await service.getByDateRange(new Date(2026, 6, 1), new Date(2026, 6, 31));
    expect(result).toHaveLength(1);
  });

  it('liest alle Schichten der Firma', async () => {
    harness.setDocs([{ id: 's1', data: schichtDaten() }, { id: 's2', data: schichtDaten() }]);
    const service = await lade();
    const result = await service.getAll();
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('Kapazität', () => {
  it('liefert die freien Plätze einer Schicht', async () => {
    harness.setDoc({ id: 's1', data: schichtDaten({ capacity: 3, assignedCount: 1 }) });
    const service = await lade();
    const frei = await service.getAvailableSlots('s1');
    expect(frei).toBe(2);
  });

  it('liefert 0 freie Plätze bei voller Schicht', async () => {
    harness.setDoc({ id: 's1', data: schichtDaten({ capacity: 2, assignedCount: 2 }) });
    const service = await lade();
    expect(await service.getAvailableSlots('s1')).toBe(0);
  });

  it('legt eine Schicht mit Kapazität an', async () => {
    const service = await lade();
    const id = await service.createWithCapacity(schichtDaten({ capacity: 4 }) as never);
    expect(id).toBeTruthy();
  });

  it('ändert die Kapazität', async () => {
    harness.setDoc({ id: 's1', data: schichtDaten() });
    const service = await lade();
    await service.updateCapacity('s1', 5);
    expect(harness.writes.find(w => w.art === 'update')?.daten).toMatchObject({ capacity: 5 });
  });
});

describe('Zeitüberschneidung', () => {
  it('erkennt eine Überschneidung', async () => {
    const service = await lade();
    expect(
      service.checkTimeOverlap(
        { date: '2026-07-20', startTime: '06:00', endTime: '14:00' },
        { date: '2026-07-20', startTime: '13:00', endTime: '21:00' }
      )
    ).toBe(true);
  });

  it('rechnet Uhrzeiten in Millisekunden um', async () => {
    const service = await lade();
    expect(service.timeToMs('02:00')).toBe(2 * 60 * 60 * 1000);
  });
});
