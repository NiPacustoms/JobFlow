/**
 * Gemeinsames PDF-Design für alle in der App erzeugten Dokumente.
 *
 * Gestaltungsprinzipien (analog zum App-Design „Clean & Flat"):
 * - Briefkopf: Logo links, Meta-Angaben rechts, Titelzeile, Teal-Linie
 * - Typografie: klare Hierarchie (18/11/9.5), Grau für Sekundäres
 * - Tabellen: Teal-Kopf, Zebra-Streifen, Zahlen rechtsbündig
 * - Fußzeile: Haarlinie, Produktname links, Seitenzahl rechts
 *
 * Alle Maße in mm (jsPDF-Standardeinheit, A4 210×297).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export const PDF_COLORS = {
  teal: [15, 118, 110] as [number, number, number],
  tealDark: [17, 94, 89] as [number, number, number],
  tealSoft: [240, 253, 250] as [number, number, number],
  ink: [28, 25, 23] as [number, number, number],
  gray: [120, 113, 108] as [number, number, number],
  grayLight: [214, 211, 209] as [number, number, number],
  rowAlt: [250, 250, 249] as [number, number, number],
  white: [255, 255, 255] as [number, number, number],
  red: [190, 40, 40] as [number, number, number],
  redSoft: [253, 242, 242] as [number, number, number],
};

export const PDF_MARGIN = 16;
const PAGE_W = 210;
const PAGE_H = 297;

let cachedLogo: string | null | undefined;

async function fetchPngAsDataUrl(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(String(res.status));
  const buf = new Uint8Array(await res.arrayBuffer());
  // Base64 ohne FileReader (funktioniert in Browser und Test-Umgebung)
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
    binary += String.fromCharCode(...buf.subarray(i, i + chunk));
  }
  return `data:image/png;base64,${btoa(binary)}`;
}

/**
 * Briefkopf-Logo als Daten-URL laden. Dokumente stellt das UNTERNEHMEN aus:
 * zuerst Firmenlogo (AufAbruf, /company-logo.png), dann Produktlogo (Schichtklar)
 * als Fallback; schlägt beides fehl → null (Text-Fallback im Briefkopf).
 */
async function loadLogoDataUrl(): Promise<string | null> {
  if (cachedLogo !== undefined) return cachedLogo;
  try {
    cachedLogo = await fetchPngAsDataUrl('/company-logo.png');
  } catch {
    try {
      cachedLogo = await fetchPngAsDataUrl('/logo-default.png');
    } catch {
      cachedLogo = null;
    }
  }
  return cachedLogo;
}

export interface LetterheadOptions {
  /** Dokumenttitel (z. B. „Zeiterfassungsbericht") */
  title: string;
  /** Untertitel (z. B. Zeitraum oder Mitarbeiter) */
  subtitle?: string;
  /** Rechtsbündige Meta-Zeilen (Standard: „Erstellt am …") */
  metaLines?: string[];
  /** Firmenname unter dem Logo-Fallback / rechts im Kopf */
  companyName?: string;
  /** Eigenes Logo (Daten-URL); Standard: App-Logo */
  logoDataUrl?: string | null;
}

/**
 * Zeichnet den Briefkopf und liefert die Y-Position, an der der Inhalt beginnt.
 */
