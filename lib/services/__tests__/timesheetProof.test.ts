import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tagesnachweis-PDF der Einrichtung (Bestätigung geleisteter Dienste):
 * Erzeugung mit echtem jsPDF, Signatur-Einbettung und Storage-Upload.
 */

const uploadFile = vi.fn();
vi.mock('@/lib/services/firebaseStorage', () => ({
  firebaseStorageService: { uploadFile: (...a: unknown[]) => uploadFile(...a) },
}));

// Der gebrandete Briefkopf lädt Logos per fetch – hier durch schlanke Stubs
// ersetzt, damit der Test die Nachweis-Logik prüft, nicht das Layout.
vi.mock('@/lib/services/pdf/brandedPdf', () => ({
  drawLetterhead: vi.fn(async () => 40),
  drawFooters: vi.fn(),
  sectionTitle: vi.fn((_doc: unknown, y: number) => y + 6),
  kvLine: vi.fn((_doc: unknown, y: number) => y + 6),
  formatDateDE: vi.fn((d: Date) => d.toLocaleDateString('de-DE')),
  formatDateTimeDE: vi.fn((d: Date) => d.toLocaleString('de-DE')),
  formatHoursDE: vi.fn((h: number) => `${h} h`),
  PDF_COLORS: { gray: [1, 1, 1], grayLight: [2, 2, 2], ink: [0, 0, 0] },
  PDF_MARGIN: 20,
}));

import { timesheetProofService } from '../timesheetProof';
import { kvLine } from '@/lib/services/pdf/brandedPdf';

// 1×1 transparentes PNG für die Signatur-Einbettung
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const fetchMock = vi.fn();

const eingabe = (overrides: Record<string, unknown> = {}) => ({
  timesheet: {
    id: 't1',
    userId: 'u1',
    date: new Date(2026, 6, 20),
    startTime: '06:00',
    endTime: '14:00',
    breakMinutes: 30,
    totalHours: 7.5,
    ...overrides,
  },
  employee: { id: 'u1', name: 'Anna Muster', email: 'anna@aufabruf.eu' },
  facility: { id: 'f1', name: 'Haus Sonnenschein', address: 'Hauptstr. 1' },
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  const bytes = Uint8Array.from(atob(PNG_BASE64), c => c.charCodeAt(0));
  fetchMock.mockResolvedValue({ blob: async () => new Blob([bytes], { type: 'image/png' }) });
  uploadFile.mockResolvedValue({
    url: 'https://storage.example/proof.pdf',
    path: 'proofs/timesheets/u1/t1.pdf',
  });
});

describe('generateDailyProofPDF', () => {
  it('erzeugt den Nachweis und lädt ihn in den Storage', async () => {
    const ergebnis = await timesheetProofService.generateDailyProofPDF(eingabe() as never);

    expect(ergebnis).toEqual({
      url: 'https://storage.example/proof.pdf',
      path: 'proofs/timesheets/u1/t1.pdf',
    });
    const [datei, pfad, metadaten] = uploadFile.mock.calls[0];
    expect((datei as File).name).toBe('tagesnachweis_t1.pdf');
    expect((datei as File).type).toBe('application/pdf');
    expect(pfad).toBe('proofs/timesheets/u1/t1.pdf');
    expect(metadaten).toMatchObject({ kind: 'timesheet-daily-proof', timesheetId: 't1' });
  });

  it('bettet eine vorhandene Einrichtungs-Signatur ein', async () => {
    await timesheetProofService.generateDailyProofPDF(
      eingabe({
        facilitySignatureUrl: 'https://storage.example/signatur.png',
        facilitySignedAt: new Date(2026, 6, 20, 14, 30),
        facilitySignerName: 'Frau Meier',
        facilityConfirmationStatus: 'performed',
        notes: 'Ruhiger Dienst,\nkeine Vorkommnisse.',
      }) as never
    );
    expect(fetchMock).toHaveBeenCalledWith('https://storage.example/signatur.png');
    expect(uploadFile).toHaveBeenCalled();
  });

  it('fällt bei nicht ladbarer Signatur auf einen Texthinweis zurück', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    await timesheetProofService.generateDailyProofPDF(
      eingabe({ facilitySignatureUrl: 'https://storage.example/kaputt.png' }) as never
    );

    const kvAufrufe = vi.mocked(kvLine).mock.calls.map(c => c[3]);
    expect(kvAufrufe).toContain('[Bild konnte nicht geladen werden]');
    expect(uploadFile).toHaveBeenCalled();
  });

  it('zeigt ohne Signatur und Status Platzhalter an', async () => {
    await timesheetProofService.generateDailyProofPDF(eingabe() as never);

    const kvAufrufe = vi.mocked(kvLine).mock.calls;
    // Status '–' und Unterschrift '–'
    expect(kvAufrufe.filter(c => c[3] === '–').length).toBeGreaterThanOrEqual(2);
  });

  it('übersetzt die Bestätigungsstatus', async () => {
    for (const [status, text] of [
      ['aborted', 'Abgebrochen'],
      ['no-show', 'Nicht angetreten'],
    ] as const) {
      vi.mocked(kvLine).mockClear();
      await timesheetProofService.generateDailyProofPDF(
        eingabe({ facilityConfirmationStatus: status }) as never
      );
      const kvAufrufe = vi.mocked(kvLine).mock.calls.map(c => c[3]);
      expect(kvAufrufe).toContain(text);
    }
  });
});
