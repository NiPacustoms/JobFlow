import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * PDF-Erzeugung: Stundennachweis, Einsatzmitteilung (§ 11 AÜG),
 * Signaturbogen, Berichte. Diese Dokumente gehen an Mitarbeiter und Kunden –
 * ein Fehler hier ist unmittelbar sichtbar.
 *
 * Es läuft die echte jsPDF-Kette; nur Datenzugriff und Storage sind gemockt.
 */

const uploadFile = vi.fn();
vi.mock('../firebaseStorage', () => ({
  firebaseStorageService: { uploadFile: (...a: unknown[]) => uploadFile(...a) },
}));

const getTimesheetsByDateRange = vi.fn(async () => []);
const getTimesheetById = vi.fn(async () => null);
const getAssignmentById = vi.fn(async () => null);
const getShiftById = vi.fn(async () => null);
const getFacilityById = vi.fn(async () => null);
const getUserById = vi.fn(async () => null);

vi.mock('../timesheets', () => ({
  timesheetService: {
    getTimesheetsByDateRange: (...a: unknown[]) => getTimesheetsByDateRange(...(a as [])),
    getById: (...a: unknown[]) => getTimesheetById(...(a as [])),
  },
}));
vi.mock('../assignments', () => ({
  assignmentService: { getById: (...a: unknown[]) => getAssignmentById(...(a as [])) },
}));
vi.mock('../shifts', () => ({
  shiftService: { getById: (...a: unknown[]) => getShiftById(...(a as [])) },
}));
vi.mock('../facilities', () => ({
  facilityService: { getById: (...a: unknown[]) => getFacilityById(...(a as [])) },
}));
vi.mock('../users', () => ({
  userService: { getById: (...a: unknown[]) => getUserById(...(a as [])) },
}));

// Logo-Abruf geht sonst über fetch – im Test nicht verfügbar.
vi.mock('@/lib/config/logo', () => ({ getAppLogoUrl: () => '' }));

const lade = async () => (await import('../documentGeneration')).documentGenerationService;

const nachweis = (overrides: Record<string, unknown> = {}) => ({
  id: 't1',
  userId: 'u1',
  date: new Date(2026, 6, 20),
  startTime: '06:00',
  endTime: '14:00',
  breakMinutes: 30,
  totalHours: 7.5,
  status: 'approved',
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  uploadFile.mockResolvedValue({ url: 'https://example/doc.pdf' });
  getTimesheetsByDateRange.mockResolvedValue([]);
  getTimesheetById.mockResolvedValue(null);
  getAssignmentById.mockResolvedValue(null);
  getShiftById.mockResolvedValue(null);
  getFacilityById.mockResolvedValue(null);
  getUserById.mockResolvedValue(null);
});