export async function drawLetterhead(doc: any, opts: LetterheadOptions): Promise<number> {
  const m = PDF_MARGIN;
  const logo = opts.logoDataUrl !== undefined ? opts.logoDataUrl : await loadLogoDataUrl();

  // Logo seitenverhältnis­treu in eine Box max. 45×16 mm einpassen (kein Quetschen),
  // vertikal in der Kopfzone zentriert. Fällt auf Firmenname zurück, wenn kein Logo.
  if (logo) {
    try {
      const boxX = m;
      const boxTop = 11;
      const boxMaxW = 45;
      const boxMaxH = 16;
      let drawW = boxMaxW;
      let drawH = boxMaxH;
      try {
        const props = doc.getImageProperties(logo);
        if (props?.width && props?.height) {
          const ratio = Math.min(boxMaxW / props.width, boxMaxH / props.height);
          drawW = props.width * ratio;
          drawH = props.height * ratio;
        }
      } catch {
        // Kein Zugriff auf Bildmaße → sichere Standardhöhe mit Wortmarken-Ratio (~3.9:1)
        drawH = 10.5;
        drawW = Math.min(boxMaxW, drawH * 3.9);
      }
      const offsetY = boxTop + (boxMaxH - drawH) / 2;
      const fmt = /^data:image\/jpe?g/i.test(logo) ? 'JPEG' : 'PNG';
      doc.addImage(logo, fmt, boxX, offsetY, drawW, drawH);
    } catch {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.setTextColor(...PDF_COLORS.ink);
      doc.text(opts.companyName || 'Schichtklar', m, 19);
    }
  } else {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(...PDF_COLORS.ink);
    doc.text(opts.companyName || 'Schichtklar', m, 19);
  }

  // Meta-Block rechts
  const meta = opts.metaLines ?? [`Erstellt am ${formatDateDE(new Date())}`];
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...PDF_COLORS.gray);
  let my = 15;
  for (const line of meta) {
    doc.text(line, PAGE_W - m, my, { align: 'right' });
    my += 4.5;
  }

  // Titel + Untertitel
  let y = 34;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(...PDF_COLORS.ink);
  doc.text(opts.title, m, y);
  y += 6.5;
  if (opts.subtitle) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10.5);
    doc.setTextColor(...PDF_COLORS.gray);
    doc.text(opts.subtitle, m, y);
    y += 5;
  }

  // Teal-Linie unter dem Kopf
  y += 2;
  doc.setDrawColor(...PDF_COLORS.teal);
  doc.setLineWidth(0.8);
  doc.line(m, y, PAGE_W - m, y);

  doc.setTextColor(...PDF_COLORS.ink);
  return y + 8;
}

/**
 * Fußzeile auf allen Seiten: Haarlinie, Produkt links, Seitenzahl rechts.
 * Nach dem Inhalt (direkt vor doc.output) aufrufen.
 */
export function drawFooters(doc: any, leftText = 'Schichtklar · Digitale Schichtplanung'): void {
  const m = PDF_MARGIN;
  const pages: number = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...PDF_COLORS.grayLight);
    doc.setLineWidth(0.3);
    doc.line(m, PAGE_H - 14, PAGE_W - m, PAGE_H - 14);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...PDF_COLORS.gray);
    doc.text(leftText, m, PAGE_H - 9);
    doc.text(`Seite ${i} von ${pages}`, PAGE_W - m, PAGE_H - 9, { align: 'right' });
  }
  doc.setTextColor(...PDF_COLORS.ink);
}

export interface CompanyFooterInfo {
  companyName: string;
  legalForm?: string;
  responsible?: string; // z. B. "Geschäftsführer Christian Zak"
  street?: string;
  cityLine?: string; // "45699 Herten"
  phone?: string;
  email?: string;
  website?: string;
  bankName?: string;
  iban?: string;
  bic?: string;
  taxNumber?: string;
  vatId?: string;
  registerLine?: string; // "Handelsregister HRB 9754"
}

/**
 * Professionelle Firmen-Fußzeile auf allen Seiten:
 * drei Spalten (Firma · Kontakt · Bankverbindung), darunter eine feine
 * Steuer-/Registerzeile – oberhalb einer Teal-Haarlinie. Ersetzt für
 * offizielle Firmendokumente (z. B. Einsatzmitteilung) die schlichte
 * `drawFooters`-Zeile. Nach dem Inhalt (vor doc.output) aufrufen.
 */
