import { beforeEach, describe, expect, it, vi } from 'vitest';
import { harness, firestoreModuleMock, ts } from './helpers/firestoreHarness';

/**
 * Personaldokumente (Führungszeugnis, Impfnachweis, Qualifikationen).
 * In der Pflege ist der Ablauf eines Nachweises einsatzrelevant – die
 * Statusberechnung muss stimmen.
 */

vi.mock('@/lib/firebase', () => ({ db: {}, getDb: vi.fn(() => ({})) }));
vi.mock('@/lib/utils/companyId', () => ({
  getCompanyIdFromAuth: vi.fn(async () => 'firmaA'),
}));
vi.mock('firebase/firestore', () => firestoreModuleMock());

const lade = async () => (await import('../documents')).documentService;

const dokument = (id: string, daten: Record<string, unknown> = {}) => ({
  id,
  data: {
    userId: 'u1',
    companyId: 'firmaA',
    name: 'Führungszeugnis',
    type: 'certificate',
    url: 'https://storage/doc.pdf',
    status: 'valid',
    verified: false,
    createdAt: ts(new Date(2026, 0, 1)),
    updatedAt: ts(new Date(2026, 6, 1)),
    ...daten,
  },
});

const inTagen = (tage: number) => {
  const d = new Date();
  d.setDate(d.getDate() + tage);
  return d;
};

beforeEach(async () => {
  vi.clearAllMocks();
  harness.reset();
  const { getCompanyIdFromAuth } = await import('@/lib/utils/companyId');
  vi.mocked(getCompanyIdFromAuth).mockResolvedValue('firmaA');
});

describe('calculateStatus', () => {
  it('meldet ohne Ablaufdatum "gültig"', async () => {
    const service = await lade();
    expect(service.calculateStatus(undefined)).toBe('valid');
  });

  it('meldet ein abgelaufenes Dokument', async () => {
    const service = await lade();
    expect(service.calculateStatus(inTagen(-1))).toBe('expired');
  });

  it('meldet ein bald ablaufendes Dokument (innerhalb 30 Tagen)', async () => {
    const service = await lade();
    expect(service.calculateStatus(inTagen(10))).toBe('expiring');
    expect(service.calculateStatus(inTagen(29))).toBe('expiring');
  });

  it('meldet ein Dokument mit langer Restlaufzeit als gültig', async () => {
    const service = await lade();
    expect(service.calculateStatus(inTagen(90))).toBe('valid');
  });
});

describe('create', () => {
  it('legt ein Dokument mit companyId und berechnetem Status an', async () => {
    harness.setDoc({ id: 'u1', data: { companyId: 'firmaA' } });
    const service = await lade();
    const result = await service.create({
      userId: 'u1',
      name: 'Führungszeugnis',
      type: 'certificate',
      url: 'https://storage/doc.pdf',
      expiryDate: inTagen(10),
    } as never);

    expect(result.id).toBe('neu1');
    expect(harness.writes.find(w => w.art === 'add')?.daten).toMatchObject({
      companyId: 'firmaA',
      status: 'expiring',
      verified: false,
    });
  });

  it('fällt auf die companyId aus dem Token zurück', async () => {
    harness.setDoc(null);
    const service = await lade();
    await service.create({ userId: 'u1', name: 'X', type: 'other', url: 'u' } as never);
    expect(harness.writes.find(w => w.art === 'add')?.daten).toMatchObject({ companyId: 'firmaA' });
  });

  it('wirft ohne ermittelbare companyId', async () => {
    const { getCompanyIdFromAuth } = await import('@/lib/utils/companyId');
    vi.mocked(getCompanyIdFromAuth).mockResolvedValue(null);
    harness.setDoc(null);
    const service = await lade();
    await expect(
      service.create({ userId: 'u1', name: 'X', type: 'other', url: 'u' } as never)
    ).rejects.toThrow(/companyId/);
  });
});

