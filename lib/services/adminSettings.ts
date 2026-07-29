import { db } from '@/lib/firebase';
import { logger } from '@/lib/logging';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  orderBy,
  limit,
} from 'firebase/firestore';

const SETTINGS_COLLECTION = 'adminSettings';
const ROLES_COLLECTION = 'adminRoles';
const DOCUMENT_TYPES_COLLECTION = 'adminDocumentTypes';

export interface SystemSettings {
  systemName: string;
  timezone: string;
  language: string;
  currency: string;
  sessionTimeout: number;
  maxLoginAttempts: number;
  twoFactorRequired: boolean;
  emailNotifications: boolean;
  pushNotifications: boolean;
  smsNotifications: boolean;
  shiftReminders: boolean;
  documentExpiryWarnings: boolean;
  shiftConflictWarnings: boolean;
  systemUpdateNotifications: boolean;
  maintenanceNotifications: boolean;
  lastBackup?: Date;
  backupSize?: string;
  availableBackups?: number;
}

export interface Role {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  userCount: number;
  status: 'active' | 'inactive' | 'pending';
  createdAt: Date;
  updatedAt: Date;
}

export interface DocumentType {
  id: string;
  name: string;
  category: 'personal' | 'professional' | 'legal';
  validityPeriod: number;
  required: boolean;
  status: 'active' | 'inactive' | 'pending';
  createdAt: Date;
  updatedAt: Date;
}