export function drawCompanyFooter(doc: any, info: CompanyFooterInfo): void {
  const m = PDF_MARGIN;
  const usable = PAGE_W - 2 * m;
  const colW = usable / 3;
  const baseY = PAGE_H - 26; // Startlinie des Blocks
  const lineH = 3.4;

  const col1: string[] = [
    `${info.companyName}${info.legalForm && !info.companyName.includes(info.legalForm) ? ' ' + info.legalForm : ''}`,
  ];
  if (info.responsible) col1.push(info.responsible);
  if (info.street) col1.push(info.street);
  if (info.cityLine) col1.push(info.cityLine);

  const col2: string[] = ['Kontaktmöglichkeit'];
  if (info.phone) col2.push(`Tel.: ${info.phone}`);
  if (info.email) col2.push(`Mail: ${info.email}`);
  if (info.website) col2.push(`Web: ${info.website}`);

  const col3: string[] = [];
  if (info.bankName || info.iban || info.bic) {
    col3.push('Bankverbindung');
    if (info.bankName) col3.push(info.bankName);
    if (info.iban) col3.push(`IBAN: ${info.iban}`);
    if (info.bic) col3.push(`BIC: ${info.bic}`);
  }

  const taxParts = [
    info.taxNumber ? `Steuernummer ${info.taxNumber}` : '',
    info.vatId ? `USt.-ID ${info.vatId}` : '',
    info.registerLine || '',
  ].filter(Boolean);

  const pages: number = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);

    // Teal-Haarlinie über der Fußzeile
    doc.setDrawColor(...PDF_COLORS.teal);
    doc.setLineWidth(0.6);
    doc.line(m, baseY - 4, PAGE_W - m, baseY - 4);

    const drawCol = (lines: string[], x: number) => {
      let yy = baseY;
      lines.forEach((line, idx) => {
        doc.setFont('helvetica', idx === 0 ? 'bold' : 'normal');
        doc.setFontSize(7.2);
        doc.setTextColor(...(idx === 0 ? PDF_COLORS.tealDark : PDF_COLORS.gray));
        doc.text(line, x, yy);
        yy += lineH;
      });
    };
    drawCol(col1, m);
    drawCol(col2, m + colW);
    if (col3.length) drawCol(col3, m + 2 * colW);

    // Steuer-/Registerzeile mittig darunter
    if (taxParts.length) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(...PDF_COLORS.gray);
      doc.text(taxParts.join('   ·   '), PAGE_W / 2, PAGE_H - 9, { align: 'center' });
    }

    // Seitenzahl nur bei mehrseitigen Dokumenten (rechts, dezent)
    if (pages > 1) {
      doc.setFontSize(7);
      doc.setTextColor(...PDF_COLORS.grayLight);
      doc.text(`Seite ${i}/${pages}`, PAGE_W - m, PAGE_H - 9, { align: 'right' });
    }
  }
  doc.setTextColor(...PDF_COLORS.ink);
}

/** Reservierte Höhe der Firmen-Fußzeile (mm) – Inhalt darf nicht hineinragen. */
export const COMPANY_FOOTER_HEIGHT = 34;

/** Abschnittsüberschrift (klein, versal, Teal) – gibt neue Y-Position zurück */
export function sectionTitle(doc: any, y: number, text: string): number {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(...PDF_COLORS.tealDark);
  doc.text(text.toUpperCase(), PDF_MARGIN, y);
  doc.setTextColor(...PDF_COLORS.ink);
  return y + 6;
}

/** Label-Wert-Zeile – gibt neue Y-Position zurück */
export function kvLine(doc: any, y: number, label: string, value: string, labelWidth = 48): number {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...PDF_COLORS.gray);
  doc.text(label, PDF_MARGIN, y);
  doc.setTextColor(...PDF_COLORS.ink);
  doc.text(String(value ?? '–'), PDF_MARGIN + labelWidth, y);
  return y + 6;
}

/** Unterschriftslinie mit Beschriftung – gibt neue Y-Position zurück */
export function signatureLine(doc: any, y: number, label: string, width = 70): number {
  doc.setDrawColor(...PDF_COLORS.grayLight);
  doc.setLineWidth(0.3);
  doc.line(PDF_MARGIN, y, PDF_MARGIN + width, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...PDF_COLORS.gray);
  doc.text(label, PDF_MARGIN, y + 4.5);
  doc.setTextColor(...PDF_COLORS.ink);
  return y + 12;
}

