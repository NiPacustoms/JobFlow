import { beforeEach, describe, expect, it, vi } from 'vitest';
import { harness, firestoreModuleMock, ts } from './helpers/firestoreHarness';

/**
 * Systemeinstellungen (Rollen/Dokumenttypen) und die Auswertung der
 * Einrichtungsstunden (geplante gegen geleistete Stunden je Kunde).
 */

vi.mock('@/lib/firebase', () => ({ db: {}, getDb: vi.fn(() => ({})) }));
vi.mock('@/lib/utils/companyId', () => ({
  getCompanyIdFromAuth: vi.fn(async () => 'firmaA'),
}));

const getAllFacilities = vi.fn();
vi.mock('../facilities', () => ({
  facilityService: { getAll: (...a: unknown[]) => getAllFacilities(...a) },
}));

vi.mock('firebase/firestore', () => firestoreModuleMock());

beforeEach(async () => {
  vi.clearAllMocks();
  harness.reset();
  const { getCompanyIdFromAuth } = await import('@/lib/utils/companyId');
  vi.mocked(getCompanyIdFromAuth).mockResolvedValue('firmaA');
  getAllFacilities.mockResolvedValue([]);
});

describe('settingsService', () => {
  const lade = async () => (await import('../settings')).settingsService;

  it('liest die Einstellungen mit Rollen und Dokumenttypen', async () => {
    harness.setDocs([
      { id: 'r1', data: { name: 'Disponent', permissions: [], createdAt: ts(new Date()) } },
    ]);
    const service = await lade();
    const settings = await service.getAll();
    expect(settings).toBeTruthy();
  });

  it('legt eine Nutzerrolle an', async () => {
    const service = await lade();
    const id = await service.createUserRole({ name: 'Neu', permissions: [] } as never);
    expect(id).toBe('neu1');
  });

  it('ändert eine Nutzerrolle', async () => {
    const service = await lade();
    await service.updateUserRole('r1', { name: 'Umbenannt' } as never);
    expect(harness.writes.find(w => w.art === 'update')?.daten).toMatchObject({ name: 'Umbenannt' });
  });

  it('löscht eine Nutzerrolle', async () => {
    const service = await lade();
    await service.deleteUserRole('r1');
    expect(harness.writes.some(w => w.art === 'delete')).toBe(true);
  });

  it('legt einen Dokumenttyp an', async () => {
    const service = await lade();
    const id = await service.createDocumentType({ name: 'Impfnachweis' } as never);
    expect(id).toBe('neu1');
  });

  it('ändert und löscht einen Dokumenttyp', async () => {
    const service = await lade();
    await service.updateDocumentType('d1', { name: 'Neu' } as never);
    expect(harness.writes.find(w => w.art === 'update')?.daten).toMatchObject({ name: 'Neu' });

    harness.reset();
    await service.deleteDocumentType('d1');
    expect(harness.writes.some(w => w.art === 'delete')).toBe(true);
  });

  it('aktualisiert einen Einstellungsbereich', async () => {
    const service = await lade();
    await service.updateSection('general' as never, { systemName: 'Neu' } as never);
    expect(harness.writes.length).toBeGreaterThan(0);
  });

  it('exportiert die Einstellungen als Blob', async () => {
    harness.setDocs([]);
    const service = await lade();
    const blob = await service.exportSettings();
    expect(blob).toBeInstanceOf(Blob);
  });
});

describe('facilityHoursService.getSummary', () => {
  const lade = async () => (await import('../facilityHours')).facilityHoursService;

  it('liefert eine leere Auswertung ohne Einrichtungen', async () => {
    getAllFacilities.mockResolvedValue([]);
    const service = await lade();
    expect(await service.getSummary({})).toEqual([]);
  });

  it('liefert ohne companyId keine Auswertung', async () => {
    const { getCompanyIdFromAuth } = await import('@/lib/utils/companyId');
    vi.mocked(getCompanyIdFromAuth).mockResolvedValue(null);
    const service = await lade();
    expect(await service.getSummary({})).toEqual([]);
  });

  it('wertet die Stunden je Einrichtung aus', async () => {
    getAllFacilities.mockResolvedValue([
      { id: 'f1', name: 'Haus Sonnenschein', companyId: 'firmaA' },
    ]);
    harness.setDocs([]);
    const service = await lade();
    const summary = await service.getSummary({
      startDate: new Date(2026, 6, 1),
      endDate: new Date(2026, 6, 31),
    });
    expect(Array.isArray(summary)).toBe(true);
  });

  it('filtert auf eine einzelne Einrichtung', async () => {
    getAllFacilities.mockResolvedValue([
      { id: 'f1', name: 'Haus Sonnenschein', companyId: 'firmaA' },
      { id: 'f2', name: 'Seniorenstift', companyId: 'firmaA' },
    ]);
    harness.setDocs([]);
    const service = await lade();
    const summary = await service.getSummary({ facilityId: 'f1' });
    expect(summary.length).toBeLessThanOrEqual(1);
  });

  it('überspringt Einrichtungen ohne companyId', async () => {
    getAllFacilities.mockResolvedValue([{ id: 'f1', name: 'Ohne Firma' }]);
    harness.setDocs([]);
    const service = await lade();
    expect(await service.getSummary({})).toEqual([]);
  });
});

