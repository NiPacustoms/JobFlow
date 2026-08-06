/**
 * Dokument-Muster-Renderer (kein regulärer Test).
 *
 * Erzeugt alle in der App generierten PDF-Dokumente einmal mit realistischen
 * Beispieldaten – für visuelle QA, Screenshots und Käufer-Dokumentation.
 *
 * Läuft NUR bei gesetzter Umgebungsvariable:
 *   RENDER_DOC_SAMPLES=1 DOC_SAMPLES_OUT=/pfad npx vitest run lib/services/__tests__/documentSamples.render.test.ts
 *
 * In CI/`npm run test:unit` wird die Suite übersprungen.
 */
import { describe, it, vi, beforeAll } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ENABLED = process.env.RENDER_DOC_SAMPLES === '1';
const OUT = process.env.DOC_SAMPLES_OUT || path.join(process.cwd(), '.doc-samples');

// ——— Beispieldaten (fiktiv, DSGVO-neutral) ———
const employee = {
  id: 'emp-001',
  displayName: 'Maria Beispiel',
  email: 'maria.beispiel@example.com',
  role: 'mitarbeiter',
};
const facility = {
  id: 'fac-001',
  name: 'Seniorenheim Sonnengarten',
  address: 'Gartenweg 12, 48143 Münster',
};
const shift = {
  id: 'shift-001',
  date: new Date('2026-07-06'),
  startTime: '06:30',
  endTime: '14:30',
  type: 'Frühdienst',
  facilityId: facility.id,
  status: 'assigned',
};
const mkTs = (id: string, date: string, start: string, end: string, pause: number, total: number, extra: Record<string, unknown> = {}) => ({
  id,
  userId: employee.id,
  date: new Date(date),
  startTime: start,
  endTime: end,
  breakMinutes: pause,
  totalHours: total,
  status: 'approved',
  facilityId: facility.id,
  ...extra,
});
const timesheets = [
  mkTs('ts-01', '2026-07-06', '06:30', '14:30', 30, 7.5, { overtimeHours: 0 }),
  mkTs('ts-02', '2026-07-07', '06:30', '15:30', 45, 8.25, { overtimeHours: 0.75 }),
  mkTs('ts-03', '2026-07-08', '13:30', '21:30', 30, 7.5, { overtimeHours: 0 }),
  mkTs('ts-04', '2026-07-09', '21:00', '06:00', 45, 8.25, { overtimeHours: 0.25, nightHours: 8 }),
  mkTs('ts-05', '2026-07-11', '06:30', '14:30', 30, 7.5, { weekendHours: 7.5 }),
];
const assignment = {
  id: 'asg-001',
  userId: employee.id,
  shiftId: shift.id,
  status: 'accepted',
  createdAt: new Date('2026-07-01'),
  employeeSignatureUrl: undefined,
  signatures: [],
};

// Kleine „Unterschrift" als Daten-URL (PNG), damit Signaturfelder gefüllt sind
let signatureDataUrl = '';
async function makeSignature(): Promise<string> {
  const sharp = (await import('sharp')).default;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="90">
    <path d="M15 60 C 45 15, 70 75, 95 45 S 150 20, 175 55 Q 190 70 205 40"
          stroke="#1c1917" stroke-width="3" fill="none" stroke-linecap="round"/></svg>`;
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  return `data:image/png;base64,${buf.toString('base64')}`;
}

// Logo als Daten-URL (für Admin-Report-Branding)
let logoDataUrl = '';
async function makeLogo(): Promise<string> {
  const { readFileSync } = await import('node:fs');
  const buf = readFileSync(path.join(process.cwd(), 'public', 'logo-default.png'));
  return `data:image/png;base64,${buf.toString('base64')}`;
}

// AufAbruf-Firmenlogo (aus der Kunden-Vorlage) – nur fürs Muster, als PNG
let aufAbrufLogo: string | undefined;
async function makeAufAbrufLogo(): Promise<string | undefined> {
  const { readFileSync, existsSync } = await import('node:fs');
  const p = process.env.AUFABRUF_LOGO_PATH;
  if (!p || !existsSync(p)) return undefined;
  const sharp = (await import('sharp')).default;
  const png = await sharp(readFileSync(p)).png().toBuffer();
  return `data:image/png;base64,${png.toString('base64')}`;
}

// ——— Mocks: Datenzugriff + Storage (Upload → Datei auf Platte) ———
vi.mock('@/lib/firebase', () => ({ db: {}, auth: {}, getDb: () => ({}) }));
vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/services/timesheets', () => ({
  timesheetService: {
    getTimesheetsByDateRange: vi.fn(async () => timesheets),
    getByUserAndDateRange: vi.fn(async () => [timesheets[0]]),
    getById: vi.fn(async (id: string) => timesheets.find(t => t.id === id) ?? timesheets[0]),
  },
}));
vi.mock('@/lib/services/assignments', () => ({
  assignmentService: { getById: vi.fn(async () => assignment) },
}));
vi.mock('@/lib/services/shifts', () => ({
  shiftService: { getById: vi.fn(async () => shift) },
}));
vi.mock('@/lib/services/facilities', () => ({
  facilityService: { getById: vi.fn(async () => facility) },
}));
vi.mock('@/lib/services/users', () => ({
  userService: { getById: vi.fn(async () => employee) },
}));
vi.mock('@/lib/services/firebaseStorage', () => ({
  firebaseStorageService: {
    uploadFile: vi.fn(async (file: File, storagePath: string) => {
      // jsdom-File hat kein arrayBuffer() → FileReader nutzen
      const buf: Buffer = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(Buffer.from(reader.result as ArrayBuffer));
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(file);
      });
      const fileName = path.basename(storagePath);
      writeFileSync(path.join(OUT, fileName), buf);
      return { url: `file://${path.join(OUT, fileName)}`, path: storagePath };
    }),
  },
}));

