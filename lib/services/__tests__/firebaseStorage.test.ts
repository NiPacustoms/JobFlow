import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Datei-Uploads (Signaturen, generierte PDFs, Exporte).
 * Alle Uploads laufen unter dem Präfix 'exports/' – genau dafür wurde die
 * Storage-Regel ergänzt. Der Pfad ist damit sicherheitsrelevant.
 */

const uploadBytes = vi.fn();
const getDownloadURL = vi.fn();
const deleteObject = vi.fn();
const listAll = vi.fn();
const getMetadata = vi.fn();
let letzteRef: { pfad: string } | null = null;

vi.mock('@/lib/firebase', () => ({ getStorage: vi.fn(() => ({})) }));
vi.mock('firebase/storage', () => ({
  ref: vi.fn((_storage: unknown, pfad: string) => {
    letzteRef = { pfad };
    return { fullPath: pfad, name: pfad.split('/').pop() };
  }),
  uploadBytes: (...a: unknown[]) => uploadBytes(...a),
  getDownloadURL: (...a: unknown[]) => getDownloadURL(...a),
  deleteObject: (...a: unknown[]) => deleteObject(...a),
  listAll: (...a: unknown[]) => listAll(...a),
  getMetadata: (...a: unknown[]) => getMetadata(...a),
}));

const lade = async () => (await import('../firebaseStorage')).firebaseStorageService;

const datei = (name = 'test.pdf', type = 'application/pdf') =>
  new File([new Uint8Array([1, 2, 3])], name, { type });

beforeEach(() => {
  vi.clearAllMocks();
  letzteRef = null;
  uploadBytes.mockResolvedValue({
    ref: { fullPath: 'exports/test.pdf' },
    metadata: { size: 3, contentType: 'application/pdf' },
  });
  getDownloadURL.mockResolvedValue('https://storage/test.pdf');
  listAll.mockResolvedValue({ items: [], prefixes: [] });
  getMetadata.mockResolvedValue({
    name: 'test.pdf',
    size: 3,
    contentType: 'application/pdf',
    timeCreated: new Date(2026, 6, 20).toISOString(),
    fullPath: 'exports/test.pdf',
  });
});

describe('uploadFile', () => {
  it('lädt unter dem Präfix exports/ hoch', async () => {
    const service = await lade();
    await service.uploadFile(datei(), 'signatures/ts1/2026-07-20.png');
    expect(letzteRef?.pfad).toBe('exports/signatures/ts1/2026-07-20.png');
  });

  it('liefert URL, Pfad, Größe und Typ zurück', async () => {
    const service = await lade();
    const result = await service.uploadFile(datei(), 'documents/generated/x.pdf');
    expect(result).toMatchObject({
      url: 'https://storage/test.pdf',
      path: 'exports/test.pdf',
      size: 3,
      contentType: 'application/pdf',
    });
    expect(result.uploadedAt).toBeInstanceOf(Date);
  });

  it('reicht Metadaten an Storage durch', async () => {
    const service = await lade();
    await service.uploadFile(datei(), 'x.pdf', { kind: 'signature' });
    expect(uploadBytes.mock.calls[0][2]).toMatchObject({ customMetadata: { kind: 'signature' } });
  });

  it('fällt bei fehlendem contentType auf den Dateityp zurück', async () => {
    uploadBytes.mockResolvedValue({
      ref: { fullPath: 'exports/x.png' },
      metadata: { size: 3, contentType: undefined },
    });
    const service = await lade();
    const result = await service.uploadFile(datei('x.png', 'image/png'), 'x.png');
    expect(result.contentType).toBe('image/png');
  });

  it('reicht einen Upload-Fehler weiter', async () => {
    uploadBytes.mockRejectedValue(new Error('Storage verweigert'));
    const service = await lade();
    await expect(service.uploadFile(datei(), 'x.pdf')).rejects.toThrow('Storage verweigert');
  });
});

describe('Spezialisierte Uploads', () => {
  it('lädt einen Zeiterfassungs-Export hoch und vermerkt den Zeitraum', async () => {
    const service = await lade();
    const result = await service.uploadTimesheetExport(datei('nachweis.pdf'), 'u1', {
      year: 2026,
      month: 7,
    });
    expect(result.url).toBeTruthy();
    expect(letzteRef?.pfad.startsWith('exports/')).toBe(true);
    expect(uploadBytes.mock.calls[0][2]).toMatchObject({
      customMetadata: expect.objectContaining({ period: '2026-07', exportType: 'timesheet' }),
    });
  });

  it('füllt einstellige Monate im Zeitraum auf', async () => {
    const service = await lade();
    await service.uploadPeriodExport(datei('zeitraum.csv', 'text/csv'), 'u1', {
      year: 2026,
      month: 3,
    });
    expect(uploadBytes.mock.calls[0][2]).toMatchObject({
      customMetadata: expect.objectContaining({ period: '2026-03', exportType: 'export' }),
    });
  });

  it('lädt einen Bericht mit Berichtstyp hoch', async () => {
    const service = await lade();
    const result = await service.uploadReport(datei('bericht.pdf'), 'timeAccount', 'u1');
    expect(result.url).toBeTruthy();
    expect(uploadBytes.mock.calls[0][2]).toMatchObject({
      customMetadata: expect.objectContaining({ reportType: 'timeAccount', exportType: 'report' }),
    });
  });
});

