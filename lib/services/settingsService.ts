import { 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  serverTimestamp 
} from 'firebase/firestore';
import { 
  ref, 
  uploadBytes, 
  getDownloadURL, 
  deleteObject 
} from 'firebase/storage';
import { db, getDb, getStorage } from '@/lib/firebase';
import { FeatureFlags, DEFAULT_FEATURE_FLAGS } from '@/lib/types/featureFlags';

export interface SystemSettings {
  id: string;
  
  // Branding
  companyName: string;
  companyLogo?: string;
  primaryColor: string;
  secondaryColor: string;
  showLogo: boolean;
  customColors: boolean;
  
  
  // Notifications
  emailNotifications: boolean;
  pushNotifications: boolean;
  smsNotifications: boolean;
  notificationEmail: string;
  notificationPhone: string;
  
  // Security
  twoFactorAuth: boolean;
  sessionTimeout: boolean;
  sessionTimeoutMinutes: number;
  passwordPolicy: boolean;
  passwordMinLength: number;
  passwordRequireSpecial: boolean;
  passwordRequireNumbers: boolean;
  
  // System
  timezone: string;
  dateFormat: string;
  timeFormat: string;
  language: string;
  autoBackup: boolean;
  backupFrequency: 'daily' | 'weekly' | 'monthly';
  
  // Feature Toggles - Admin kann Features aktivieren/deaktivieren
  features: FeatureFlags;
  
  // Created/Updated
  createdAt: Date;
  updatedAt: Date;
  updatedBy: string;
}

export interface SettingsUpdateData {
  companyName?: string;
  companyLogo?: string;
  primaryColor?: string;
  secondaryColor?: string;
  showLogo?: boolean;
  customColors?: boolean;
  emailNotifications?: boolean;
  pushNotifications?: boolean;
  smsNotifications?: boolean;
  notificationEmail?: string;
  notificationPhone?: string;
  twoFactorAuth?: boolean;
  sessionTimeout?: boolean;
  sessionTimeoutMinutes?: number;
  passwordPolicy?: boolean;
  passwordMinLength?: number;
  passwordRequireSpecial?: boolean;
  passwordRequireNumbers?: boolean;
  timezone?: string;
  dateFormat?: string;
  timeFormat?: string;
  language?: string;
  autoBackup?: boolean;
  backupFrequency?: 'daily' | 'weekly' | 'monthly';
  features?: {
    enableReports?: boolean;
    enableAssignments?: boolean;
    enableAuditLogs?: boolean;
    enableDocumentTypes?: boolean;
    enableTemplates?: boolean;
    enableEmployeeDocuments?: boolean;
    enableEmployeeReports?: boolean;
    enableEmployeeAssignments?: boolean;
    enableEmployeeFacilities?: boolean;
    enableEmployeeNotifications?: boolean;
  };
}

class SettingsService {
  private collection = 'systemSettings';
  private documentId = 'main';

  // Standard-Einstellungen
  private getDefaultSettings(): Omit<SystemSettings, 'id' | 'createdAt' | 'updatedAt' | 'updatedBy'> {
    return {
      companyName: 'Schichtklar',
      primaryColor: '#1976d2',
      secondaryColor: '#dc004e',
      showLogo: true,
      customColors: false,
      emailNotifications: true,
      pushNotifications: true,
      smsNotifications: false,
      notificationEmail: '',
      notificationPhone: '',
      twoFactorAuth: true,
      sessionTimeout: false,
      sessionTimeoutMinutes: 30,
      passwordPolicy: true,
      passwordMinLength: 8,
      passwordRequireSpecial: true,
      passwordRequireNumbers: true,
      timezone: 'Europe/Berlin',
      dateFormat: 'DD.MM.YYYY',
      timeFormat: 'HH:mm',
      language: 'de',
      autoBackup: true,
      backupFrequency: 'weekly',
      features: { ...DEFAULT_FEATURE_FLAGS },
    };
  }

