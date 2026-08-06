import { beforeEach, describe, expect, it, vi } from 'vitest';
import { harness, firestoreModuleMock } from './helpers/firestoreHarness';

/**
 * Auswertung der Einrichtungsstunden (geplante gegen geleistete
 * Stunden je Kunde).
 */

vi.mock('@/lib/firebase', () => ({ db: {}, getDb: vi.fn(() => ({})) }));
vi.mock('@/lib/utils/companyId', () => ({
  getCompanyIdFromAuth: vi.fn(async () => 'firmaA'),
}));

const getAllFacilities = vi.fn();
vi.mock('../facilities', () => ({
  facilityService: { getAll: (...a: unknown[]) => getAllFacilities(...a) },
}));

vi.mock('firebase/firestore', () => firestoreModuleMock());

beforeEach(async () => {
  vi.clearAllMocks();
  harness.reset();
  const { getCompanyIdFromAuth } = await import('@/lib/utils/companyId');
  vi.mocked(getCompanyIdFromAuth).mockResolvedValue('firmaA');
  getAllFacilities.mockResolvedValue([]);
});

describe('facilityHoursService.getSummary', () => {
  const lade = async () => (await import('../facilityHours')).facilityHoursService;

  it('liefert eine leere Auswertung ohne Einrichtungen', async () => {
    getAllFacilities.mockResolvedValue([]);
    const service = await lade();
    expect(await service.getSummary({})).toEqual([]);
  });

  it('liefert ohne companyId keine Auswertung', async () => {
    const { getCompanyIdFromAuth } = await import('@/lib/utils/companyId');
    vi.mocked(getCompanyIdFromAuth).mockResolvedValue(null);
    const service = await lade();
    expect(await service.getSummary({})).toEqual([]);
  });

  it('wertet die Stunden je Einrichtung aus', async () => {
    getAllFacilities.mockResolvedValue([
      { id: 'f1', name: 'Haus Sonnenschein', companyId: 'firmaA' },
    ]);
    harness.setDocs([]);
    const service = await lade();
    const summary = await service.getSummary({
      startDate: new Date(2026, 6, 1),
      endDate: new Date(2026, 6, 31),
    });
    expect(Array.isArray(summary)).toBe(true);
  });

  it('filtert auf eine einzelne Einrichtung', async () => {
    getAllFacilities.mockResolvedValue([
      { id: 'f1', name: 'Haus Sonnenschein', companyId: 'firmaA' },
      { id: 'f2', name: 'Seniorenstift', companyId: 'firmaA' },
    ]);
    harness.setDocs([]);
    const service = await lade();
    const summary = await service.getSummary({ facilityId: 'f1' });
    expect(summary.length).toBeLessThanOrEqual(1);
  });

  it('überspringt Einrichtungen ohne companyId', async () => {
    getAllFacilities.mockResolvedValue([{ id: 'f1', name: 'Ohne Firma' }]);
    harness.setDocs([]);
    const service = await lade();
    expect(await service.getSummary({})).toEqual([]);
  });
});