describe('Lesen und Löschen', () => {
  it('liefert eine Download-URL', async () => {
    const service = await lade();
    expect(await service.getDownloadUrl('exports/x.pdf')).toBe('https://storage/test.pdf');
  });

  it('liest Datei-Metadaten', async () => {
    const service = await lade();
    const meta = await service.getFileMetadata('exports/x.pdf');
    expect(meta).toMatchObject({ name: 'test.pdf', size: 3, contentType: 'application/pdf' });
    expect(meta?.uploadedAt).toBeInstanceOf(Date);
  });

  it('liefert null, wenn die Datei nicht existiert', async () => {
    getMetadata.mockRejectedValue(new Error('not found'));
    const service = await lade();
    expect(await service.getFileMetadata('exports/fehlt.pdf')).toBeNull();
  });

  it('listet die Exporte eines Nutzers', async () => {
    listAll.mockResolvedValue({
      items: [{ fullPath: 'exports/u1/a.pdf', name: 'a.pdf' }],
      prefixes: [],
    });
    const service = await lade();
    const exporte = await service.getUserExports('u1');
    expect(Array.isArray(exporte)).toBe(true);
  });

  it('listet alle Exporte über alle Nutzerordner', async () => {
    listAll.mockResolvedValue({ items: [], prefixes: [] });
    const service = await lade();
    expect(await service.getAllExports()).toEqual([]);
  });

  it('überspringt Ordner, die sich nicht lesen lassen', async () => {
    listAll
      .mockResolvedValueOnce({ items: [], prefixes: [{ name: 'u1' }] })
      .mockRejectedValueOnce(new Error('kein Zugriff'));
    const service = await lade();
    await expect(service.getAllExports()).resolves.toEqual([]);
  });

  it('löscht einen Export', async () => {
    deleteObject.mockResolvedValue(undefined);
    const service = await lade();
    await service.deleteExport('exports/u1/a.pdf');
    expect(deleteObject).toHaveBeenCalled();
  });
});

describe('generateFileName', () => {
  it('hängt einen Zeitstempel an und behält die Endung', async () => {
    const service = await lade();
    const name = service.generateFileName('Stundenliste Juli.pdf');
    expect(name).toMatch(/^Stundenliste Juli_.+\.pdf$/);
    // Doppelpunkte und Punkte im Zeitstempel sind für Storage-Pfade ersetzt
    expect(name.split('_')[1]).not.toContain(':');
  });

  it('stellt ein Präfix voran', async () => {
    const service = await lade();
    expect(service.generateFileName('zeugnis.pdf', 'doc')).toMatch(/^doc_zeugnis_.+\.pdf$/);
  });

  it('kommt mit mehreren Punkten im Namen zurecht', async () => {
    const service = await lade();
    const name = service.generateFileName('bericht.2026.07.csv');
    expect(name.endsWith('.csv')).toBe(true);
  });
});

describe('validateFile', () => {
  it('akzeptiert die erlaubten Dateitypen', async () => {
    const service = await lade();
    for (const typ of [
      'application/pdf',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
      'application/json',
    ]) {
      expect(service.validateFile(datei('x', typ))).toEqual({ valid: true });
    }
  });

  it('lehnt nicht erlaubte Dateitypen ab', async () => {
    const service = await lade();
    const ergebnis = service.validateFile(datei('bild.png', 'image/png'));
    expect(ergebnis.valid).toBe(false);
    expect(ergebnis.error).toContain('Dateityp nicht unterstützt');
  });

  it('lehnt zu große Dateien mit Angabe der Grenze ab', async () => {
    const service = await lade();
    const gross = new File([new Uint8Array(2048)], 'gross.pdf', { type: 'application/pdf' });
    const ergebnis = service.validateFile(gross, 1024);
    expect(ergebnis.valid).toBe(false);
    expect(ergebnis.error).toContain('zu groß');
  });
});

describe('cleanupOldExports', () => {
  it('löscht nur Exporte älter als die Frist und zählt sie', async () => {
    const service = await lade();
    const alt = new Date();
    alt.setDate(alt.getDate() - 60);
    const neu = new Date();

    const spy = vi.spyOn(service, 'getAllExports').mockResolvedValue([
      { id: 'exports/u1/alt.pdf', name: 'alt.pdf', uploadedAt: alt } as never,
      { id: 'exports/u1/neu.pdf', name: 'neu.pdf', uploadedAt: neu } as never,
    ]);
    const loeschen = vi.spyOn(service, 'deleteExport').mockResolvedValue(undefined);

    await expect(service.cleanupOldExports(30)).resolves.toBe(1);
    expect(loeschen).toHaveBeenCalledWith('exports/u1/alt.pdf');
    spy.mockRestore();
    loeschen.mockRestore();
  });

  it('zählt Exporte nicht mit, deren Löschung scheitert', async () => {
    const service = await lade();
    const alt = new Date();
    alt.setDate(alt.getDate() - 60);

    const spy = vi.spyOn(service, 'getAllExports').mockResolvedValue([
      { id: 'exports/u1/alt.pdf', name: 'alt.pdf', uploadedAt: alt } as never,
    ]);
    const loeschen = vi
      .spyOn(service, 'deleteExport')
      .mockRejectedValue(new Error('Rules verweigern'));

    await expect(service.cleanupOldExports(30)).resolves.toBe(0);
    spy.mockRestore();
    loeschen.mockRestore();
  });

  it('reicht Fehler beim Auflisten weiter', async () => {
    const service = await lade();
    const spy = vi.spyOn(service, 'getAllExports').mockRejectedValue(new Error('kein Zugriff'));
    await expect(service.cleanupOldExports()).rejects.toThrow('kein Zugriff');
    spy.mockRestore();
  });
});
