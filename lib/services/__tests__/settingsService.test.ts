import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Systemeinstellungen (Branding, Benachrichtigungen, Sicherheit, Feature-Flags):
 * Laden mit Default-Anlage, Berechtigungs-Fallback, Logo-Verwaltung und Validierung.
 */

const getDocMock = vi.fn();
const setDocMock = vi.fn(async () => undefined);
const updateDocMock = vi.fn(async () => undefined);
vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db: unknown, sammlung: string, id: string) => ({ pfad: `${sammlung}/${id}` })),
  getDoc: (...a: unknown[]) => getDocMock(...a),
  setDoc: (...a: unknown[]) => setDocMock(...a),
  updateDoc: (...a: unknown[]) => updateDocMock(...a),
  serverTimestamp: vi.fn(() => 'server-zeit'),
}));

const uploadBytesMock = vi.fn(async () => undefined);
const getDownloadURLMock = vi.fn(async () => 'https://storage.example/logo.png');
const deleteObjectMock = vi.fn(async () => undefined);
vi.mock('firebase/storage', () => ({
  ref: vi.fn((_storage: unknown, pfad: string) => ({ pfad })),
  uploadBytes: (...a: unknown[]) => uploadBytesMock(...a),
  getDownloadURL: (...a: unknown[]) => getDownloadURLMock(...a),
  deleteObject: (...a: unknown[]) => deleteObjectMock(...a),
}));

const getDbMock = vi.fn(() => ({}));
vi.mock('@/lib/firebase', () => ({
  db: {},
  getDb: () => getDbMock(),
  getStorage: vi.fn(() => ({})),
}));

import { settingsService } from '../settingsService';

const vorhandeneEinstellungen = {
  companyName: 'AufAbruf GmbH',
  companyLogo: 'logos/alt.png',
  primaryColor: '#123456',
  secondaryColor: '#654321',
  showLogo: true,
  customColors: true,
  features: { enableReports: true },
};

beforeEach(() => {
  vi.clearAllMocks();
  getDbMock.mockReturnValue({});
  getDocMock.mockResolvedValue({
    exists: () => true,
    id: 'main',
    data: () => vorhandeneEinstellungen,
  });
});

describe('getSettings', () => {
  it('liefert vorhandene Einstellungen aus Firestore', async () => {
    const s = await settingsService.getSettings();
    expect(s).toMatchObject({ id: 'main', companyName: 'AufAbruf GmbH' });
    expect(setDocMock).not.toHaveBeenCalled();
  });

  it('legt beim ersten Aufruf Standardeinstellungen an', async () => {
    getDocMock.mockResolvedValue({ exists: () => false });
    const s = await settingsService.getSettings();
    expect(s.companyName).toBe('Schichtklar');
    expect(s.timezone).toBe('Europe/Berlin');
    expect(setDocMock).toHaveBeenCalledTimes(1);
  });

  it('fällt bei fehlender Berechtigung auf Standardwerte zurück (Fehlercode)', async () => {
    getDocMock.mockRejectedValue({ code: 'permission-denied' });
    const s = await settingsService.getSettings();
    expect(s.companyName).toBe('Schichtklar');
    expect(s.updatedBy).toBe('system');
  });

  it('fällt bei fehlender Berechtigung auf Standardwerte zurück (Fehlermeldung)', async () => {
    getDocMock.mockRejectedValue(new Error('Missing or insufficient permissions'));
    const s = await settingsService.getSettings();
    expect(s.companyName).toBe('Schichtklar');
  });

  it('wirft bei anderen Fehlern einen verständlichen Fehler', async () => {
    getDocMock.mockRejectedValue(new Error('network down'));
    await expect(settingsService.getSettings()).rejects.toThrow('Failed to fetch settings');
  });

  it('liefert Standardwerte, wenn Firestore nicht initialisierbar ist', async () => {
    getDbMock.mockImplementation(() => {
      throw new Error('nicht initialisiert');
    });
    const s = await settingsService.getSettings();
    expect(s.companyName).toBe('Schichtklar');
    expect(getDocMock).not.toHaveBeenCalled();
  });
});

describe('updateSettings', () => {
  it('schreibt Änderungen mit Zeitstempel und Bearbeiter', async () => {
    await settingsService.updateSettings({ companyName: 'Neu GmbH' }, 'admin1');
    expect(updateDocMock).toHaveBeenCalledWith(
      expect.objectContaining({ pfad: 'systemSettings/main' }),
      expect.objectContaining({ companyName: 'Neu GmbH', updatedBy: 'admin1', updatedAt: 'server-zeit' })
    );
  });

  it('wirft bei Schreibfehlern', async () => {
    updateDocMock.mockRejectedValueOnce(new Error('kein Zugriff'));
    await expect(settingsService.updateSettings({}, 'admin1')).rejects.toThrow(
      'Failed to update settings'
    );
  });
});