describe('generateDocument – Zeiterfassungsbericht', () => {
  it('erzeugt ein PDF und lädt es hoch', async () => {
    getTimesheetsByDateRange.mockResolvedValue([nachweis(), nachweis({ id: 't2', totalHours: 8 })] as never);
    const service = await lade();
    const result = await service.generateDocument({
      type: 'timesheet-report',
      userId: 'u1',
      dateRange: { start: new Date(2026, 6, 1), end: new Date(2026, 6, 31) },
    });

    expect(result.url).toBe('https://example/doc.pdf');
    expect(result.fileName).toMatch(/^Zeiterfassungsbericht_\d{4}-\d{2}-\d{2}\.pdf$/);
    expect(result.fileSize).toBeGreaterThan(0);
    expect(result.createdAt).toBeInstanceOf(Date);
    expect(uploadFile).toHaveBeenCalledTimes(1);
  });

  it('legt das Dokument unter documents/generated ab', async () => {
    const service = await lade();
    await service.generateDocument({
      type: 'timesheet-report',
      dateRange: { start: new Date(2026, 6, 1), end: new Date(2026, 6, 31) },
    });
    expect(uploadFile.mock.calls[0][1]).toMatch(/^documents\/generated\//);
    expect(uploadFile.mock.calls[0][2]).toMatchObject({ kind: 'generated-document' });
  });

  it('kommt ohne Nachweise im Zeitraum zurecht', async () => {
    const service = await lade();
    const result = await service.generateDocument({
      type: 'timesheet-report',
      dateRange: { start: new Date(2026, 6, 1), end: new Date(2026, 6, 31) },
    });
    expect(result.fileSize).toBeGreaterThan(0);
  });

  it('übersteht einen Fehler beim Laden der Nachweise', async () => {
    getTimesheetsByDateRange.mockRejectedValue(new Error('Firestore weg'));
    const service = await lade();
    const result = await service.generateDocument({
      type: 'timesheet-report',
      dateRange: { start: new Date(2026, 6, 1), end: new Date(2026, 6, 31) },
    });
    expect(result.fileSize).toBeGreaterThan(0);
  });
});

describe('generateDocument – Einsatzbestätigung und Schichtzusammenfassung', () => {
  it('erzeugt eine Einsatzbestätigung mit Einrichtungsdaten', async () => {
    getAssignmentById.mockResolvedValue({
      id: 'a1',
      userId: 'u1',
      shiftId: 's1',
      status: 'accepted',
      assignedAt: new Date(2026, 6, 18),
    } as never);
    getShiftById.mockResolvedValue({
      id: 's1',
      facilityId: 'f1',
      date: '2026-07-20',
      startTime: '06:00',
      endTime: '14:00',
    } as never);
    getFacilityById.mockResolvedValue({ id: 'f1', name: 'Haus Sonnenschein' } as never);

    const service = await lade();
    const result = await service.generateDocument({
      type: 'assignment-confirmation',
      assignmentId: 'a1',
    });
    expect(result.fileName).toMatch(/^Einsatzbest/);
    expect(result.fileSize).toBeGreaterThan(0);
  });

  it('erzeugt eine Einsatzbestätigung auch ohne auffindbaren Einsatz', async () => {
    const service = await lade();
    const result = await service.generateDocument({
      type: 'assignment-confirmation',
      assignmentId: 'fehlt',
    });
    expect(result.fileSize).toBeGreaterThan(0);
  });

  it('erzeugt eine Schichtzusammenfassung', async () => {
    getTimesheetsByDateRange.mockResolvedValue([nachweis()] as never);
    const service = await lade();
    const result = await service.generateDocument({
      type: 'shift-summary',
      dateRange: { start: new Date(2026, 6, 1), end: new Date(2026, 6, 31) },
    });
    expect(result.fileName).toMatch(/^Schichtzusammenfassung/);
  });

  it('erzeugt einen Monatsbericht', async () => {
    getTimesheetsByDateRange.mockResolvedValue([
      nachweis({ status: 'approved' }),
      nachweis({ id: 't2', status: 'submitted' }),
      nachweis({ id: 't3', status: 'rejected' }),
    ] as never);
    const service = await lade();
    const result = await service.generateDocument({
      type: 'monthly-report',
      dateRange: { start: new Date(2026, 6, 1), end: new Date(2026, 6, 31) },
    });
    expect(result.fileName).toMatch(/^Monatsbericht/);
  });

  it('erzeugt einen benutzerdefinierten Bericht mit Zusatzdaten', async () => {
    const service = await lade();
    const result = await service.generateDocument({
      type: 'custom-report',
      title: 'Sonderauswertung',
      customData: { Mitarbeiter: 12, Zeitraum: 'Juli 2026' },
    });
    expect(result.fileName).toMatch(/^Bericht_/);
  });
});

describe('generateDocument – Einsatzmitteilung (§ 11 AÜG)', () => {
  const mitteilung = (overrides: Record<string, unknown> = {}) => ({
    employeeName: 'Anna Muster',
    facilityName: 'Haus Sonnenschein',
    facilityAddress: 'Hauptstr. 1, 45699 Herten',
    stationName: 'Station 3',
    shiftTimes: '06:00 – 14:00 Uhr',
    assignmentCreationDate: new Date(2026, 6, 18),
    assignmentDate: new Date(2026, 6, 20),
    date: new Date(2026, 6, 18),
    isDeclined: false,
    ...overrides,
  });

  it('erzeugt eine Annahme-Mitteilung', async () => {
    const service = await lade();
    const result = await service.generateDocument({
      type: 'assignment-notification',
      assignmentNotificationData: mitteilung() as never,
    });
    expect(result.fileName).toMatch(/^Einsatzmitteilung/);
    expect(result.fileSize).toBeGreaterThan(0);
  });

  it('erzeugt eine Ablehnungs-Mitteilung mit Begründung', async () => {
    const service = await lade();
    const result = await service.generateDocument({
      type: 'assignment-notification',
      assignmentNotificationData: mitteilung({
        isDeclined: true,
        declineReason: 'Krankheit',
      }) as never,
    });
    expect(result.fileSize).toBeGreaterThan(0);
  });

  it('bindet eine Unterschrift als Bild ein', async () => {
    // 1x1-PNG als Signatur
    const signatureDataUrl =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const service = await lade();
    const result = await service.generateDocument({
      type: 'assignment-notification',
      assignmentNotificationData: mitteilung({ signatureDataUrl }) as never,
    });
    expect(result.fileSize).toBeGreaterThan(0);
  });

  it('kommt ohne optionale Angaben aus', async () => {
    const service = await lade();
    const result = await service.generateDocument({
      type: 'assignment-notification',
      assignmentNotificationData: {
        employeeName: 'Anna',
        facilityName: 'Haus',
        shiftTimes: '06:00 – 14:00 Uhr',
        assignmentCreationDate: new Date(2026, 6, 18),
        assignmentDate: new Date(2026, 6, 20),
        date: new Date(2026, 6, 18),
        isDeclined: false,
      } as never,
    });
    expect(result.fileSize).toBeGreaterThan(0);
  });

  it('wirft ohne die notwendigen Mitteilungsdaten', async () => {
    const service = await lade();
    await expect(service.generateDocument({ type: 'assignment-notification' })).rejects.toThrow();
  });
});

describe('generateDocument – Signaturbogen', () => {
  it('erzeugt den Bogen mit Einsatz, Schicht und Mitarbeiter', async () => {
    getAssignmentById.mockResolvedValue({
      id: 'a1',
      userId: 'u1',
      shiftId: 's1',
      status: 'accepted',
      relievingSignatures: [
        {
          date: '2026-07-20',
          signerName: 'PDL Müller',
          signatureUrl: '',
          signedAt: new Date(2026, 6, 20),
          verifiedTimes: { startTime: '06:00', endTime: '14:00', breakMinutes: 30, totalHours: 7.5 },
        },
      ],
      signatureSchedule: { requiredDates: [new Date(2026, 6, 20)], collectedDates: ['2026-07-20'] },
    } as never);
    getShiftById.mockResolvedValue({
      id: 's1',
      facilityId: 'f1',
      date: '2026-07-20',
      startTime: '06:00',
      endTime: '14:00',
    } as never);
    getFacilityById.mockResolvedValue({ id: 'f1', name: 'Haus Sonnenschein' } as never);
    getUserById.mockResolvedValue({ id: 'u1', displayName: 'Anna Muster' } as never);
    getTimesheetById.mockResolvedValue(nachweis() as never);

    const service = await lade();
    const result = await service.generateDocument({
      type: 'assignment-signatures',
      assignmentId: 'a1',
      timesheetIds: ['t1'],
    });
    expect(result.fileName).toMatch(/^Zeiterfassung_Unterschriften/);
    expect(result.fileSize).toBeGreaterThan(0);
  });

  it('wirft, wenn der Einsatz fehlt', async () => {
    const service = await lade();
    await expect(
      service.generateDocument({ type: 'assignment-signatures', assignmentId: 'fehlt' })
    ).rejects.toThrow();
  });
});

describe('generateDocument – Admin-Bericht', () => {
  it('erzeugt den Bericht aus den übergebenen Kopfdaten', async () => {
    const service = await lade();
    const result = await service.generateDocument({
      type: 'admin-report',
      adminReportData: {
        reportTitle: 'Monatsauswertung',
        period: 'month',
        reportType: 'timeAccount',
        branding: { companyName: 'AufAbruf GmbH' },
      },
    });
    expect(result.fileName).toMatch(/^Bericht_/);
    expect(result.fileSize).toBeGreaterThan(0);
  });

  it('wirft ohne Kopfdaten', async () => {
    const service = await lade();
    await expect(service.generateDocument({ type: 'admin-report' })).rejects.toThrow();
  });

  it.each(['week', 'month', 'quarter', 'year', 'unbekannt'])(
    'beschriftet den Zeitraum %s',
    async period => {
      const service = await lade();
      const result = await service.generateDocument({
        type: 'admin-report',
        adminReportData: {
          reportTitle: 'Auswertung',
          period,
          reportType: 'employeeStats',
          branding: {},
        },
      });
      expect(result.fileSize).toBeGreaterThan(0);
    }
  );
});

describe('generateDocument – Fehlerfälle', () => {
  it('lehnt einen unbekannten Dokumenttyp ab', async () => {
    const service = await lade();
    await expect(
      service.generateDocument({ type: 'gibt-es-nicht' as never })
    ).rejects.toThrow(/Unbekannter Dokumenttyp/);
  });

  it('meldet einen fehlgeschlagenen Upload verständlich', async () => {
    uploadFile.mockRejectedValue(new Error('Storage verweigert'));
    const service = await lade();
    await expect(
      service.generateDocument({
        type: 'custom-report',
        title: 'Test',
      })
    ).rejects.toThrow(/Fehler beim Hochladen/);
  });

  it('meldet einen Upload ohne URL als Fehler', async () => {
    uploadFile.mockResolvedValue({ url: '' });
    const service = await lade();
    await expect(service.generateDocument({ type: 'custom-report' })).rejects.toThrow(
      /Fehler beim Hochladen/
    );
  });
});
