import { beforeEach, describe, expect, it, vi } from 'vitest';
import { harness, firestoreModuleMock, ts } from './helpers/firestoreHarness';

/**
 * Einrichtungen (Kunden der Zeitarbeitsfirma) inklusive Stationen.
 * Die Station steht auf der Einsatzmitteilung – sie muss zuverlässig
 * angelegt, geändert und entfernt werden können.
 */

vi.mock('@/lib/firebase', () => ({
  db: {},
  getDb: vi.fn(() => ({})),
  auth: { currentUser: { uid: 'admin1' } },
}));
vi.mock('@/lib/utils/companyId', () => ({
  getCompanyIdFromAuth: vi.fn(async () => 'firmaA'),
}));
vi.mock('@/lib/services/auditLogService', () => ({ writeAuditLog: vi.fn(async () => undefined) }));
vi.mock('firebase/firestore', () => firestoreModuleMock());

const lade = async () => (await import('../facilities')).facilityService;

const einrichtung = (id: string, daten: Record<string, unknown> = {}) => ({
  id,
  data: {
    companyId: 'firmaA',
    name: 'Haus Sonnenschein',
    address: 'Hauptstr. 1, 45699 Herten',
    contactPerson: 'Frau Müller',
    phone: '02366 123456',
    email: 'info@sonnenschein.de',
    stations: [{ id: 'st1', name: 'Station 3' }],
    colorCode: '#0f766e',
    debtorNumber: 'D-1001',
    createdAt: ts(new Date(2026, 0, 1)),
    updatedAt: ts(new Date(2026, 6, 1)),
    ...daten,
  },
});

beforeEach(async () => {
  vi.clearAllMocks();
  harness.reset();
  const { getCompanyIdFromAuth } = await import('@/lib/utils/companyId');
  vi.mocked(getCompanyIdFromAuth).mockResolvedValue('firmaA');
});

describe('getById', () => {
  it('bildet eine Einrichtung ab', async () => {
    harness.setDoc(einrichtung('f1'));
    const service = await lade();
    const f = await service.getById('f1');
    expect(f).toMatchObject({
      id: 'f1',
      name: 'Haus Sonnenschein',
      contactPerson: 'Frau Müller',
      companyId: 'firmaA',
    });
  });

  it('liefert null für eine unbekannte Einrichtung', async () => {
    harness.setDoc(null);
    const service = await lade();
    expect(await service.getById('fehlt')).toBeNull();
  });

  it('setzt eine fehlende companyId auf leer', async () => {
    harness.setDoc({ id: 'f1', data: { name: 'Alt', address: 'A', contactPerson: 'B', phone: '1', email: 'a@b.de' } });
    const service = await lade();
    expect((await service.getById('f1'))?.companyId).toBe('');
  });
});

describe('getAll und Paginierung', () => {
  it('liest die Einrichtungen einer Firma', async () => {
    harness.setDocs([einrichtung('f1'), einrichtung('f2', { name: 'Seniorenstift' })]);
    const service = await lade();
    const result = await service.getAll('firmaA');
    expect(result).toHaveLength(2);
    expect(harness.hatWhere('companyId', 'firmaA')).toBe(true);
  });

  it('ermittelt die companyId selbst, wenn keine übergeben wird', async () => {
    harness.setDocs([einrichtung('f1')]);
    const service = await lade();
    await service.getAll();
    expect(harness.hatWhere('companyId', 'firmaA')).toBe(true);
  });

  it('liefert eine Seite mit Gesamtzahl', async () => {
    harness.count = 2;
    harness.setDocs([einrichtung('f1'), einrichtung('f2')]);
    const service = await lade();
    const seite = await service.getAllPaginated(1, 50, 'firmaA');
    expect(seite.data).toHaveLength(2);
    expect(seite.page).toBe(1);
  });
});

describe('create und update', () => {
  it('legt eine Einrichtung mit companyId an', async () => {
    const service = await lade();
    const id = await service.create({
      name: 'Neu',
      address: 'A',
      contactPerson: 'B',
      phone: '1',
      email: 'a@b.de',
      companyId: 'firmaA',
    } as never);
    expect(id).toBe('neu1');
    expect(harness.writes.find(w => w.art === 'add')?.daten).toMatchObject({ companyId: 'firmaA' });
  });

  it('ergänzt die companyId aus dem Token', async () => {
    const service = await lade();
    await service.create({ name: 'Neu', address: 'A', contactPerson: 'B', phone: '1', email: 'a@b.de' } as never);
    expect(harness.writes.find(w => w.art === 'add')?.daten).toMatchObject({ companyId: 'firmaA' });
  });

  it('wirft ohne ermittelbare companyId', async () => {
    const { getCompanyIdFromAuth } = await import('@/lib/utils/companyId');
    vi.mocked(getCompanyIdFromAuth).mockResolvedValue(null);
    const service = await lade();
    await expect(
      service.create({ name: 'Neu', address: 'A', contactPerson: 'B', phone: '1', email: 'a@b.de' } as never)
    ).rejects.toThrow(/companyId/);
  });

  it('aktualisiert eine Einrichtung', async () => {
    harness.setDoc(einrichtung('f1'));
    const service = await lade();
    await service.update('f1', { name: 'Umbenannt' } as never);
    expect(harness.writes.find(w => w.art === 'update')?.daten).toMatchObject({ name: 'Umbenannt' });
  });

  it('löscht eine Einrichtung', async () => {
    harness.setDoc(einrichtung('f1'));
    const service = await lade();
    await service.delete('f1');
    expect(harness.writes.some(w => w.art === 'delete')).toBe(true);
  });
});

describe('Stationen', () => {
  it('fügt eine Station hinzu', async () => {
    harness.setDoc(einrichtung('f1'));
    const service = await lade();
    await service.addStation('f1', { name: 'Station 4' } as never);
    const write = harness.writes.find(w => w.art === 'update');
    const stationen = (write?.daten as { stations?: unknown[] })?.stations;
    expect(Array.isArray(stationen)).toBe(true);
    expect((stationen as Array<{ name: string }>).some(s => s.name === 'Station 4')).toBe(true);
  });

  it('ändert eine Station', async () => {
    harness.setDoc(einrichtung('f1'));
    const service = await lade();
    await service.updateStation('f1', 'st1', { name: 'Station 3a' } as never);
    const stationen = (harness.writes.find(w => w.art === 'update')?.daten as {
      stations?: Array<{ id: string; name: string }>;
    })?.stations;
    expect(stationen?.find(s => s.id === 'st1')?.name).toBe('Station 3a');
  });

  it('entfernt eine Station', async () => {
    harness.setDoc(einrichtung('f1'));
    const service = await lade();
    await service.removeStation('f1', 'st1');
    const stationen = (harness.writes.find(w => w.art === 'update')?.daten as {
      stations?: Array<{ id: string }>;
    })?.stations;
    expect(stationen?.some(s => s.id === 'st1')).toBe(false);
  });

  it('wirft, wenn die Einrichtung für eine Stationsänderung fehlt', async () => {
    harness.setDoc(null);
    const service = await lade();
    await expect(service.addStation('fehlt', { name: 'X' } as never)).rejects.toThrow();
  });
});
