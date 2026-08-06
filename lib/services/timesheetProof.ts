import { firebaseStorageService } from '@/lib/services/firebaseStorage';
import {
  drawFooters,
  drawLetterhead,
  formatDateDE,
  formatDateTimeDE,
  formatHoursDE,
  kvLine,
  sectionTitle,
  PDF_COLORS,
  PDF_MARGIN,
} from '@/lib/services/pdf/brandedPdf';

export interface DailyProofInput {
  timesheet: {
    id: string;
    userId: string;
    date: Date;
    startTime: string;
    endTime: string;
    breakMinutes: number;
    totalHours: number;
    notes?: string;
    facilitySignatureUrl?: string;
    facilitySignedAt?: Date;
    facilitySignerName?: string;
    facilityConfirmationStatus?: 'performed' | 'aborted' | 'no-show';
  };
  employee: { id: string; name?: string; email?: string };
  facility?: { id?: string; name?: string; address?: string };
}

async function fetchAsDataUrl(url: string): Promise<string> {
  const res = await fetch(url);
  const blob = await res.blob();
  return await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
}

export const timesheetProofService = {
  async generateDailyProofPDF(input: DailyProofInput): Promise<{ url: string; path: string }> {
    const { default: jsPDF } = await import('jspdf');
    const doc = new jsPDF(); // mm, A4

    const margin = PDF_MARGIN;
    let y = await drawLetterhead(doc, {
      title: 'Tagesnachweis – Einrichtung',
      subtitle: `Einsatz am ${formatDateDE(input.timesheet.date)}`,
    });

    // Angaben
    y = sectionTitle(doc, y, 'Angaben');
    y = kvLine(doc, y, 'Mitarbeiter/in', `${input.employee.name || input.employee.id}${input.employee.email ? ` (${input.employee.email})` : ''}`);
    y = kvLine(doc, y, 'Einrichtung', `${input.facility?.name || '–'}${input.facility?.address ? ' · ' + input.facility.address : ''}`);
    y = kvLine(doc, y, 'Datum', formatDateDE(input.timesheet.date));

    // Arbeitszeiten
    y += 4;
    y = sectionTitle(doc, y, 'Arbeitszeiten');
    y = kvLine(doc, y, 'Start', input.timesheet.startTime || '–');
    y = kvLine(doc, y, 'Ende', input.timesheet.endTime || '–');
    y = kvLine(doc, y, 'Pause', `${input.timesheet.breakMinutes ?? 0} Min`);
    y = kvLine(doc, y, 'Gesamt', formatHoursDE(input.timesheet.totalHours));

    if (input.timesheet.notes) {
      y += 4;
      y = sectionTitle(doc, y, 'Notizen');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      const split = doc.splitTextToSize(input.timesheet.notes, 210 - 2 * margin);
      doc.text(split, margin, y);
      y += split.length * 5 + 4;
    }

    // Bestätigung Einrichtung
    y += 4;
    y = sectionTitle(doc, y, 'Bestätigung der Einrichtung');
    const statusMap: Record<string, string> = {
      performed: 'Dienst geleistet',
      aborted: 'Abgebrochen',
      'no-show': 'Nicht angetreten',
    };
    const statusText = input.timesheet.facilityConfirmationStatus
      ? statusMap[input.timesheet.facilityConfirmationStatus]
      : '–';
    y = kvLine(doc, y, 'Status', statusText);
    y = kvLine(doc, y, 'Unterzeichnet von', input.timesheet.facilitySignerName || '–');
    y = kvLine(
      doc,
      y,
      'Unterschrieben am',
      input.timesheet.facilitySignedAt
        ? formatDateTimeDE(input.timesheet.facilitySignedAt)
        : '–'
    );

    y += 2;
    if (input.timesheet.facilitySignatureUrl) {
      try {
        const dataUrl = await fetchAsDataUrl(input.timesheet.facilitySignatureUrl);
        doc.addImage(dataUrl, 'PNG', margin, y, 66, 27);
        y += 29;
        doc.setDrawColor(...PDF_COLORS.grayLight);
        doc.setLineWidth(0.3);
        doc.line(margin, y, margin + 70, y);
        doc.setFontSize(8.5);
        doc.setTextColor(...PDF_COLORS.gray);
        doc.text('Unterschrift der Einrichtung', margin, y + 4.5);
        doc.setTextColor(...PDF_COLORS.ink);
        y += 10;
      } catch {
        y = kvLine(doc, y, 'Unterschrift', '[Bild konnte nicht geladen werden]');
      }
    } else {
      y = kvLine(doc, y, 'Unterschrift', '–');
    }

    // Referenz klein am Ende des Inhalts
    doc.setFontSize(7.5);
    doc.setTextColor(...PDF_COLORS.gray);
    doc.text(
      `Referenz: ${input.timesheet.id} · Mitarbeiter-ID: ${input.employee.id}`,
      margin,
      272
    );
    doc.setTextColor(...PDF_COLORS.ink);

    drawFooters(doc);

    const pdfBytes = doc.output('arraybuffer');
    const file = new File([new Uint8Array(pdfBytes)], `tagesnachweis_${input.timesheet.id}.pdf`, { type: 'application/pdf' });
    const upload = await firebaseStorageService.uploadFile(file, `proofs/timesheets/${input.timesheet.userId}/${input.timesheet.id}.pdf`, {
      kind: 'timesheet-daily-proof',
      timesheetId: input.timesheet.id,
      userId: input.timesheet.userId,
      date: input.timesheet.date.toISOString?.() || String(input.timesheet.date),
    });
    return { url: upload.url, path: upload.path };
  },
};