describe('settingsService – Vollbild der Einstellungen', () => {
  const lade = async () => (await import('../settings')).settingsService;

  it('liest alle vier Bereiche mit Standardwerten für fehlende Felder', async () => {
    // Reihenfolge: system, security, notifications, email (getDoc)
    harness.setDoc({ id: 'system', data: {} });
    harness.setDocs([], []);
    const service = await lade();

    const settings = await service.getAll();
    expect(settings.system).toMatchObject({
      maintenanceMode: false,
      allowRegistration: false,
      requireEmailVerification: true,
      defaultLanguage: 'de',
      timezone: 'Europe/Berlin',
    });
    expect(settings.security).toMatchObject({
      sessionTimeout: 30,
      require2FA: false,
      passwordComplexity: true,
      maxLoginAttempts: 5,
      lockoutDuration: 15,
    });
    expect(settings.notifications).toMatchObject({
      emailEnabled: true,
      pushEnabled: true,
      smsEnabled: false,
    });
    expect(settings.email).toMatchObject({ port: 587, useTLS: true, fromName: 'Schichtklar' });
  });

  it('übernimmt hinterlegte Werte inklusive abgeschalteter Schalter', async () => {
    harness.setDoc({
      id: 'system',
      data: {
        maintenanceMode: true,
        allowRegistration: true,
        requireEmailVerification: false,
        defaultLanguage: 'en',
        timezone: 'Europe/Vienna',
        // Sicherheits-/Mail-Felder kommen im Harness aus demselben Dokument
        sessionTimeout: 60,
        require2FA: true,
        passwordComplexity: false,
        maxLoginAttempts: 3,
        lockoutDuration: 30,
        emailEnabled: false,
        pushEnabled: false,
        smsEnabled: true,
        reminderEnabled: false,
        alertEnabled: false,
        smtpServer: 'smtp.aufabruf.eu',
        port: 465,
        useTLS: false,
        username: 'noreply',
        fromAddress: 'noreply@aufabruf.eu',
        fromName: 'AufAbruf',
      },
    });
    harness.setDocs([], []);
    const service = await lade();

    const settings = await service.getAll();
    expect(settings.system).toMatchObject({
      maintenanceMode: true,
      requireEmailVerification: false,
      defaultLanguage: 'en',
    });
    expect(settings.security).toMatchObject({ sessionTimeout: 60, require2FA: true, passwordComplexity: false });
    expect(settings.notifications).toMatchObject({ emailEnabled: false, smsEnabled: true });
    expect(settings.email).toMatchObject({ smtpServer: 'smtp.aufabruf.eu', port: 465, useTLS: false });
  });

  it('bildet Rollen und Dokumenttypen mit Vorgabewerten ab', async () => {
    harness.setDoc({ id: 'system', data: {} });
    harness.setDocs(
      [{ id: 'r1', data: { name: 'Disponent' } }],
      [{ id: 'd1', data: { name: 'Führungszeugnis' } }]
    );
    const service = await lade();

    const settings = await service.getAll();
    expect(settings.userRoles[0]).toMatchObject({
      id: 'r1',
      name: 'Disponent',
      permissions: [],
      color: '#1976d2',
      userCount: 0,
    });
    expect(settings.documentTypes[0]).toMatchObject({
      id: 'd1',
      validityPeriod: 365,
      required: false,
      category: 'general',
    });
    expect(settings.userRoles[0].createdAt).toBeInstanceOf(Date);
  });

  it('reicht Lesefehler weiter', async () => {
    harness.setDoc({ id: 'system', data: {} });
    harness.naechsterFehler = new Error('kein Zugriff');
    const service = await lade();
    await expect(service.getAll()).rejects.toThrow('kein Zugriff');
  });
});

describe('settingsService – Import und Initialisierung', () => {
  const lade = async () => (await import('../settings')).settingsService;

  it('importiert alle vorhandenen Bereiche', async () => {
    const service = await lade();
    const datei = {
      text: async () =>
        JSON.stringify({
          system: { timezone: 'Europe/Vienna' },
          security: { sessionTimeout: 45 },
          notifications: { emailEnabled: false },
          email: { port: 465 },
        }),
    } as File;

    await service.importSettings(datei);
    expect(harness.writes.filter(w => w.art === 'update')).toHaveLength(4);
  });

  it('überspringt fehlende Bereiche', async () => {
    const service = await lade();
    const datei = { text: async () => JSON.stringify({ system: { timezone: 'UTC' } }) } as File;

    await service.importSettings(datei);
    expect(harness.writes.filter(w => w.art === 'update')).toHaveLength(1);
  });

  it('meldet eine unlesbare Import-Datei', async () => {
    const service = await lade();
    const datei = { text: async () => 'kein JSON' } as File;
    await expect(service.importSettings(datei)).rejects.toThrow();
  });

  it('legt die Standardwerte aller vier Bereiche an', async () => {
    const service = await lade();
    await service.initializeDefaultSettings();

    const updates = harness.writes.filter(w => w.art === 'update');
    expect(updates).toHaveLength(4);
    expect(updates[0].daten).toMatchObject({ timezone: 'Europe/Berlin', maintenanceMode: false });
    expect(updates[3].daten).toMatchObject({ port: 587, fromName: 'Schichtklar' });
  });
});
