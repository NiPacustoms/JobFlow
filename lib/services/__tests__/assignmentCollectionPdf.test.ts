import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PDFDocument } from 'pdf-lib';

/**
 * Sammel-PDF der Einsatzmitteilungen: je Einsatz eine gebrandete Seite mit
 * der erfassten Zeit, dahinter die Original-Einsatzmitteilung (pdf-lib, echt).
 */

const getAssignmentById = vi.fn();
const getShiftById = vi.fn();
const getUserById = vi.fn();
const getFacilityById = vi.fn();
const getByUserAndDateRange = vi.fn();

vi.mock('../assignments', () => ({
  assignmentService: { getById: (...a: unknown[]) => getAssignmentById(...a) },
}));
vi.mock('../shifts', () => ({
  shiftService: { getById: (...a: unknown[]) => getShiftById(...a) },
}));
vi.mock('../users', () => ({
  userService: { getById: (...a: unknown[]) => getUserById(...a) },
}));
vi.mock('../facilities', () => ({
  facilityService: { getById: (...a: unknown[]) => getFacilityById(...a) },
}));
vi.mock('../timesheets', () => ({
  timesheetService: { getByUserAndDateRange: (...a: unknown[]) => getByUserAndDateRange(...a) },
}));
vi.mock('@/lib/logging', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { buildAssignmentCollectionPdf, downloadCollectionPdf } from '../assignmentCollectionPdf';

const fetchMock = vi.fn();

/** Echte Quell-PDF mit n Seiten erzeugen (als Einsatzmitteilung). */
async function quellPdf(seiten: number): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < seiten; i++) doc.addPage([595, 842]);
  const bytes = await doc.save();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function seitenzahl(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPageCount();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  // Logo nicht verfügbar → Text-Briefkopf
  fetchMock.mockImplementation(async (url: string) => {
    if (url === '/company-logo.png') return { ok: false };
    return { ok: true, arrayBuffer: async () => quellPdf(2) };
  });
  getAssignmentById.mockResolvedValue({ id: 'a1', userId: 'u1', shiftId: 's1' });
  getShiftById.mockResolvedValue({ id: 's1', date: '2026-07-20', facilityId: 'f1' });
  getUserById.mockResolvedValue({ id: 'u1', displayName: 'Anna Muster', email: 'anna@aufabruf.eu' });
  getFacilityById.mockResolvedValue({ id: 'f1', name: 'Haus Sonnenschein' });
  getByUserAndDateRange.mockResolvedValue([
    { startTime: '06:00', endTime: '14:00', totalHours: 7.5, date: new Date(2026, 6, 20) },
  ]);
});

describe('buildAssignmentCollectionPdf', () => {
  it('verweigert die Erstellung ohne Einsätze', async () => {
    await expect(buildAssignmentCollectionPdf({ assignments: [] })).rejects.toThrow(
      'Keine Einsätze'
    );
  });

  it('erzeugt je Einsatz eine Zeitseite plus die Einsatzmitteilung', async () => {
    const bytes = await buildAssignmentCollectionPdf({
      assignments: [{ id: 'a1', userId: 'u1', pdfUrl: 'https://storage.example/a1.pdf' }],
    });
    // 1 gebrandete Seite + 2 Seiten aus der Einsatzmitteilung
    await expect(seitenzahl(bytes)).resolves.toBe(3);
    expect(fetchMock).toHaveBeenCalledWith('https://storage.example/a1.pdf', { mode: 'cors' });
  });

  it('überspringt nicht mehr vorhandene Einsätze', async () => {
    getAssignmentById.mockImplementation(async (id: string) =>
      id === 'weg' ? null : { id, userId: 'u1', shiftId: 's1' }
    );
    const bytes = await buildAssignmentCollectionPdf({
      assignments: [
        { id: 'weg', userId: 'u1', pdfUrl: 'https://storage.example/weg.pdf' },
        { id: 'a1', userId: 'u1', pdfUrl: 'https://storage.example/a1.pdf' },
      ],
    });
    await expect(seitenzahl(bytes)).resolves.toBe(3);
  });

  it('fügt eine Hinweisseite ein, wenn die Einsatzmitteilung nicht ladbar ist', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/company-logo.png') return { ok: false };
      return { ok: false, status: 404 };
    });
    const bytes = await buildAssignmentCollectionPdf({
      assignments: [{ id: 'a1', userId: 'u1', pdfUrl: 'https://storage.example/kaputt.pdf' }],
    });
    // Zeitseite + Fallback-Seite
    await expect(seitenzahl(bytes)).resolves.toBe(2);
  });

  it('rendert auch ohne Zeiterfassung und bei Ladefehlern der Stammdaten', async () => {
    getByUserAndDateRange.mockResolvedValue([]);
    getUserById.mockRejectedValue(new Error('kein Zugriff'));
    const bytes = await buildAssignmentCollectionPdf({
      assignments: [{ id: 'a1', userId: 'u1', pdfUrl: 'https://storage.example/a1.pdf' }],
    });
    await expect(seitenzahl(bytes)).resolves.toBe(3);
  });

  it('nutzt die E-Mail, wenn kein Anzeigename vorhanden ist', async () => {
    getUserById.mockResolvedValue({ id: 'u1', email: 'anna@aufabruf.eu' });
    const bytes = await buildAssignmentCollectionPdf({
      assignments: [{ id: 'a1', userId: 'u1', pdfUrl: 'https://storage.example/a1.pdf' }],
    });
    await expect(seitenzahl(bytes)).resolves.toBe(3);
  });
});

describe('downloadCollectionPdf', () => {
  it('löst den Browser-Download mit Standarddateinamen aus', async () => {
    const createObjectURL = vi.fn(() => 'blob:sammlung');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true });

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    downloadCollectionPdf(new Uint8Array([1, 2, 3]));

    expect(createObjectURL).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:sammlung');
    clickSpy.mockRestore();
  });

  it('übernimmt einen expliziten Dateinamen', () => {
    const createObjectURL = vi.fn(() => 'blob:sammlung');
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });

    let angeklickt: HTMLAnchorElement | null = null;
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        angeklickt = this;
      });
    downloadCollectionPdf(new Uint8Array([1]), 'Sammlung_Juli.pdf');

    expect(angeklickt?.download).toBe('Sammlung_Juli.pdf');
    clickSpy.mockRestore();
  });
});
