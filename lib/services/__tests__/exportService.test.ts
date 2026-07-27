import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * CSV-/Excel-Export der Auswertungen (Stundenlisten für Kunden und Lohnbüro).
 * Kernanforderung: korrektes Escaping – ein Semikolon oder Anführungszeichen im
 * Einrichtungsnamen darf die Spalten nicht verschieben.
 */

import { ExportService } from '../exportService';

const abgefangeneBlobs: Blob[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  abgefangeneBlobs.length = 0;
  Object.defineProperty(URL, 'createObjectURL', {
    value: vi.fn((blob: Blob) => {
      abgefangeneBlobs.push(blob);
      return 'blob:export';
    }),
    configurable: true,
  });
  Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
});

// jsdom-Blobs haben kein text(); über FileReader lesen.
const blobText = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });

describe('exportToCSV', () => {
  it('erzeugt eine CSV mit Kopfzeile und Datenzeilen', async () => {
    await ExportService.exportToCSV([
      { Name: 'Anna', Stunden: 8 },
      { Name: 'Bea', Stunden: 6.5 },
    ]);
    expect(abgefangeneBlobs).toHaveLength(1);
    const text = await blobText(abgefangeneBlobs[0]);
    expect(text).toContain('"Name"');
    expect(text).toContain('"Anna"');
    expect(text).toContain('"6.5"');
  });

  it('lässt die Kopfzeile auf Wunsch weg', async () => {
    await ExportService.exportToCSV([{ Name: 'Anna' }], { includeHeaders: false });
    const text = await blobText(abgefangeneBlobs[0]);
    expect(text).not.toContain('"Name"\n');
    expect(text).toContain('"Anna"');
  });

  it('escapet Anführungszeichen im Inhalt', async () => {
    await ExportService.exportToCSV([{ Name: 'Haus "Sonnenschein", Herten' }]);
    const text = await blobText(abgefangeneBlobs[0]);
    expect(text).toContain('""Sonnenschein""');
  });

  it('serialisiert Objekte als JSON und leere Werte als Leerstring', async () => {
    await ExportService.exportToCSV([{ Name: 'Anna', Detail: { a: 1 }, Leer: null }]);
    const text = await blobText(abgefangeneBlobs[0]);
    // Objekt landet als JSON, null als leere Zelle
    expect(text).toContain('{');
    const datenzeile = text.trim().split('\n')[1];
    expect(datenzeile.endsWith(',')).toBe(true);
  });

  it('wirft bei leeren Daten', async () => {
    await expect(ExportService.exportToCSV([])).rejects.toThrow(/Keine Daten/);
  });

  it('respektiert ein eigenes Trennzeichen', async () => {
    await ExportService.exportToCSV([{ A: '1', B: '2' }], { delimiter: ';' });
    const text = await blobText(abgefangeneBlobs[0]);
    expect(text).toContain('"1";"2"');
  });
});

describe('bulkExport', () => {
  it('exportiert mehrere Datensätze nacheinander', async () => {
    await ExportService.bulkExport(
      [
        { data: [{ A: 1 }], options: { filename: 'a.csv' } },
        { data: [{ B: 2 }], options: { filename: 'b.csv' } },
      ],
      'csv'
    );
    expect(abgefangeneBlobs.length).toBeGreaterThanOrEqual(2);
  });
});