  // Einstellungen abrufen
  async getSettings(): Promise<SystemSettings> {
    try {
      // Fallback: Wenn Firebase nicht initialisiert ist, liefere Defaults
      if (!db) {
        const defaults = this.getDefaultSettings();
        return {
          id: this.documentId,
          ...defaults,
          createdAt: new Date(),
          updatedAt: new Date(),
          updatedBy: 'system'
        } as SystemSettings;
      }
      
      // Prüfe, ob getDb() verfügbar ist, bevor wir es aufrufen
      let firestoreDb;
      try {
        firestoreDb = getDb();
      } catch (_dbError) {
        // Wenn getDb() fehlschlägt, verwende Defaults
        const defaults = this.getDefaultSettings();
        return {
          id: this.documentId,
          ...defaults,
          createdAt: new Date(),
          updatedAt: new Date(),
          updatedBy: 'system'
        } as SystemSettings;
      }
      
      const settingsRef = doc(firestoreDb, this.collection, this.documentId);
      const settingsSnap = await getDoc(settingsRef);

      if (settingsSnap.exists()) {
        return {
          id: settingsSnap.id,
          ...settingsSnap.data()
        } as SystemSettings;
      } else {
        // Standard-Einstellungen erstellen
        const defaultSettings = this.getDefaultSettings();
        const newSettings: SystemSettings = {
          id: this.documentId,
          ...defaultSettings,
          createdAt: new Date(),
          updatedAt: new Date(),
          updatedBy: 'system'
        };

        await setDoc(settingsRef, newSettings);
        return newSettings;
      }
    } catch (error: unknown) {
      // Permission errors are expected for non-admin users - return defaults instead
      const isPermissionError = error && typeof error === 'object' && (
        ('code' in error && error.code === 'permission-denied') ||
        ('message' in error && typeof error.message === 'string' && 
         (error.message.includes('permission') || error.message.includes('Permission')))
      );
      
      if (isPermissionError) {
        // Return default settings for non-admin users
        const defaults = this.getDefaultSettings();
        return {
          id: this.documentId,
          ...defaults,
          createdAt: new Date(),
          updatedAt: new Date(),
          updatedBy: 'system'
        } as SystemSettings;
      }
      
      // For other errors, throw as before
      throw new Error('Failed to fetch settings');
    }
  }

  // Einstellungen aktualisieren
  async updateSettings(data: SettingsUpdateData, updatedBy: string): Promise<void> {
    try {
      if (!db) {
        throw new Error('Firebase ist nicht initialisiert');
      }
      const settingsRef = doc(getDb(), this.collection, this.documentId);
      await updateDoc(settingsRef, {
        ...data,
        updatedAt: serverTimestamp(),
        updatedBy
      });
    } catch (_error) {
      throw new Error('Failed to update settings');
    }
  }