/**
 * Einheitliche autoTable-Optionen.
 * @param rightCols Spaltenindizes, die rechtsbündig gesetzt werden (Zahlen).
 *                  Auch die Kopfzellen dieser Spalten werden rechtsbündig
 *                  gesetzt, damit Header und Werte fluchten.
 */
export function brandedTableOptions(rightCols: number[] = []): Record<string, unknown> {
  const columnStyles: Record<number, { halign: 'right' }> = {};
  for (const c of rightCols) columnStyles[c] = { halign: 'right' };
  return {
    theme: 'striped',
    styles: {
      font: 'helvetica',
      fontSize: 9.5,
      cellPadding: { top: 2.6, bottom: 2.6, left: 3, right: 3 },
      textColor: PDF_COLORS.ink,
      lineColor: PDF_COLORS.grayLight,
      lineWidth: 0,
    },
    headStyles: {
      fillColor: PDF_COLORS.teal,
      textColor: PDF_COLORS.white,
      fontStyle: 'bold',
      fontSize: 9,
    },
    alternateRowStyles: { fillColor: PDF_COLORS.rowAlt },
    columnStyles,
    didParseCell: (data: { section: string; column: { index: number }; cell: { styles: { halign?: string } } }) => {
      if (data.section === 'head' && rightCols.includes(data.column.index)) {
        data.cell.styles.halign = 'right';
      }
    },
    margin: { left: PDF_MARGIN, right: PDF_MARGIN },
  };
}

/* ── Deutsche Formatierung (einheitlich für alle Dokumente) ─────────────── */

/** Datum als dd.MM.yyyy (immer zweistellig). */
export function formatDateDE(d: Date | string | number | null | undefined): string {
  if (d === null || d === undefined || d === '') return '–';
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '–';
  return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Datum + Uhrzeit als dd.MM.yyyy, HH:mm Uhr (ohne Sekunden). */
export function formatDateTimeDE(d: Date | string | number | null | undefined): string {
  if (d === null || d === undefined || d === '') return '–';
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '–';
  const datePart = date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const timePart = date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  return `${datePart}, ${timePart} Uhr`;
}

/** Stunden mit deutschem Dezimalkomma, z. B. "7,50 h" bzw. "7,50". */
export function formatHoursDE(hours: number | null | undefined, withUnit = true): string {
  const value = typeof hours === 'number' && Number.isFinite(hours) ? hours : 0;
  const formatted = value.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return withUnit ? `${formatted} h` : formatted;
}

/* ── KPI-Kacheln (z. B. Kennzahlen im Monatsbericht) ────────────────────── */

export interface StatTile {
  label: string;
  value: string;
}

/**
 * Zeichnet eine Reihe von Kennzahl-Kacheln (heller Teal-Grund, Wert groß,
 * Label klein) über die volle Satzbreite. Gibt die neue Y-Position zurück.
 */
export function drawStatTiles(doc: any, y: number, tiles: StatTile[]): number {
  if (tiles.length === 0) return y;
  const m = PDF_MARGIN;
  const gap = 4;
  const tileH = 18;
  const usable = PAGE_W - 2 * m;
  const tileW = (usable - gap * (tiles.length - 1)) / tiles.length;

  tiles.forEach((tile, i) => {
    const x = m + i * (tileW + gap);
    doc.setFillColor(...PDF_COLORS.tealSoft);
    doc.setDrawColor(...PDF_COLORS.grayLight);
    doc.setLineWidth(0.2);
    doc.roundedRect(x, y, tileW, tileH, 1.8, 1.8, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(...PDF_COLORS.tealDark);
    doc.text(tile.value, x + 4, y + 8.5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...PDF_COLORS.gray);
    doc.text(tile.label.toUpperCase(), x + 4, y + 14);
  });

  doc.setTextColor(...PDF_COLORS.ink);
  return y + tileH + 8;
}
