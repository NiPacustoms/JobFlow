import { beforeEach, describe, expect, it, vi } from 'vitest';
import { harness, firestoreModuleMock, ts } from './helpers/firestoreHarness';

/**
 * Systemeinstellungen, Rollen und Dokumenttypen (Administration).
 */

vi.mock('@/lib/firebase', () => ({ db: {}, getDb: vi.fn(() => ({})) }));
vi.mock('firebase/firestore', () => firestoreModuleMock());

const lade = async () => (await import('../adminSettings')).adminSettingsService;

beforeEach(() => {
  vi.clearAllMocks();
  harness.reset();
});

describe('Systemeinstellungen', () => {
  it('liefert Standardwerte, wenn nichts hinterlegt ist', async () => {
    harness.setDocs([]);
    const service = await lade();
    const settings = await service.getSettings();
    expect(settings).toMatchObject({
      systemName: 'Schichtklar',
      timezone: 'Europe/Berlin',
      language: 'de',
      currency: 'EUR',
    });
  });

  it('liest hinterlegte Einstellungen', async () => {
    harness.setDocs([
      {
        id: 'cfg',
        data: {
          systemName: 'AufAbruf Planung',
          sessionTimeout: 60,
          twoFactorRequired: true,
          updatedAt: ts(new Date(2026, 6, 20)),
        },
      },
    ]);
    const service = await lade();
    const settings = await service.getSettings();
    expect(settings.systemName).toBe('AufAbruf Planung');
    expect(settings.sessionTimeout).toBe(60);
    expect(settings.twoFactorRequired).toBe(true);
  });

  it('legt ein Einstellungsdokument an, wenn keines existiert', async () => {
    harness.setDocs([]);
    const service = await lade();
    await service.updateSettings({ systemName: 'Neu' } as never);
    expect(harness.writes.find(w => w.art === 'add')?.daten).toMatchObject({ systemName: 'Neu' });
  });

  it('aktualisiert ein vorhandenes Einstellungsdokument', async () => {
    harness.setDocs([{ id: 'cfg', data: { systemName: 'Alt' } }]);
    const service = await lade();
    await service.updateSettings({ systemName: 'Neu' } as never);
    expect(harness.writes.find(w => w.art === 'update')?.daten).toMatchObject({ systemName: 'Neu' });
  });
});

describe('Rollen', () => {
  const rolle = (id: string, daten: Record<string, unknown> = {}) => ({
    id,
    data: {
      name: 'Disponent',
      description: 'Plant Einsätze',
      permissions: ['shifts.read', 'shifts.write'],
      userCount: 2,
      status: 'active',
      createdAt: ts(new Date(2026, 0, 1)),
      updatedAt: ts(new Date(2026, 6, 1)),
      ...daten,
    },
  });

  it('liest alle Rollen', async () => {
    harness.setDocs([rolle('r1'), rolle('r2', { name: 'Leitung' })]);
    const service = await lade();
    const rollen = await service.getRoles();
    expect(rollen).toHaveLength(2);
    expect(rollen[0]).toMatchObject({ id: 'r1', name: 'Disponent' });
  });

  it('liest eine einzelne Rolle', async () => {
    harness.setDoc(rolle('r1'));
    const service = await lade();
    const r = await service.getRoleById('r1');
    expect(r).toMatchObject({ id: 'r1', name: 'Disponent', userCount: 2 });
    expect(r?.createdAt).toBeInstanceOf(Date);
  });

  it('liefert null für eine unbekannte Rolle', async () => {
    harness.setDoc(null);
    const service = await lade();
    expect(await service.getRoleById('fehlt')).toBeNull();
  });

  it('setzt Standardwerte für unvollständige Rollendokumente', async () => {
    harness.setDoc({ id: 'r1', data: { name: 'Minimal' } });
    const service = await lade();
    const r = await service.getRoleById('r1');
    expect(r?.permissions).toEqual([]);
    expect(r?.userCount).toBe(0);
    expect(r?.status).toBe('active');
  });

  it('legt eine Rolle an', async () => {
    const service = await lade();
    const id = await service.createRole({
      name: 'Neu',
      description: '',
      permissions: [],
      userCount: 0,
      status: 'active',
    } as never);
    expect(id).toBe('neu1');
  });

  it('ändert eine Rolle', async () => {
    const service = await lade();
    await service.updateRole('r1', { name: 'Umbenannt' } as never);
    expect(harness.writes.find(w => w.art === 'update')?.daten).toMatchObject({ name: 'Umbenannt' });
  });

  it('löscht eine Rolle', async () => {
    const service = await lade();
    await service.deleteRole('r1');
    expect(harness.writes.some(w => w.art === 'delete')).toBe(true);
  });
});

