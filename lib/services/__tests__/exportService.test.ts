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

describe('exportToExcel', () => {
  it('erzeugt eine HTML-Tabelle mit Kopfzeile', async () => {
    const datei = await ExportService.exportToExcel([
      { Name: 'Anna Muster', Stunden: 8, Datum: new Date(2026, 6, 20, 6, 0) },
    ]);

    expect(datei).toMatch(/\.xls$/);
    const inhalt = await blobText(abgefangeneBlobs[0]);
    expect(inhalt).toContain('<table');
    expect(inhalt).toContain('<th>Name</th>');
    expect(inhalt).toContain('Anna Muster');
    expect(inhalt).toContain('20.07.2026');
  });

  it('lässt die Kopfzeile auf Wunsch weg', async () => {
    await ExportService.exportToExcel([{ Name: 'Anna' }], { includeHeaders: false });
    const inhalt = await blobText(abgefangeneBlobs[0]);
    expect(inhalt).not.toContain('<th>');
    expect(inhalt).toContain('Anna');
  });

  it('übernimmt einen eigenen Dateinamen', async () => {
    const datei = await ExportService.exportToExcel([{ Name: 'Anna' }], {
      filename: 'stundenliste.xls',
    });
    expect(datei).toBe('stundenliste.xls');
  });

  it('wirft bei leeren Daten', async () => {
    await expect(ExportService.exportToExcel([])).rejects.toThrow(/Keine Daten/);
  });
});

describe('exportToPDF', () => {
  it('erzeugt ein HTML-Dokument mit Titel, Tabelle und Fußzeile', async () => {
    const datei = await ExportService.exportToPDF(
      [
        { Name: 'Anna Muster', Stunden: 8, Datum: new Date(2026, 6, 20, 6, 0) },
        { Name: 'Bea Beispiel', Stunden: 6.5, Datum: null },
      ],
      'Stundenübersicht Juli'
    );

    expect(datei).toMatch(/^Stundenübersicht Juli-/);
    expect(datei).toMatch(/\.html$/);

    const inhalt = await blobText(abgefangeneBlobs[0]);
    expect(inhalt).toContain('<h1>Stundenübersicht Juli</h1>');
    expect(inhalt).toContain('<th>Name</th>');
    expect(inhalt).toContain('Anna Muster');
    // Zahlen rechts, Datumsangaben zentriert
    expect(inhalt).toContain('class="number"');
    expect(inhalt).toContain('class="date"');
    expect(inhalt).toContain('Gesamt: 2 Einträge');
    expect(inhalt).toContain('Erstellt mit Schichtklar System');
  });

  it('lässt die Kopfzeile auf Wunsch weg und nimmt einen eigenen Dateinamen', async () => {
    const datei = await ExportService.exportToPDF([{ Name: 'Anna' }], 'Liste', {
      includeHeaders: false,
      filename: 'liste.html',
    });
    expect(datei).toBe('liste.html');
    const inhalt = await blobText(abgefangeneBlobs[0]);
    expect(inhalt).not.toContain('<th>');
  });

  it('serialisiert verschachtelte Werte als JSON und maskiert sie HTML-sicher', async () => {
    await ExportService.exportToPDF([{ Adresse: { ort: 'Herten' } }], 'Liste');
    const inhalt = await blobText(abgefangeneBlobs[0]);
    expect(inhalt).toContain('{&quot;ort&quot;:&quot;Herten&quot;}');
  });

  it('maskiert Markup aus den Daten, statt es auszuführen', async () => {
    await ExportService.exportToPDF(
      [{ '<b>Spalte</b>': '<script>alert(1)</script>' }],
      '<img src=x onerror=alert(1)>'
    );
    const inhalt = await blobText(abgefangeneBlobs[0]);
    expect(inhalt).not.toContain('<script>');
    expect(inhalt).toContain('&lt;script&gt;');
    expect(inhalt).toContain('&lt;b&gt;Spalte&lt;/b&gt;');
    expect(inhalt).not.toContain('<img src=x');
  });

  it('wirft bei leeren Daten', async () => {
    await expect(ExportService.exportToPDF([], 'Liste')).rejects.toThrow(/Keine Daten/);
  });
});

describe('bulkExport – weitere Formate', () => {
  it('exportiert mehrere Datensätze als Excel', async () => {
    const dateien = await ExportService.bulkExport(
      [
        { name: 'stunden', data: [{ Name: 'Anna' }], title: 'Stunden' },
        { name: 'einsaetze', data: [{ Name: 'Bea' }], title: 'Einsätze' },
      ],
      'excel'
    );
    expect(dateien).toEqual(['stunden.xls', 'einsaetze.xls']);
  });

  it('exportiert mehrere Datensätze als PDF/HTML', async () => {
    const dateien = await ExportService.bulkExport(
      [{ name: 'stunden', data: [{ Name: 'Anna' }], title: 'Stunden' }],
      'pdf'
    );
    expect(dateien).toEqual(['stunden.html']);
  });

  it('bricht ab, wenn ein Datensatz leer ist', async () => {
    await expect(
      ExportService.bulkExport(
        [
          { name: 'stunden', data: [{ Name: 'Anna' }], title: 'Stunden' },
          { name: 'leer', data: [], title: 'Leer' },
        ],
        'csv'
      )
    ).rejects.toThrow(/Keine Daten/);
  });

  it('lehnt ein unbekanntes Format ab', async () => {
    await expect(
      ExportService.bulkExport(
        [{ name: 'stunden', data: [{ Name: 'Anna' }], title: 'Stunden' }],
        'xml' as never
      )
    ).rejects.toThrow(/Unsupported format/);
  });
});
