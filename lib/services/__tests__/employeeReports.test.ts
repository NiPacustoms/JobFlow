import { beforeEach, describe, expect, it, vi } from 'vitest';
import { harness, firestoreModuleMock, ts } from './helpers/firestoreHarness';

/**
 * Berichte aus Mitarbeitersicht (Arbeitszeit, Überstunden, Einsätze).
 */

vi.mock('@/lib/firebase', () => ({ db: {}, getDb: vi.fn(() => ({})) }));
vi.mock('@/lib/utils/companyId', () => ({
  getCompanyIdFromAuth: vi.fn(async () => 'firmaA'),
}));
vi.mock('firebase/firestore', () => firestoreModuleMock());

const lade = async () => (await import('../employeeReports')).employeeReportsService;

const bericht = (id: string, daten: Record<string, unknown> = {}) => ({
  id,
  data: {
    userId: 'current-user-id',
    companyId: 'firmaA',
    type: 'worktime',
    title: 'Arbeitszeit Juli',
    period: 'month',
    dateRange: { start: ts(new Date(2026, 6, 1)), end: ts(new Date(2026, 6, 31)) },
    data: {},
    status: 'completed',
    createdAt: ts(new Date(2026, 6, 31)),
    updatedAt: ts(new Date(2026, 6, 31)),
    ...daten,
  },
});

beforeEach(async () => {
  vi.clearAllMocks();
  harness.reset();
  const { getCompanyIdFromAuth } = await import('@/lib/utils/companyId');
  vi.mocked(getCompanyIdFromAuth).mockResolvedValue('firmaA');
});

describe('getAll', () => {
  it('liest die Berichte des Mitarbeiters', async () => {
    harness.setDocs([bericht('r1'), bericht('r2')]);
    const service = await lade();
    const result = await service.getAll();
    expect(result).toHaveLength(2);
    expect(result[0].dateRange.start).toBeInstanceOf(Date);
    expect(harness.hatWhere('companyId', 'firmaA')).toBe(true);
  });

  it('liefert ohne companyId eine leere Liste', async () => {
    const { getCompanyIdFromAuth } = await import('@/lib/utils/companyId');
    vi.mocked(getCompanyIdFromAuth).mockResolvedValue(null);
    const service = await lade();
    expect(await service.getAll()).toEqual([]);
  });

  it('setzt Standardwerte für unvollständige Berichte', async () => {
    harness.setDocs([
      {
        id: 'r1',
        data: {
          userId: 'current-user-id',
          type: 'worktime',
          title: 'T',
          period: 'month',
          dateRange: {},
        },
      },
    ]);
    const service = await lade();
    const [r] = await service.getAll();
    expect(r.status).toBe('completed');
    expect(r.companyId).toBe('');
    expect(r.data).toEqual({});
  });
});

describe('getById, getByType, getByPeriod', () => {
  it('liest einen Bericht anhand der ID', async () => {
    harness.setDoc(bericht('r1'));
    const service = await lade();
    expect(await service.getById('r1')).toMatchObject({ id: 'r1', title: 'Arbeitszeit Juli' });
  });

  it('liefert null für einen unbekannten Bericht', async () => {
    harness.setDoc(null);
    const service = await lade();
    expect(await service.getById('fehlt')).toBeNull();
  });

  it('filtert nach Berichtstyp', async () => {
    harness.setDocs([bericht('r1')]);
    const service = await lade();
    await service.getByType('worktime');
    expect(harness.hatWhere('type', 'worktime')).toBe(true);
  });

  it('filtert nach Zeitraum', async () => {
    harness.setDocs([bericht('r1')]);
    const service = await lade();
    await service.getByPeriod('month');
    expect(harness.hatWhere('period', 'month')).toBe(true);
  });
});

describe('generateReportData', () => {
  it.each([
    ['worktime', 'totalHours'],
    ['overtime', 'totalOvertime'],
  ] as const)('liefert eine Struktur für %s', async (typ, feld) => {
    const service = await lade();
    const daten = await service.generateReportData({ type: typ, period: 'month' } as never);
    expect(daten).toHaveProperty(feld);
  });

  it('liefert für unbekannte Typen eine leere Struktur', async () => {
    const service = await lade();
    const daten = await service.generateReportData({ type: 'unbekannt', period: 'month' } as never);
    expect(daten).toBeTruthy();
  });
});

describe('Anlegen, Löschen, Statistik', () => {
  it('legt einen Bericht an', async () => {
    harness.setDoc({ id: 'current-user-id', data: { companyId: 'firmaA' } });
    const service = await lade();
    const id = await service.generateReport({
      type: 'worktime',
      period: 'month',
      title: 'Juli',
      dateRange: { start: new Date(2026, 6, 1), end: new Date(2026, 6, 31) },
    } as never);
    expect(id).toBe('neu1');
  });

  it('löscht einen Bericht', async () => {
    harness.setDoc(bericht('r1'));
    const service = await lade();
    await service.deleteReport('r1');
    expect(harness.writes.some(w => w.art === 'delete')).toBe(true);
  });

  it('wirft beim Löschen eines unbekannten Berichts', async () => {
    harness.setDoc(null);
    const service = await lade();
    await expect(service.deleteReport('fehlt')).rejects.toThrow(/not found/i);
  });

  it('liefert eine Statistik über die Berichte', async () => {
    harness.setDocs([
      bericht('r1', { type: 'worktime', status: 'completed' }),
      bericht('r2', { type: 'overtime', status: 'completed' }),
      bericht('r3', { type: 'worktime', status: 'pending' }),
    ]);
    const service = await lade();
    const stats = await service.getStats();
    expect(stats.totalReports).toBe(3);
    expect(stats.reportsByType.worktime).toBe(2);
    expect(stats.reportsByStatus.completed).toBe(2);
  });

  it('liefert ohne companyId eine leere Statistik', async () => {
    const { getCompanyIdFromAuth } = await import('@/lib/utils/companyId');
    vi.mocked(getCompanyIdFromAuth).mockResolvedValue(null);
    const service = await lade();
    const stats = await service.getStats();
    expect(stats.totalReports).toBe(0);
    expect(stats.lastGenerated).toBeNull();
  });

  it('plant einen Bericht ein', async () => {
    harness.setDoc({ id: 'current-user-id', data: { companyId: 'firmaA' } });
    const service = await lade();
    const id = await service.scheduleReport({
      type: 'worktime',
      period: 'month',
      title: 'Geplant',
      dateRange: { start: new Date(2026, 6, 1), end: new Date(2026, 6, 31) },
      schedule: new Date(2026, 7, 1),
    } as never);
    expect(id).toBeTruthy();
  });
});