describe('Dokumenttypen', () => {
  const typ = (id: string, daten: Record<string, unknown> = {}) => ({
    id,
    data: {
      name: 'Führungszeugnis',
      required: true,
      hasExpiry: true,
      status: 'active',
      createdAt: ts(new Date(2026, 0, 1)),
      updatedAt: ts(new Date(2026, 6, 1)),
      ...daten,
    },
  });

  it('liest alle Dokumenttypen', async () => {
    harness.setDocs([typ('d1'), typ('d2', { name: 'Impfnachweis' })]);
    const service = await lade();
    const typen = await service.getDocumentTypes();
    expect(typen).toHaveLength(2);
  });

  it('liest einen einzelnen Dokumenttyp', async () => {
    harness.setDoc(typ('d1'));
    const service = await lade();
    expect(await service.getDocumentTypeById('d1')).toMatchObject({ id: 'd1', name: 'Führungszeugnis' });
  });

  it('liefert null für einen unbekannten Dokumenttyp', async () => {
    harness.setDoc(null);
    const service = await lade();
    expect(await service.getDocumentTypeById('fehlt')).toBeNull();
  });

  it('legt einen Dokumenttyp an', async () => {
    const service = await lade();
    const id = await service.createDocumentType({ name: 'Neu', required: false } as never);
    expect(id).toBe('neu1');
  });

  it('ändert einen Dokumenttyp', async () => {
    const service = await lade();
    await service.updateDocumentType('d1', { required: false } as never);
    expect(harness.writes.find(w => w.art === 'update')?.daten).toMatchObject({ required: false });
  });

  it('löscht einen Dokumenttyp', async () => {
    const service = await lade();
    await service.deleteDocumentType('d1');
    expect(harness.writes.some(w => w.art === 'delete')).toBe(true);
  });
});

describe('Systeminformationen und Export', () => {
  it('liefert Systeminformationen', async () => {
    const service = await lade();
    const info = await service.getSystemInfo();
    expect(info).toBeTruthy();
  });

  it('exportiert die Einstellungen als herunterladbare Datei', async () => {
    // jsdom kennt createObjectURL nicht – für den Export-Pfad nachrüsten.
    const createObjectURL = vi.fn(() => 'blob:export');
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
    harness.setDocs([{ id: 'cfg', data: { systemName: 'Schichtklar' } }]);
    const service = await lade();
    const url = await service.exportSettings();
    expect(url).toBe('blob:export');
    expect(createObjectURL).toHaveBeenCalled();
  });
});

