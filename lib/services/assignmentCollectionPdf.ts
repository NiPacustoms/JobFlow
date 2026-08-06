/**
 * Sammel-PDF: Mehrere Einsatzmitteilungen mit zugeordneter Zeiterfassung
 * zu einem PDF zusammenführen (Drucken / Abspeichern).
 *
 * Design analog zu lib/services/pdf/brandedPdf.ts (Teal-Briefkopf, graue
 * Labels, Fußzeile) – hier mit pdf-lib statt jsPDF, da Fremd-PDFs
 * (Einsatzmitteilungen) seitenweise übernommen werden.
 */
import { assignmentService } from './assignments';
import { shiftService } from './shifts';
import { timesheetService } from './timesheets';
import { userService } from './users';
import { facilityService } from './facilities';
import { logger } from '@/lib/logging';

export interface AssignmentForCollection {
  id: string;
  userId: string;
  pdfUrl: string;
}

export interface CollectionPdfOptions {
  /** Assignments mit pdfUrl (Einsatzmitteilung vorhanden) */
  assignments: AssignmentForCollection[];
  title?: string;
}

/* Farbwerte identisch zu PDF_COLORS in brandedPdf.ts (dort 0–255, hier 0–1) */
const TEAL = { r: 15 / 255, g: 118 / 255, b: 110 / 255 };
const TEAL_DARK = { r: 17 / 255, g: 94 / 255, b: 89 / 255 };
const TEAL_SOFT = { r: 240 / 255, g: 253 / 255, b: 250 / 255 };
const INK = { r: 28 / 255, g: 25 / 255, b: 23 / 255 };
const GRAY = { r: 120 / 255, g: 113 / 255, b: 108 / 255 };
const GRAY_LIGHT = { r: 214 / 255, g: 211 / 255, b: 209 / 255 };
const RED = { r: 190 / 255, g: 40 / 255, b: 40 / 255 };

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 50;

function formatDate(d: Date): string {
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatHours(hours: number): string {
  return `${hours.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} h`;
}

/** Firmenlogo (AufAbruf) für den Briefkopf laden; null wenn nicht verfügbar. */
async function loadLogoBytes(): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch('/company-logo.png');
    if (!res.ok) return null;
    return await res.arrayBuffer();
  } catch {
    return null;
  }
}

/**
 * Erstellt ein Sammel-PDF: Für jeden Einsatz zuerst eine gebrandete Seite
 * "Erfasste Zeit zur Einsatzmitteilung", dann die Einsatzmitteilung selbst.
 * So bleibt die Zeiterfassung der jeweiligen Einsatzmitteilung zugeordnet.
 */