describe('uploadLogo / deleteLogo', () => {
  const datei = new File(['x'], 'logo.png', { type: 'image/png' });

  it('löscht das alte Logo, lädt das neue hoch und speichert die URL', async () => {
    const url = await settingsService.uploadLogo(datei, 'admin1');
    expect(deleteObjectMock).toHaveBeenCalled(); // altes Logo
    expect(uploadBytesMock).toHaveBeenCalled();
    expect(url).toBe('https://storage.example/logo.png');
    expect(updateDocMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ companyLogo: 'https://storage.example/logo.png' })
    );
  });

  it('ignoriert Fehler beim Löschen des alten Logos', async () => {
    deleteObjectMock.mockRejectedValueOnce(new Error('nicht gefunden'));
    const url = await settingsService.uploadLogo(datei, 'admin1');
    expect(url).toBe('https://storage.example/logo.png');
  });

  it('wirft, wenn der Upload scheitert', async () => {
    uploadBytesMock.mockRejectedValueOnce(new Error('CORS'));
    await expect(settingsService.uploadLogo(datei, 'admin1')).rejects.toThrow(
      'Failed to upload logo'
    );
  });

  it('entfernt das Logo aus Storage und Einstellungen', async () => {
    await settingsService.deleteLogo('admin1');
    expect(deleteObjectMock).toHaveBeenCalled();
    expect(updateDocMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ companyLogo: undefined })
    );
  });

  it('wirft beim Löschen, wenn Storage fehlschlägt', async () => {
    deleteObjectMock.mockRejectedValueOnce(new Error('kein Zugriff'));
    await expect(settingsService.deleteLogo('admin1')).rejects.toThrow('Failed to delete logo');
  });
});

describe('resetSettings und Import/Export', () => {
  it('setzt auf Standardwerte zurück', async () => {
    await settingsService.resetSettings('admin1');
    expect(setDocMock).toHaveBeenCalledWith(
      expect.objectContaining({ pfad: 'systemSettings/main' }),
      expect.objectContaining({ companyName: 'Schichtklar', updatedBy: 'admin1' })
    );
  });

  it('wirft beim Zurücksetzen, wenn das Schreiben scheitert', async () => {
    setDocMock.mockRejectedValueOnce(new Error('kein Zugriff'));
    await expect(settingsService.resetSettings('admin1')).rejects.toThrow(
      'Failed to reset settings'
    );
  });

  it('exportiert die aktuellen Einstellungen', async () => {
    const s = await settingsService.exportSettings();
    expect(s.companyName).toBe('AufAbruf GmbH');
  });

  it('importiert Einstellungen vollständig', async () => {
    await settingsService.importSettings(
      { companyName: 'Import GmbH' } as never,
      'admin1'
    );
    expect(setDocMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ companyName: 'Import GmbH', updatedBy: 'admin1' })
    );
  });

  it('wirft beim Import, wenn das Schreiben scheitert', async () => {
    setDocMock.mockRejectedValueOnce(new Error('kein Zugriff'));
    await expect(
      settingsService.importSettings({ companyName: 'X' } as never, 'admin1')
    ).rejects.toThrow('Failed to import settings');
  });
});

describe('Einstellungsgruppen', () => {
  it('aktualisiert Branding, Benachrichtigungen, Sicherheit und System', async () => {
    await settingsService.updateBrandingSettings({ primaryColor: '#000000' }, 'admin1');
    await settingsService.updateNotificationSettings({ emailNotifications: false }, 'admin1');
    await settingsService.updateSecuritySettings({ passwordMinLength: 10 }, 'admin1');
    await settingsService.updateSystemSettings({ language: 'de' }, 'admin1');
    expect(updateDocMock).toHaveBeenCalledTimes(4);
  });

  it('führt Feature-Flags mit dem Bestand zusammen', async () => {
    await settingsService.updateFeatureSettings({ enableTemplates: true } as never, 'admin1');
    expect(updateDocMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        features: expect.objectContaining({ enableReports: true, enableTemplates: true }),
      })
    );
  });
});

describe('validateSettings', () => {
  it('akzeptiert gültige Werte', () => {
    const ergebnis = settingsService.validateSettings({
      companyName: 'AufAbruf GmbH',
      primaryColor: '#4CAF50',
      secondaryColor: '#0F766E',
      notificationEmail: 'info@aufabruf.eu',
      notificationPhone: '+491711234567',
      passwordMinLength: 8,
      sessionTimeoutMinutes: 30,
    });
    expect(ergebnis).toEqual({ isValid: true, errors: [] });
  });

  it('meldet jeden Verstoß einzeln', () => {
    const ergebnis = settingsService.validateSettings({
      companyName: '   ',
      primaryColor: 'blau',
      secondaryColor: '#12',
      notificationEmail: 'keine-mail',
      notificationPhone: 'abc',
      passwordMinLength: 3,
      sessionTimeoutMinutes: 1000,
    });
    expect(ergebnis.isValid).toBe(false);
    expect(ergebnis.errors).toHaveLength(7);
  });

  it('überspringt leere optionale Felder', () => {
    const ergebnis = settingsService.validateSettings({
      notificationEmail: '',
      notificationPhone: '',
    });
    expect(ergebnis.isValid).toBe(true);
  });
});