describe('Sicherung und Wiederherstellung', () => {
  beforeEach(() => {
    Object.defineProperty(URL, 'createObjectURL', {
      value: vi.fn(() => 'blob:backup'),
      configurable: true,
    });
  });

  it('erzeugt eine Sicherungsdatei als Download-Link', async () => {
    vi.useFakeTimers();
    const service = await lade();
    const versprechen = service.backupData();
    await vi.advanceTimersByTimeAsync(2000);
    await expect(versprechen).resolves.toBe('blob:backup');
    vi.useRealTimers();
  });

  it('stellt eine gültige Sicherung wieder her', async () => {
    vi.useFakeTimers();
    const service = await lade();
    const datei = {
      text: async () => JSON.stringify({ timestamp: '2026-07-20T10:00:00Z', version: '1.0.0' }),
    } as File;

    const versprechen = service.restoreData(datei);
    await vi.advanceTimersByTimeAsync(5000);
    await expect(versprechen).resolves.toBeUndefined();
    vi.useRealTimers();
  });

  it('lehnt eine Sicherung ohne Zeitstempel oder Version ab', async () => {
    vi.useFakeTimers();
    const service = await lade();
    const datei = { text: async () => JSON.stringify({ irgendwas: true }) } as File;

    const versprechen = service.restoreData(datei).catch(e => e);
    await vi.advanceTimersByTimeAsync(5000);
    const fehler = await versprechen;
    expect(fehler).toBeInstanceOf(Error);
    expect((fehler as Error).message).toContain('Ungültige Backup-Datei');
    vi.useRealTimers();
  });

  it('meldet eine unlesbare Sicherungsdatei', async () => {
    const service = await lade();
    const datei = { text: async () => 'kein JSON' } as File;
    await expect(service.restoreData(datei)).rejects.toThrow();
  });
});

describe('Einstellungs-Import', () => {
  it('übernimmt Einstellungen, Rollen und Dokumenttypen', async () => {
    harness.setDocs([{ id: 'cfg', data: { systemName: 'Schichtklar' } }]);
    const service = await lade();
    const datei = {
      text: async () =>
        JSON.stringify({
          settings: { systemName: 'Neu' },
          roles: [{ name: 'Disponent', permissions: [] }],
          documentTypes: [{ name: 'Führungszeugnis', category: 'Nachweis' }],
        }),
    } as File;

    await service.importSettings(datei);
    // Einstellungen aktualisiert bzw. angelegt, Rolle und Dokumenttyp hinzugefügt
    expect(harness.writes.filter(w => w.art === 'add')).toHaveLength(2);
  });

  it('kommt ohne Dokumenttypen aus', async () => {
    harness.setDocs([{ id: 'cfg', data: { systemName: 'Schichtklar' } }]);
    const service = await lade();
    const datei = {
      text: async () => JSON.stringify({ settings: {}, roles: [] }),
    } as File;

    await expect(service.importSettings(datei)).resolves.toBeUndefined();
  });

  it('lehnt eine Datei ohne Einstellungen oder Rollen ab', async () => {
    const service = await lade();
    const datei = { text: async () => JSON.stringify({ irgendwas: true }) } as File;
    await expect(service.importSettings(datei)).rejects.toThrow('Ungültige Import-Datei');
  });
});

describe('getDocumentTypeById – Standardwerte', () => {
  it('ergänzt fehlende Felder mit Vorgaben', async () => {
    harness.setDoc({ id: 'd1', data: { name: 'Impfnachweis', category: 'Gesundheit' } });
    const service = await lade();

    const typ = await service.getDocumentTypeById('d1');
    expect(typ).toMatchObject({
      id: 'd1',
      name: 'Impfnachweis',
      validityPeriod: 365,
      required: false,
      status: 'active',
    });
    expect(typ?.createdAt).toBeInstanceOf(Date);
  });

  it('übernimmt hinterlegte Werte inkl. Zeitstempeln', async () => {
    harness.setDoc({
      id: 'd1',
      data: {
        name: 'Führungszeugnis',
        category: 'Nachweis',
        validityPeriod: 1095,
        required: true,
        status: 'inactive',
        createdAt: ts(new Date(2026, 5, 1)),
        updatedAt: ts(new Date(2026, 6, 1)),
      },
    });
    const service = await lade();

    const typ = await service.getDocumentTypeById('d1');
    expect(typ).toMatchObject({ validityPeriod: 1095, required: true, status: 'inactive' });
    expect(typ?.createdAt).toEqual(new Date(2026, 5, 1));
  });
});