export const adminSettingsService = {
  // Get system settings
  async getSettings(): Promise<SystemSettings> {
    try {
      const safeToDate = (v: unknown): Date | undefined => {
        try {
          if (!v) return undefined;
          if (v instanceof Date) return v;
          // Firestore Timestamp
          if (typeof v === 'object' && v !== null && typeof (v as { toDate?: () => Date }).toDate === 'function') {
            return (v as { toDate: () => Date }).toDate();
          }
          if (typeof v === 'string') {
            const d = new Date(v);
            return isNaN(d.getTime()) ? undefined : d;
          }
          return undefined;
        } catch {
          return undefined;
        }
      };

      // Fallback: Wenn Firebase nicht initialisiert ist oder serverseitig aufgerufen wird, liefere Defaults
      if (!db || typeof window === 'undefined') {
        return {
          systemName: 'Schichtklar',
          timezone: 'Europe/Berlin',
          language: 'de',
          currency: 'EUR',
          sessionTimeout: 30,
          maxLoginAttempts: 5,
          twoFactorRequired: false,
          emailNotifications: true,
          pushNotifications: true,
          smsNotifications: false,
          shiftReminders: true,
          documentExpiryWarnings: true,
          shiftConflictWarnings: true,
          systemUpdateNotifications: true,
          maintenanceNotifications: true,
        };
      }
      const q = query(collection(db, SETTINGS_COLLECTION), limit(1));
      const snapshot = await getDocs(q);
      
      if (snapshot.empty) {
        // Return default settings if none exist
        return {
          systemName: 'Schichtklar',
          timezone: 'Europe/Berlin',
          language: 'de',
          currency: 'EUR',
          sessionTimeout: 30,
          maxLoginAttempts: 5,
          twoFactorRequired: false,
          emailNotifications: true,
          pushNotifications: true,
          smsNotifications: false,
          shiftReminders: true,
          documentExpiryWarnings: true,
          shiftConflictWarnings: true,
          systemUpdateNotifications: true,
          maintenanceNotifications: true,
        };
      }

      const data = snapshot.docs[0].data();
      return {
        systemName: data.systemName || 'Schichtklar',
        timezone: data.timezone || 'Europe/Berlin',
        language: data.language || 'de',
        currency: data.currency || 'EUR',
        sessionTimeout: typeof data.sessionTimeout === 'number' ? data.sessionTimeout : 30,
        maxLoginAttempts: typeof data.maxLoginAttempts === 'number' ? data.maxLoginAttempts : 5,
        twoFactorRequired: data.twoFactorRequired === true,
        emailNotifications: data.emailNotifications !== false,
        pushNotifications: data.pushNotifications !== false,
        smsNotifications: data.smsNotifications === true,
        shiftReminders: data.shiftReminders !== false,
        documentExpiryWarnings: data.documentExpiryWarnings !== false,
        shiftConflictWarnings: data.shiftConflictWarnings !== false,
        systemUpdateNotifications: data.systemUpdateNotifications !== false,
        maintenanceNotifications: data.maintenanceNotifications !== false,
        lastBackup: safeToDate(data.lastBackup),
        backupSize: typeof data.backupSize === 'string' ? data.backupSize : undefined,
        availableBackups: typeof data.availableBackups === 'number' ? data.availableBackups : 0,
      };
    } catch (_error) {
      // Graceful Fallback bei fehlerhaften Datentypen
      return {
        systemName: 'Schichtklar',
        timezone: 'Europe/Berlin',
        language: 'de',
        currency: 'EUR',
        sessionTimeout: 30,
        maxLoginAttempts: 5,
        twoFactorRequired: false,
        emailNotifications: true,
        pushNotifications: true,
        smsNotifications: false,
        shiftReminders: true,
        documentExpiryWarnings: true,
        shiftConflictWarnings: true,
        systemUpdateNotifications: true,
        maintenanceNotifications: true,
      };
    }
  },

  // Update system settings
  async updateSettings(data: Partial<SystemSettings>): Promise<void> {
    if (!db) {
      throw new Error('Firestore nicht initialisiert');
    }
    try {
      const q = query(collection(db, SETTINGS_COLLECTION), limit(1));
      const snapshot = await getDocs(q);
      
      if (snapshot.empty) {
        // Create new settings document
        await addDoc(collection(db, SETTINGS_COLLECTION), {
          ...data,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        // Update existing settings document
        const docRef = doc(db, SETTINGS_COLLECTION, snapshot.docs[0].id);
        await updateDoc(docRef, {
          ...data,
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      throw error;
    }
  },

  // Get single role by id (für Berechtigungsprüfung; Nutzer mit customRoleId dürfen ihre Rolle lesen)
  async getRoleById(id: string): Promise<Role | null> {
    if (!db) return null;
    try {
      const roleRef = doc(db, ROLES_COLLECTION, id);
      const snap = await getDoc(roleRef);
      if (!snap.exists()) return null;
      const data = snap.data();
      return {
        id: snap.id,
        name: data.name,
        description: data.description,
        permissions: data.permissions || [],
        userCount: data.userCount || 0,
        status: data.status || 'active',
        createdAt: data.createdAt?.toDate() || new Date(),
        updatedAt: data.updatedAt?.toDate() || new Date(),
      };
    } catch {
      return null;
    }
  },

  // Get all roles
  async getRoles(): Promise<Role[]> {
    if (!db) {
      return [];
    }
    try {
      const q = query(
        collection(db, ROLES_COLLECTION),
        orderBy('name', 'asc')
      );

      const snapshot = await getDocs(q);
      const roles: Role[] = [];

      snapshot.forEach(doc => {
        const data = doc.data();
        roles.push({
          id: doc.id,
          name: data.name,
          description: data.description,
          permissions: data.permissions || [],
          userCount: data.userCount || 0,
          status: data.status || 'active',
          createdAt: data.createdAt?.toDate() || new Date(),
          updatedAt: data.updatedAt?.toDate() || new Date(),
        });
      });

      return roles;
    } catch (error) {
      throw error;
    }
  },

  // Create role
  async createRole(data: Omit<Role, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
    if (!db) {
      throw new Error('Firestore nicht initialisiert');
    }
    try {
      const roleData = {
        ...data,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      const docRef = await addDoc(collection(db, ROLES_COLLECTION), roleData);
      return docRef.id;
    } catch (error) {
      throw error;
    }
  },

  // Update role
  async updateRole(id: string, data: Partial<Role>): Promise<void> {
    if (!db) {
      throw new Error('Firestore nicht initialisiert');
    }
    try {
      const roleRef = doc(db, ROLES_COLLECTION, id);
      await updateDoc(roleRef, {
        ...data,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      throw error;
    }
  },

  // Delete role
  async deleteRole(id: string): Promise<void> {
    if (!db) {
      throw new Error('Firestore nicht initialisiert');
    }
    await deleteDoc(doc(db, ROLES_COLLECTION, id));
  },

  // Get all document types
  async getDocumentTypes(): Promise<DocumentType[]> {
    if (!db) {
      return [];
    }
    try {
      const q = query(
        collection(db, DOCUMENT_TYPES_COLLECTION),
        orderBy('name', 'asc')
      );

      const snapshot = await getDocs(q);
      const documentTypes: DocumentType[] = [];

      snapshot.forEach(doc => {
        const data = doc.data();
        documentTypes.push({
          id: doc.id,
          name: data.name,
          category: data.category,
          validityPeriod: data.validityPeriod || 365,
          required: data.required || false,
          status: data.status || 'active',
          createdAt: data.createdAt?.toDate() || new Date(),
          updatedAt: data.updatedAt?.toDate() || new Date(),
        });
      });

      return documentTypes;
    } catch (error) {
      throw error;
    }
  },

  // Create document type
  async createDocumentType(data: Omit<DocumentType, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
    if (!db) {
      throw new Error('Firestore nicht initialisiert');
    }
    try {
      const documentTypeData = {
        ...data,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      const docRef = await addDoc(collection(db, DOCUMENT_TYPES_COLLECTION), documentTypeData);
      return docRef.id;
    } catch (error) {
      throw error;
    }
  },

  // Update document type
  async updateDocumentType(id: string, data: Partial<DocumentType>): Promise<void> {
    if (!db) {
      throw new Error('Firestore nicht initialisiert');
    }
    try {
      const documentTypeRef = doc(db, DOCUMENT_TYPES_COLLECTION, id);
      await updateDoc(documentTypeRef, {
        ...data,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      throw error;
    }
  },

  // Delete document type
  async deleteDocumentType(id: string): Promise<void> {
    if (!db) {
      throw new Error('Firestore nicht initialisiert');
    }
    await deleteDoc(doc(db, DOCUMENT_TYPES_COLLECTION, id));
  },

  // Get system info
  /**
   * Liest den Status der täglichen Firestore-Sicherung
   * (geschrieben von der Scheduled Function scheduledFirestoreBackup nach
   * systemSettings/backupStatus). Die frühere clientseitige "Backup"-Funktion
   * erzeugte nur eine Metadatendatei und wurde deshalb entfernt – die echte
   * Sicherung läuft serverseitig als Firestore-Export in den Backup-Bucket.
   */
  async getBackupStatus(): Promise<{
    lastRunAt?: Date;
    lastSuccessAt?: Date;
    lastResult?: 'success' | 'error';
    lastError?: string;
    outputUriPrefix?: string;
    bucket?: string;
  } | null> {
    if (!db) {
      return null;
    }
    try {
      // Bewusst systemSettings (nicht SETTINGS_COLLECTION): Die Scheduled
      // Function schreibt den Status nach systemSettings/backupStatus.
      const statusDoc = await getDoc(doc(db, 'systemSettings', 'backupStatus'));
      if (!statusDoc.exists()) {
        return null;
      }
      const data = statusDoc.data();
      return {
        lastRunAt: data.lastRunAt?.toDate(),
        lastSuccessAt: data.lastSuccessAt?.toDate(),
        lastResult: data.lastResult,
        lastError: data.lastError,
        outputUriPrefix: data.outputUriPrefix,
        bucket: data.bucket,
      };
    } catch (error) {
      logger.error('Fehler beim Lesen des Sicherungsstatus', error instanceof Error ? error : new Error(String(error)));
      return null;
    }
  },

  // Get document type by ID
  async getDocumentTypeById(documentTypeId: string): Promise<DocumentType | null> {
    if (!db) {
      return null;
    }
    try {
      const documentTypeDoc = await getDoc(doc(db, DOCUMENT_TYPES_COLLECTION, documentTypeId));
      if (!documentTypeDoc.exists()) {
        return null;
      }

      const data = documentTypeDoc.data();
      return {
        id: documentTypeDoc.id,
        name: data.name,
        category: data.category,
        validityPeriod: data.validityPeriod || 365,
        required: data.required || false,
        status: data.status || 'active',
        createdAt: data.createdAt?.toDate() || new Date(),
        updatedAt: data.updatedAt?.toDate() || new Date(),
      };
    } catch (error) {
      throw error;
    }
  },

  // Export settings
  async exportSettings(): Promise<string> {
    try {
      const settings = await this.getSettings();
      const roles = await this.getRoles();
      const documentTypes = await this.getDocumentTypes();

      const exportData = {
        settings,
        roles,
        documentTypes,
        exportedAt: new Date().toISOString(),
        version: '1.0.0',
      };

      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      return url;
    } catch (error) {
      throw error;
    }
  },

  // Import settings
  async importSettings(file: File): Promise<void> {
    try {
      const text = await file.text();
      const importData = JSON.parse(text);

      // Validate import data
      if (!importData.settings || !importData.roles) {
        throw new Error('Ungültige Import-Datei');
      }

      // Import settings
      await this.updateSettings(importData.settings);

      // Import roles
      for (const role of importData.roles) {
        await this.createRole(role);
      }

      // Import document types
      if (importData.documentTypes) {
        for (const documentType of importData.documentTypes) {
          await this.createDocumentType(documentType);
        }
      }
    } catch (error) {
      throw error;
    }
  },
};