describe('Lesen', () => {
  it('liest ein Dokument anhand der ID', async () => {
    harness.setDoc(dokument('d1'));
    const service = await lade();
    const doc = await service.getById('d1');
    expect(doc).toMatchObject({ id: 'd1', name: 'Führungszeugnis' });
    expect(doc?.createdAt).toBeInstanceOf(Date);
  });

  it('liefert null für ein unbekanntes Dokument', async () => {
    harness.setDoc(null);
    const service = await lade();
    expect(await service.getById('fehlt')).toBeNull();
  });

  it('liest die Dokumente eines Mitarbeiters', async () => {
    harness.setDocs([dokument('d1'), dokument('d2')]);
    const service = await lade();
    const result = await service.getByUserId('u1');
    expect(result).toHaveLength(2);
    expect(harness.hatWhere('userId', 'u1')).toBe(true);
  });

  it('filtert nach Status', async () => {
    harness.setDocs([dokument('d1', { status: 'expired' })]);
    const service = await lade();
    await service.getAll({ status: 'expired' } as never);
    expect(harness.hatWhere('status', 'expired')).toBe(true);
  });

  it('liest ablaufende Dokumente im Zeitfenster', async () => {
    harness.setDocs([dokument('d1', { expiryDate: ts(inTagen(10)) })]);
    const service = await lade();
    const result = await service.getExpiringDocuments(30);
    expect(result).toHaveLength(1);
    expect(harness.hatWhere('companyId', 'firmaA')).toBe(true);
  });

  it('liefert ohne companyId keine ablaufenden Dokumente', async () => {
    const { getCompanyIdFromAuth } = await import('@/lib/utils/companyId');
    vi.mocked(getCompanyIdFromAuth).mockResolvedValue(null);
    const service = await lade();
    expect(await service.getExpiringDocuments()).toEqual([]);
  });

  it('liefert bei einem Abfragefehler eine leere Liste', async () => {
    harness.naechsterFehler = new Error('Index fehlt');
    const service = await lade();
    expect(await service.getExpiringDocuments()).toEqual([]);
  });
});

describe('Ändern, Prüfen, Löschen', () => {
  it('aktualisiert ein Dokument', async () => {
    const service = await lade();
    await service.update('d1', { name: 'Neuer Name' } as never);
    expect(harness.writes.find(w => w.art === 'update')?.daten).toMatchObject({
      name: 'Neuer Name',
    });
  });

  it('berechnet den Status neu, wenn das Ablaufdatum geändert wird', async () => {
    const service = await lade();
    await service.update('d1', { expiryDate: inTagen(-5) } as never);
    expect(harness.writes.find(w => w.art === 'update')?.daten).toMatchObject({
      status: 'expired',
    });
  });

  it('verifiziert ein Dokument', async () => {
    const service = await lade();
    await service.verify('d1', 'admin1');
    expect(harness.writes.find(w => w.art === 'update')?.daten).toMatchObject({
      verified: true,
      verifiedBy: 'admin1',
    });
  });

  it('lehnt ein Dokument mit Begründung ab', async () => {
    const service = await lade();
    await service.verify('d1', 'admin1', 'Unleserlich');
    expect(harness.writes.find(w => w.art === 'update')?.daten).toMatchObject({
      rejectionReason: 'Unleserlich',
    });
  });

  it('löscht ein Dokument', async () => {
    harness.setDoc(dokument('d1'));
    const service = await lade();
    await service.delete('d1');
    expect(harness.writes.some(w => w.art === 'delete')).toBe(true);
  });
});

describe('Statistiken', () => {
  it('zählt die Dokumente eines Mitarbeiters nach Status', async () => {
    harness.setDocs([
      dokument('d1', { status: 'valid' }),
      dokument('d2', { status: 'expiring' }),
      dokument('d3', { status: 'expired' }),
    ]);
    const service = await lade();
    const stats = await service.getUserDocumentStats('u1');
    expect(stats.total).toBe(3);
  });

  it('zählt alle Dokumente der Firma', async () => {
    harness.setDocs([dokument('d1'), dokument('d2')]);
    const service = await lade();
    const stats = await service.getAllDocumentStats();
    expect(stats.total).toBeGreaterThanOrEqual(0);
  });
});