  // Logo hochladen
  async uploadLogo(file: File, userId: string): Promise<string> {
    try {
      // Altes Logo löschen falls vorhanden
      const settings = await this.getSettings();
      if (settings.companyLogo) {
        try {
          const oldLogoRef = ref(getStorage(), settings.companyLogo);
          await deleteObject(oldLogoRef);
        } catch (_error) {
          // Ignore deletion errors
        }
      }

      // Neues Logo hochladen
      const timestamp = Date.now();
      const fileName = `logos/company-logo-${timestamp}.${file.name.split('.').pop()}`;
      const logoRef = ref(getStorage(), fileName);
      
      // Versuche regulären Upload in Firebase Storage
      await uploadBytes(logoRef, file);
      const downloadURL = await getDownloadURL(logoRef);

      // URL in Einstellungen speichern
      await this.updateSettings({ companyLogo: downloadURL }, userId);

      return downloadURL;
    } catch (_error) {
      // Entwicklungs-Fallback: Wenn Upload wegen CORS/AppCheck scheitert,
      // speichere das Logo als Data-URL in den Einstellungen (nur dev).
      if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
        try {
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden'));
            reader.readAsDataURL(file);
          });
          await this.updateSettings({ companyLogo: dataUrl }, userId);
          return dataUrl;
        } catch (_) {
          // ignore and fall through
        }
      }
      throw new Error('Failed to upload logo');
    }
  }

  // Logo löschen
  async deleteLogo(userId: string): Promise<void> {
    try {
      const settings = await this.getSettings();
      if (settings.companyLogo) {
        // Logo aus Storage löschen
        const logoRef = ref(getStorage(), settings.companyLogo);
        await deleteObject(logoRef);
      }

      // URL aus Einstellungen entfernen
      await this.updateSettings({ companyLogo: undefined }, userId);
    } catch (_error) {
      throw new Error('Failed to delete logo');
    }
  }

  // Einstellungen zurücksetzen
  async resetSettings(userId: string): Promise<void> {
    try {
      const defaultSettings = this.getDefaultSettings();
      const settingsRef = doc(getDb(), this.collection, this.documentId);
      
      await setDoc(settingsRef, {
        ...defaultSettings,
        updatedAt: serverTimestamp(),
        updatedBy: userId
      });
    } catch (_error) {
      throw new Error('Failed to reset settings');
    }
  }

  // Spezifische Einstellungsgruppen aktualisieren
  async updateBrandingSettings(data: {
    companyName?: string;
    primaryColor?: string;
    secondaryColor?: string;
    showLogo?: boolean;
    customColors?: boolean;
  }, userId: string): Promise<void> {
    await this.updateSettings(data, userId);
  }

  async updateNotificationSettings(data: {
    emailNotifications?: boolean;
    pushNotifications?: boolean;
    smsNotifications?: boolean;
    notificationEmail?: string;
    notificationPhone?: string;
  }, userId: string): Promise<void> {
    await this.updateSettings(data, userId);
  }

  async updateSecuritySettings(data: {
    twoFactorAuth?: boolean;
    sessionTimeout?: boolean;
    sessionTimeoutMinutes?: number;
    passwordPolicy?: boolean;
    passwordMinLength?: number;
    passwordRequireSpecial?: boolean;
    passwordRequireNumbers?: boolean;
  }, userId: string): Promise<void> {
    await this.updateSettings(data, userId);
  }

  async updateSystemSettings(data: {
    timezone?: string;
    dateFormat?: string;
    timeFormat?: string;
    language?: string;
    autoBackup?: boolean;
    backupFrequency?: 'daily' | 'weekly' | 'monthly';
  }, _userId: string): Promise<void> {
    await this.updateSettings(data, _userId);
  }

  async updateFeatureSettings(data: Partial<FeatureFlags>, userId: string): Promise<void> {
    // Merge mit bestehenden Features
    const currentSettings = await this.getSettings();
    const updatedFeatures: FeatureFlags = {
      ...currentSettings.features,
      ...data,
    };
    await this.updateSettings({ features: updatedFeatures }, userId);
  }

  // Validierung
  validateSettings(data: SettingsUpdateData): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (data.companyName !== undefined && data.companyName.trim().length === 0) {
      errors.push('Firmenname darf nicht leer sein');
    }

    if (data.primaryColor !== undefined && !/^#[0-9A-F]{6}$/i.test(data.primaryColor)) {
      errors.push('Primärfarbe muss ein gültiger Hex-Code sein');
    }

    if (data.secondaryColor !== undefined && !/^#[0-9A-F]{6}$/i.test(data.secondaryColor)) {
      errors.push('Sekundärfarbe muss ein gültiger Hex-Code sein');
    }




    if (data.notificationEmail !== undefined && data.notificationEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.notificationEmail)) {
      errors.push('E-Mail-Adresse ist ungültig');
    }

    if (data.notificationPhone !== undefined && data.notificationPhone && !/^\+?[1-9]\d{1,14}$/.test(data.notificationPhone)) {
      errors.push('Telefonnummer ist ungültig');
    }

    if (data.passwordMinLength !== undefined && (data.passwordMinLength < 6 || data.passwordMinLength > 50)) {
      errors.push('Passwort-Mindestlänge muss zwischen 6 und 50 Zeichen liegen');
    }

    if (data.sessionTimeoutMinutes !== undefined && (data.sessionTimeoutMinutes < 5 || data.sessionTimeoutMinutes > 480)) {
      errors.push('Session-Timeout muss zwischen 5 und 480 Minuten liegen');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  // Export/Import
  async exportSettings(): Promise<SystemSettings> {
    return await this.getSettings();
  }

  async importSettings(settings: SystemSettings, userId: string): Promise<void> {
    try {
      const settingsRef = doc(getDb(), this.collection, this.documentId);
      await setDoc(settingsRef, {
        ...settings,
        updatedAt: serverTimestamp(),
        updatedBy: userId
      });
    } catch (_error) {
      throw new Error('Failed to import settings');
    }
  }
}

export const settingsService = new SettingsService();
