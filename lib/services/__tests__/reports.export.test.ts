import { beforeEach, describe, expect, it, vi } from 'vitest';
import { harness, firestoreModuleMock, ts } from './helpers/firestoreHarness';

/**
 * Berichts-Export: PDF über die gebrandete Dokumenterzeugung, Excel/CSV über
 * den Storage. Danach wird der Bericht auf "completed" fortgeschrieben.
 */

vi.mock('@/lib/firebase', () => ({ db: {}, getDb: vi.fn(() => ({})), storage: {} }));
vi.mock('@/lib/utils/companyId', () => ({
  getCompanyIdFromAuth: vi.fn(async () => 'firmaA'),
}));

const uploadExport = vi.fn();
vi.mock('../firebaseStorage', () => ({
  firebaseStorageService: {
    uploadExport: (...a: unknown[]) => uploadExport(...a),
    uploadReport: vi.fn(async () => ({ url: 'https://storage/report.pdf' })),
    uploadFile: vi.fn(async () => ({ url: 'https://storage/report.pdf' })),
  },
}));

const generateDocument = vi.fn();
vi.mock('../documentGeneration', () => ({
  documentGenerationService: { generateDocument: (...a: unknown[]) => generateDocument(...a) },
}));

const getSettings = vi.fn();
vi.mock('../settingsService', () => ({
  settingsService: { getSettings: (...a: unknown[]) => getSettings(...a) },
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
    userId: 'u1',
    companyId: 'firmaA',
    type: 'timesheet',
    period: 'current-month',
    status: 'generating',
    createdAt: ts(new Date(2026, 6, 18)),
    ...daten,
  },
});

beforeEach(async () => {
  vi.clearAllMocks();
  harness.reset();
  const { getCompanyIdFromAuth } = await import('@/lib/utils/companyId');
  vi.mocked(getCompanyIdFromAuth).mockResolvedValue('firmaA');
  uploadExport.mockResolvedValue({ url: 'https://storage/export.csv' });
  generateDocument.mockResolvedValue({ url: 'https://storage/bericht.pdf', fileSize: 2048 });
  getSettings.mockResolvedValue({
    companyName: 'AufAbruf GmbH',
    companyLogo: 'https://storage/logo.png',
  });
});

describe('exportReport – PDF', () => {
  it('erzeugt ein gebrandetes PDF und schreibt die URL fort', async () => {
    harness.setDoc(bericht('r1'));
    const service = await lade();

    const url = await service.exportReport('r1', 'pdf');
    expect(url).toBe('https://storage/bericht.pdf');
    expect(generateDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'admin-report',
        adminReportData: expect.objectContaining({
          period: 'current-month',
          reportType: 'timesheet',
          branding: { companyName: 'AufAbruf GmbH', companyLogo: 'https://storage/logo.png' },
        }),
      })
    );

    const updates = harness.writes.filter(w => w.art === 'update');
    expect(
      updates.some(w => {
        const daten = w.daten as Record<string, unknown>;
        return daten.status === 'completed' && daten.fileUrl === 'https://storage/bericht.pdf';
      })
    ).toBe(true);
  });

  it('meldet einen Fehler der Dokumenterzeugung', async () => {
    harness.setDoc(bericht('r1'));
    generateDocument.mockRejectedValue(new Error('jsPDF kaputt'));
    const service = await lade();
    await expect(service.exportReport('r1', 'pdf')).rejects.toThrow();
  });
});

describe('exportReport – Excel und CSV', () => {
  it.each([
    ['excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['csv', 'text/csv'],
  ])('lädt %s in den Storage', async (format, mime) => {
    harness.setDoc(bericht('r1'));
    const service = await lade();

    const url = await service.exportReport('r1', format as 'excel' | 'csv');
    expect(url).toBe('https://storage/export.csv');

    const [datei, art, userId, metadaten] = uploadExport.mock.calls[0];
    expect((datei as File).type).toBe(mime);
    expect((datei as File).name).toBe(`report-r1.${format}`);
    expect(art).toBe('report');
    expect(userId).toBe('u1');
    expect(metadaten).toMatchObject({ reportId: 'r1', format });
  });

  it('meldet einen Storage-Fehler', async () => {
    harness.setDoc(bericht('r1'));
    uploadExport.mockRejectedValue(new Error('Storage verweigert'));
    const service = await lade();
    await expect(service.exportReport('r1', 'csv')).rejects.toThrow();
  });
});

describe('Export-Wrapper', () => {
  it('leitet alle benannten Exporte auf exportReport um', async () => {
    harness.setDocs([]);
    const service = await lade();
    const spy = vi.spyOn(service, 'exportReport').mockResolvedValue('https://storage/x');

    await service.exportTimeAccountReportPDF({ reportId: 'r1' }, {});
    await service.exportTimeAccountReportExcel({ reportId: 'r1' }, {});
    await service.exportTimeAccountReport({ reportId: 'r1' }, {});
    await service.exportEmployeeStatistics({ reportId: 'r1' }, {});
    await service.exportAllReportsPDF({ reportId: 'r1' }, {});
    await service.exportAllReportsExcel({ reportId: 'r1' }, {});
    await service.exportAllReports({ reportId: 'r1' }, {});

    expect(spy.mock.calls.map(c => c[1])).toEqual([
      'pdf',
      'excel',
      'csv',
      'csv',
      'pdf',
      'excel',
      'csv',
    ]);
    spy.mockRestore();
  });
});

describe('uploadReport', () => {
  it('lädt eine fertige Datei hoch und schreibt die URL fort', async () => {
    harness.setDoc(bericht('r1'));
    uploadExport.mockResolvedValue({ url: 'https://storage/manuell.pdf' });
    const service = await lade();

    const datei = new File(['x'], 'bericht.pdf', { type: 'application/pdf' });
    const url = await service.uploadReport('r1', datei);

    expect(url).toBe('https://storage/manuell.pdf');
    expect(uploadExport).toHaveBeenCalledWith(
      datei,
      'report',
      'u1',
      expect.objectContaining({ reportId: 'r1', reportType: 'timesheet' })
    );
    const updates = harness.writes.filter(w => w.art === 'update');
    expect(updates.some(w => (w.daten as Record<string, unknown>).status === 'completed')).toBe(true);
  });

  it('wirft, wenn der Bericht nicht existiert', async () => {
    harness.setDoc(null);
    const service = await lade();
    const datei = new File(['x'], 'bericht.pdf', { type: 'application/pdf' });
    await expect(service.uploadReport('weg', datei)).rejects.toThrow();
  });
});

describe('getStats', () => {
  it('zählt Berichte nach Status', async () => {
    // vier Abfragen in Reihenfolge: total, completed, generating, failed
    harness.setDocs(
      [bericht('r1'), bericht('r2')],
      [bericht('r1', { status: 'completed' })],
      [bericht('r2', { status: 'generating' })],
      []
    );
    const service = await lade();

    const stats = await service.getStats();
    expect(stats).toEqual({ total: 2, completed: 1, generating: 1, failed: 0 });
  });

  it('liefert ohne companyId Nullwerte', async () => {
    const { getCompanyIdFromAuth } = await import('@/lib/utils/companyId');
    vi.mocked(getCompanyIdFromAuth).mockResolvedValue(null);
    const service = await lade();

    await expect(service.getStats()).resolves.toEqual({
      total: 0,
      completed: 0,
      generating: 0,
      failed: 0,
    });
  });
});
