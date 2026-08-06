import { beforeEach, describe, expect, it, vi } from 'vitest';
import { harness, firestoreModuleMock, ts } from './helpers/firestoreHarness';

/**
 * Berichtsverwaltung: Lesen, Anlegen, Export mit Mandantenprüfung, Löschen.
 * Der Export prüft die companyId – ein Bericht einer fremden Firma darf nie
 * herausgegeben werden.
 */

vi.mock('@/lib/firebase', () => ({ db: {}, getDb: vi.fn(() => ({})), storage: {} }));
vi.mock('@/lib/utils/companyId', () => ({
  getCompanyIdFromAuth: vi.fn(async () => 'firmaA'),
}));
const uploadReport = vi.fn(async () => ({ url: 'https://storage/report.pdf' }));
vi.mock('../firebaseStorage', () => ({
  firebaseStorageService: {
    uploadReport: (...a: unknown[]) => uploadReport(...a),
    uploadFile: (...a: unknown[]) => uploadReport(...a),
  },
}));
vi.mock('../timesheets', () => ({
  timesheetService: { getTimesheetsByDateRange: vi.fn(async () => []) },
}));
vi.mock('../users', () => ({
  userService: { getById: vi.fn(async () => null), getAll: vi.fn(async () => ({ data: [] })) },
}));
vi.mock('../assignments', () => ({
  assignmentService: { getAll: vi.fn(async () => ({ data: [] })) },
}));
vi.mock('../shifts', () => ({ shiftService: { getById: vi.fn(async () => null) } }));
vi.mock('../facilities', () => ({ facilityService: { getById: vi.fn(async () => null) } }));
vi.mock('firebase/firestore', () => firestoreModuleMock());

const lade = async () => (await import('../reports')).reportService;

const bericht = (id: string, daten: Record<string, unknown> = {}) => ({
  id,
  data: {
    userId: 'current-user-id',
    companyId: 'firmaA',
    type: 'timesheet',
    title: 'Stundenliste Juli',
    period: 'month',
    format: 'pdf',
    status: 'completed',
    createdAt: ts(new Date(2026, 6, 31)),
    ...daten,
  },
});

beforeEach(async () => {
  vi.clearAllMocks();
  harness.reset();
  const { getCompanyIdFromAuth } = await import('@/lib/utils/companyId');
  vi.mocked(getCompanyIdFromAuth).mockResolvedValue('firmaA');
  uploadReport.mockResolvedValue({ url: 'https://storage/report.pdf' });
});

describe('getAll und getById', () => {
  it('liest die Berichte der eigenen Firma', async () => {
    harness.setDocs([bericht('r1'), bericht('r2')]);
    const service = await lade();
    const result = await service.getAll();
    expect(result).toHaveLength(2);
    expect(harness.hatWhere('companyId', 'firmaA')).toBe(true);
  });

  it('liefert ohne companyId eine leere Liste', async () => {
    const { getCompanyIdFromAuth } = await import('@/lib/utils/companyId');
    vi.mocked(getCompanyIdFromAuth).mockResolvedValue(null);
    const service = await lade();
    expect(await service.getAll()).toEqual([]);
  });

  it('liest einen Bericht anhand der ID', async () => {
    harness.setDoc(bericht('r1'));
    const service = await lade();
    expect(await service.getById('r1')).toMatchObject({ id: 'r1', title: 'Stundenliste Juli' });
  });

  it('liefert null für einen unbekannten Bericht', async () => {
    harness.setDoc(null);
    const service = await lade();
    expect(await service.getById('fehlt')).toBeNull();
  });
});

describe('exportReport – Mandantenprüfung', () => {
  it('verweigert den Export eines fremden Berichts', async () => {
    harness.setDoc(bericht('r1', { companyId: 'firmaB' }));
    const service = await lade();
    await expect(service.exportReport('r1', 'pdf')).rejects.toThrow();
  });

  it('wirft, wenn der Bericht nicht existiert', async () => {
    harness.setDoc(null);
    const service = await lade();
    await expect(service.exportReport('fehlt', 'pdf')).rejects.toThrow();
  });

  it('wirft ohne companyId', async () => {
    const { getCompanyIdFromAuth } = await import('@/lib/utils/companyId');
    vi.mocked(getCompanyIdFromAuth).mockResolvedValue(null);
    const service = await lade();
    await expect(service.exportReport('r1', 'pdf')).rejects.toThrow();
  });
});

describe('generateReport und delete', () => {
  it('legt einen Bericht an', async () => {
    const service = await lade();
    const id = await service.generateReport({
      type: 'timesheet',
      title: 'Neu',
      period: 'month',
      format: 'pdf',
    } as never);
    expect(id).toBeTruthy();
    expect(harness.writes.some(w => w.art === 'add')).toBe(true);
  });

  it('löscht einen Bericht der eigenen Firma', async () => {
    harness.setDoc(bericht('r1'));
    const service = await lade();
    await service.delete('r1');
    expect(harness.writes.some(w => w.art === 'delete')).toBe(true);
  });

  it('verweigert das Löschen eines fremden Berichts', async () => {
    harness.setDoc(bericht('r1', { companyId: 'firmaB' }));
    const service = await lade();
    await expect(service.delete('r1')).rejects.toThrow();
  });
});

describe('getStats', () => {
  it('liefert eine Statistik über die Berichte', async () => {
    harness.setDocs([
      bericht('r1', { status: 'completed' }),
      bericht('r2', { status: 'pending' }),
    ]);
    const service = await lade();
    const stats = await service.getStats();
    expect(stats).toBeTruthy();
  });
});