export async function buildAssignmentCollectionPdf(
  options: CollectionPdfOptions
): Promise<Uint8Array> {
  const { assignments } = options;
  if (assignments.length === 0) {
    throw new Error('Keine Einsätze mit Einsatzmitteilung ausgewählt.');
  }

  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const mergedPdf = await PDFDocument.create();
  const font = await mergedPdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await mergedPdf.embedFont(StandardFonts.HelveticaBold);

  const logoBytes = await loadLogoBytes();
  const logo = logoBytes ? await mergedPdf.embedPng(logoBytes).catch(() => null) : null;

  const teal = rgb(TEAL.r, TEAL.g, TEAL.b);
  const tealDark = rgb(TEAL_DARK.r, TEAL_DARK.g, TEAL_DARK.b);
  const tealSoft = rgb(TEAL_SOFT.r, TEAL_SOFT.g, TEAL_SOFT.b);
  const ink = rgb(INK.r, INK.g, INK.b);
  const gray = rgb(GRAY.r, GRAY.g, GRAY.b);
  const grayLight = rgb(GRAY_LIGHT.r, GRAY_LIGHT.g, GRAY_LIGHT.b);
  const red = rgb(RED.r, RED.g, RED.b);

  /** Briefkopf (Logo links, Meta rechts, Titel, Teal-Linie) – liefert Start-Y. */
  const drawLetterhead = (
    page: import('pdf-lib').PDFPage,
    title: string,
    subtitle: string,
    metaLines: string[]
  ): number => {
    // Logo seitenverhältnistreu in Box max. 130×45 pt
    if (logo) {
      const maxW = 130;
      const maxH = 45;
      const ratio = Math.min(maxW / logo.width, maxH / logo.height);
      const w = logo.width * ratio;
      const h = logo.height * ratio;
      page.drawImage(logo, { x: MARGIN, y: PAGE_H - 45 - h, width: w, height: h });
    } else {
      page.drawText('AufAbruf GmbH', { x: MARGIN, y: PAGE_H - 60, size: 14, font: fontBold, color: ink });
    }

    // Meta-Zeilen rechtsbündig
    let my = PAGE_H - 46;
    for (const line of metaLines) {
      const w = font.widthOfTextAtSize(line, 8.5);
      page.drawText(line, { x: PAGE_W - MARGIN - w, y: my, size: 8.5, font, color: gray });
      my -= 12;
    }

    // Titel + Untertitel
    let y = PAGE_H - 118;
    page.drawText(title, { x: MARGIN, y, size: 19, font: fontBold, color: ink });
    y -= 17;
    if (subtitle) {
      page.drawText(subtitle, { x: MARGIN, y, size: 10.5, font, color: gray });
      y -= 10;
    }

    // Teal-Linie
    y -= 6;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 2, color: teal });
    return y - 26;
  };

  /** Abschnittstitel (klein, versal, Teal). */
  const drawSection = (page: import('pdf-lib').PDFPage, y: number, text: string): number => {
    page.drawText(text.toUpperCase(), { x: MARGIN, y, size: 9, font: fontBold, color: tealDark });
    return y - 17;
  };

  /** Label-Wert-Zeile mit fluchtenden Spalten. */
  const drawKv = (page: import('pdf-lib').PDFPage, y: number, label: string, value: string): number => {
    page.drawText(label, { x: MARGIN, y, size: 10, font, color: gray });
    page.drawText(value, { x: MARGIN + 130, y, size: 10, font, color: ink });
    return y - 17;
  };

  /** Fußzeile: Haarlinie + Firmenangabe links, Hinweis rechts. */
  const drawFooter = (page: import('pdf-lib').PDFPage): void => {
    page.drawLine({
      start: { x: MARGIN, y: 42 },
      end: { x: PAGE_W - MARGIN, y: 42 },
      thickness: 0.75,
      color: grayLight,
    });
    page.drawText('AufAbruf GmbH · Einsatzmitteilungen mit Zeiterfassung', {
      x: MARGIN, y: 30, size: 7.5, font, color: gray,
    });
    const right = 'Erstellt mit Schichtklar';
    const w = font.widthOfTextAtSize(right, 7.5);
    page.drawText(right, { x: PAGE_W - MARGIN - w, y: 30, size: 7.5, font, color: gray });
  };

  for (let i = 0; i < assignments.length; i++) {
    const a = assignments[i];
    let shiftDate: Date | null = null;
    let employeeName = '–';
    let facilityName = '–';
    let timesheet: { startTime: string; endTime: string; totalHours: number; date: Date } | null = null;

    try {
      const assignment = await assignmentService.getById(a.id);
      if (!assignment) continue;
      const shift = await shiftService.getById(assignment.shiftId);
      if (shift) {
        shiftDate =
          typeof shift.date === 'string' ? new Date(shift.date) : (shift.date as Date);
        const user = await userService.getById(assignment.userId);
        if (user) employeeName = user.displayName || user.email || '–';
        if (shift.facilityId) {
          const facility = await facilityService.getById(shift.facilityId);
          if (facility) facilityName = facility.name || '–';
        }
        const startOfDay = new Date(shiftDate);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(shiftDate);
        endOfDay.setHours(23, 59, 59, 999);
        const sheets = await timesheetService.getByUserAndDateRange(
          assignment.userId,
          startOfDay,
          endOfDay
        );
        if (sheets.length > 0) {
          const ts = sheets[0];
          const d = ts.date instanceof Date ? ts.date : new Date(ts.date);
          timesheet = {
            startTime: ts.startTime || '–',
            endTime: ts.endTime || '–',
            totalHours: ts.totalHours ?? 0,
            date: d,
          };
        }
      }
    } catch (e) {
      logger.error('Fehler beim Laden der Daten für Assignment ' + a.id, e);
    }

    // Gebrandete Seite "Erfasste Zeit zur Einsatzmitteilung"
    const page = mergedPdf.addPage([PAGE_W, PAGE_H]);
    let y = drawLetterhead(
      page,
      'Erfasste Zeit zur Einsatzmitteilung',
      shiftDate ? `Einsatz vom ${formatDate(shiftDate)}` : 'Einsatz',
      [`Erstellt am ${formatDate(new Date())}`, `Einsatz ${i + 1} von ${assignments.length}`]
    );

    y = drawSection(page, y, 'Einsatzdetails');
    y = drawKv(page, y, 'Mitarbeiter/in', employeeName);
    y = drawKv(page, y, 'Einsatzort', facilityName);
    y = drawKv(page, y, 'Einsatzdatum', shiftDate ? formatDate(shiftDate) : '–');
    y -= 10;

    y = drawSection(page, y, 'Erfasste Zeiten (Schichtende)');
    if (timesheet) {
      // Hervorgehobene Zeit-Box (heller Teal-Grund)
      const boxH = 44;
      page.drawRectangle({
        x: MARGIN,
        y: y - boxH + 12,
        width: PAGE_W - 2 * MARGIN,
        height: boxH,
        color: tealSoft,
        borderColor: grayLight,
        borderWidth: 0.75,
      });
      page.drawText(`${timesheet.startTime} – ${timesheet.endTime} Uhr`, {
        x: MARGIN + 14, y: y - 8, size: 13, font: fontBold, color: tealDark,
      });
      page.drawText(`Gesamt: ${formatHours(timesheet.totalHours)}`, {
        x: MARGIN + 14, y: y - 24, size: 10, font, color: ink,
      });
      y -= boxH + 8;
    } else {
      page.drawText('Keine Zeiterfassung für diesen Tag vorhanden.', {
        x: MARGIN, y, size: 10, font, color: gray,
      });
      y -= 20;
    }

    y -= 14;
    page.drawText('Nachfolgend: Einsatzmitteilung zu diesem Einsatz', {
      x: MARGIN, y, size: 9, font, color: gray,
    });

    drawFooter(page);

    // Einsatzmitteilung-PDF anhängen
    try {
      const res = await fetch(a.pdfUrl, { mode: 'cors' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const pdfBytes = await res.arrayBuffer();
      const srcPdf = await PDFDocument.load(pdfBytes);
      const pageCount = srcPdf.getPageCount();
      const copiedPages = await mergedPdf.copyPages(srcPdf, Array.from({ length: pageCount }, (_, k) => k));
      copiedPages.forEach(p => mergedPdf.addPage(p));
    } catch (e) {
      logger.error('Fehler beim Laden der Einsatzmitteilung ' + a.pdfUrl, e);
      const fallbackPage = mergedPdf.addPage([PAGE_W, PAGE_H]);
      fallbackPage.drawText('Einsatzmitteilung konnte nicht geladen werden.', {
        x: MARGIN, y: PAGE_H - 80, size: 11, font: fontBold, color: red,
      });
      fallbackPage.drawText(`Einsatz: ${a.id}`, {
        x: MARGIN, y: PAGE_H - 100, size: 9, font, color: gray,
      });
      drawFooter(fallbackPage);
    }
  }

  return mergedPdf.save();
}

/**
 * Löst den Download des Sammel-PDFs aus (im Browser).
 */
export function downloadCollectionPdf(bytes: Uint8Array, fileName?: string): void {
  const name = fileName || `Einsatzmitteilungen_Sammlung_${new Date().toISOString().slice(0, 10)}.pdf`;
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
