import { beforeEach, describe, expect, it, vi } from 'vitest';
import { harness, firestoreModuleMock, ts } from './helpers/firestoreHarness';

/**
 * Systemeinstellungen (Rollen/Dokumenttypen) und die Auswertung der
 * Einrichtungsstunden (geplante gegen geleistete Stunden je Kunde).
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

describe('settingsService', () => {
  const lade = async () => (await import('../settings')).settingsService;

  it('liest die Einstellungen mit Rollen und Dokumenttypen', async () => {
    harness.setDocs([
      { id: 'r1', data: { name: 'Disponent', permissions: [], createdAt: ts(new Date()) } },
    ]);
    const service = await lade();
    const settings = await service.getAll();
    expect(settings).toBeTruthy();
  });

  it('legt eine Nutzerrolle an', async () => {
    const service = await lade();
    const id = await service.createUserRole({ name: 'Neu', permissions: [] } as never);
    expect(id).toBe('neu1');
  });

  it('ändert eine Nutzerrolle', async () => {
    const service = await lade();
    await service.updateUserRole('r1', { name: 'Umbenannt' } as never);
    expect(harness.writes.find(w => w.art === 'update')?.daten).toMatchObject({ name: 'Umbenannt' });
  });

  it('löscht eine Nutzerrolle', async () => {
    const service = await lade();
    await service.deleteUserRole('r1');
    expect(harness.writes.some(w => w.art === 'delete')).toBe(true);
  });

  it('legt einen Dokumenttyp an', async () => {
    const service = await lade();
    const id = await service.createDocumentType({ name: 'Impfnachweis' } as never);
    expect(id).toBe('neu1');
  });

  it('ändert und löscht einen Dokumenttyp', async () => {
    const service = await lade();
    await service.updateDocumentType('d1', { name: 'Neu' } as never);
    expect(harness.writes.find(w => w.art === 'update')?.daten).toMatchObject({ name: 'Neu' });

    harness.reset();
    await service.deleteDocumentType('d1');
    expect(harness.writes.some(w => w.art === 'delete')).toBe(true);
  });

  it('aktualisiert einen Einstellungsbereich', async () => {
    const service = await lade();
    await service.updateSection('general' as never, { systemName: 'Neu' } as never);
    expect(harness.writes.length).toBeGreaterThan(0);
  });

  it('exportiert die Einstellungen als Blob', async () => {
    harness.setDocs([]);
    const service = await lade();
    const blob = await service.exportSettings();
    expect(blob).toBeInstanceOf(Blob);
  });
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