describe.runIf(ENABLED)('Dokument-Muster rendern', () => {
  beforeAll(async () => {
    // Firmendaten für die Dokument-Fußzeile (analog .env.production.local)
    Object.assign(process.env, {
      NEXT_PUBLIC_COMPANY_NAME: 'AufAbruf GmbH',
      NEXT_PUBLIC_LEGAL_FORM: 'GmbH',
      NEXT_PUBLIC_COMPANY_STREET: 'Herner Straße 134',
      NEXT_PUBLIC_COMPANY_CITY: 'Herten',
      NEXT_PUBLIC_COMPANY_ZIP: '45699',
      NEXT_PUBLIC_COMPANY_EMAIL: 'info@aufabruf.eu',
      NEXT_PUBLIC_COMPANY_PHONE: '02366 58 292 58',
      NEXT_PUBLIC_COMPANY_WEBSITE: 'www.aufabruf.eu',
      NEXT_PUBLIC_REGISTER_NUMBER: 'HRB 9754',
      NEXT_PUBLIC_VAT_ID: 'DE369 553 099',
      NEXT_PUBLIC_RESPONSIBLE_NAME: 'Christian Zak',
      NEXT_PUBLIC_RESPONSIBLE_POSITION: 'Geschäftsführer',
      NEXT_PUBLIC_TAX_NUMBER: '359/5742/0930',
      NEXT_PUBLIC_BANK_NAME: 'Sparkasse Gelsenkirchen',
      NEXT_PUBLIC_BANK_IBAN: 'DE88 4205 0001 0102 0122 10',
      NEXT_PUBLIC_BANK_BIC: 'WELADED1GEK',
    });
    mkdirSync(OUT, { recursive: true });
    signatureDataUrl = await makeSignature();
    logoDataUrl = await makeLogo();
    aufAbrufLogo = await makeAufAbrufLogo();
    // jsdom lädt keine Bilder → Image-Stub, damit onload feuert (Signatur/Logo-Einbettung)
    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      width = 220;
      height = 90;
      set src(_v: string) {
        setTimeout(() => this.onload?.(), 0);
      }
    }
    vi.stubGlobal('Image', FakeImage);
    // Briefkopf-Logo: fetch('/logo-default.png') im Test aus dem Dateisystem bedienen
    const { readFileSync } = await import('node:fs');
    const origFetch = globalThis.fetch;
    vi.stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/logo-default.png' || url === '/company-logo.png') {
        const buf = readFileSync(path.join(process.cwd(), 'public', url.slice(1)));
        return new Response(buf, { status: 200, headers: { 'content-type': 'image/png' } });
      }
      return origFetch(input, init);
    }) as typeof fetch);
    // jsPDF: doc.save() im Test-Env → Datei statt Browser-Download
    const { default: jsPDF } = await import('jspdf');
    (jsPDF as unknown as { API: Record<string, unknown> }).API.save = function (
      this: { output: (t: string) => ArrayBuffer },
      filename: string
    ) {
      writeFileSync(path.join(OUT, filename), Buffer.from(this.output('arraybuffer')));
    };
  });

  it('documentGeneration: alle 8 Dokumenttypen', async () => {
    const { documentGenerationService } = await import('@/lib/services/documentGeneration');
    const dateRange = { start: new Date('2026-07-06'), end: new Date('2026-07-12') };

    await documentGenerationService.generateDocument({
      type: 'timesheet-report', userId: employee.id, dateRange,
    });
    await documentGenerationService.generateDocument({
      type: 'assignment-confirmation', assignmentId: assignment.id,
    });
    await documentGenerationService.generateDocument({
      type: 'shift-summary', userId: employee.id, dateRange,
    });
    await documentGenerationService.generateDocument({
      type: 'monthly-report', userId: employee.id, dateRange,
    });
    await documentGenerationService.generateDocument({
      type: 'custom-report', title: 'Individueller Bericht', dateRange,
      customData: { Bereich: 'Pflege ambulant', Auswertung: 'Juli 2026', Autor: 'Verwaltung' },
    });
    const notificationBase = {
      employeeName: employee.displayName,
      facilityName: facility.name,
      facilityAddress: facility.address,
      stationName: 'Station 2b',
      shiftTimes: '06:30 – 14:30 Uhr (Frühdienst)',
      assignmentCreationDate: new Date('2026-07-01'),
      assignmentDate: shift.date,
      date: new Date('2026-07-05'),
      shiftType: 'Frühdienst',
      contactPerson: 'Hr. Verwalter',
      branding: { companyName: 'AufAbruf GmbH', companyLogo: aufAbrufLogo },
    };
    // Variante A: angenommen
    await documentGenerationService.generateDocument({
      type: 'assignment-notification',
      assignmentNotificationData: { ...notificationBase, isDeclined: false, signatureDataUrl },
    });
    {
      const { readdirSync, renameSync } = await import('node:fs');
      const f = readdirSync(OUT).find(n => n.startsWith('Einsatzmitteilung_'));
      if (f) renameSync(path.join(OUT, f), path.join(OUT, 'Einsatzmitteilung_angenommen.pdf'));
    }
    // Variante B: abgelehnt (mit Begründung)
    await documentGenerationService.generateDocument({
      type: 'assignment-notification',
      assignmentNotificationData: {
        ...notificationBase,
        isDeclined: true,
        signatureDataUrl,
        declineReason: 'Bereits anderweitig verplant an diesem Tag.',
      },
    });
    {
      const { readdirSync, renameSync } = await import('node:fs');
      const f = readdirSync(OUT).find(n => n.startsWith('Einsatzmitteilung_2'));
      if (f) renameSync(path.join(OUT, f), path.join(OUT, 'Einsatzmitteilung_abgelehnt.pdf'));
    }
    await documentGenerationService.generateDocument({
      type: 'assignment-signatures', assignmentId: assignment.id,
      timesheetIds: ['ts-01'], includeSignatures: true,
    });
    await documentGenerationService.generateDocument({
      type: 'admin-report',
      adminReportData: {
        reportTitle: 'Monatsauswertung Einsätze',
        period: '01.07.2026 – 31.07.2026',
        reportType: 'Einsatz-Statistik',
        branding: { companyName: 'Schichtklar', companyLogo: logoDataUrl },
      },
      customData: {
        'Einsätze gesamt': 128, 'Besetzt': 121, 'Offen': 4, 'Abgesagt': 3,
        'Auslastung': '94,5 %', 'Überstunden gesamt': '37,25 h',
      },
    });
  }, 60000);

  it('timesheetProof: Tagesnachweis', async () => {
    const { timesheetProofService } = await import('@/lib/services/timesheetProof');
    await timesheetProofService.generateDailyProofPDF({
      timesheet: {
        id: 'ts-01', userId: employee.id, date: new Date('2026-07-06'),
        startTime: '06:30', endTime: '14:30', breakMinutes: 30, totalHours: 7.5,
        notes: 'Übergabe an Spätdienst erfolgt; keine besonderen Vorkommnisse.',
        facilitySignatureUrl: signatureDataUrl,
        facilitySignedAt: new Date('2026-07-06T14:35:00'),
        facilitySignerName: 'B. Leitung',
        facilityConfirmationStatus: 'performed',
      },
      employee: { id: employee.id, name: employee.displayName, email: employee.email },
      facility: { id: facility.id, name: facility.name, address: facility.address },
    });
  }, 30000);

  it('assignmentCollectionPdf: Sammel-PDF', async () => {
    const { buildAssignmentCollectionPdf } = await import('@/lib/services/assignmentCollectionPdf');
    const bytes = await buildAssignmentCollectionPdf({
      assignments: [{ id: assignment.id, userId: employee.id } as never],
      title: 'Einsatzmitteilungen KW 28',
    });
    writeFileSync(path.join(OUT, 'einsatz-sammel-pdf.pdf'), Buffer.from(bytes));
  }, 30000);
});
