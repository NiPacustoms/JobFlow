import { db, getDb } from '@/lib/firebase';
import { sanitizeUserUpdate } from '@/lib/utils/sanitize';
import { PaginatedResponse, User, UserUpdateForm } from '@/lib/types';

const DEFAULT_MONTHLY_HOURS = 173;

function roundAmount(value: number): number {
  return Math.round(value * 100) / 100;
}
import { logger } from '@/lib/logging';
import type { FirebaseError } from 'firebase/app';
import {
    addDoc,
    collection,
    doc,
    getDoc,
    getDocs,
    limit,
    orderBy,
    query,
    QueryConstraint,
    QueryDocumentSnapshot,
    QuerySnapshot,
    serverTimestamp,
    setDoc,
    updateDoc,
    where,
    startAfter,
    startAt,
    endAt,
} from 'firebase/firestore';
import { getCountFromServer } from 'firebase/firestore';
import { writeAuditLog } from '@/lib/services/auditLogService';
import { EncryptionService } from '@/lib/services/encryption';
import { getCompanyIdFromAuth, refreshTokenAndGetCompanyId } from '@/lib/utils/companyId';

const COLLECTION_NAME = 'users';

/** Notification-Einstellungen */
export type UserNotificationSettings = Partial<{
  emailNotifications: boolean;
  pushNotifications: boolean;
  shiftReminders: boolean;
  documentExpiry: boolean;
  systemAnnouncements: boolean;
}>;

export interface ActiveEmployee {
  id: string;
  name: string;
  role: User['role'];
  hourlyRate: number;
  baseSalary: number;
  paymentFrequency: 'monatlich' | 'stündlich';
  employmentType?: string;
  companyId?: string;
}

export const userService = {
  // Get user by ID
  async getById(id: string): Promise<User | null> {
    if (!db || typeof window === 'undefined') {
      logger.warn('Firebase not initialized or called server-side, returning empty result');
      return null;
    }
    try {
      const userDoc = await getDoc(doc(getDb(), COLLECTION_NAME, id));
      if (!userDoc.exists()) return null;

      const data = userDoc.data();
      
      // Robust timestamp conversion
      const getDate = (timestamp: unknown): Date => {
        if (!timestamp) return new Date();
        if (timestamp instanceof Date) return timestamp;
        if (typeof timestamp === 'object' && timestamp !== null && 'toDate' in timestamp && typeof (timestamp as { toDate?: () => Date }).toDate === 'function') {
          return (timestamp as { toDate: () => Date }).toDate();
        }
        return new Date();
      };

      return {
        id: userDoc.id,
        email: data.email,
        displayName: data.displayName,
        role: data.role,
        customRoleId: (data.customRoleId as string) || undefined,
        jobTitle: data.jobTitle || '',
        group: data.group || '',
        phone: data.phone,
        qualifications: data.qualifications || [],
        workingHoursPerWeek: data.workingHoursPerWeek || undefined,
        documents: data.documents || [],
        active: data.active !== undefined ? data.active : true,
        companyId: data.companyId || undefined,
        currentStatus: data.currentStatus || undefined,
        address: data.address || undefined,
        contact: data.contact || undefined,
        emergencyContact: data.emergencyContact || undefined,
        bankAccount: (() => {
          if (!data.bankAccount) return undefined;
          const ba = data.bankAccount as Record<string, unknown>;
          const bankAccount: User['bankAccount'] = {};
          
          // IBAN entschlüsseln, falls vorhanden
          if (ba.iban && typeof ba.iban === 'string') {
            try {
              // Prüfe, ob es verschlüsselt ist
              // Verschlüsselte IBANs sind Base64-Strings (länger, kein IBAN-Format)
              // Normale IBANs haben Format: DE89 3704 0044 0532 0130 00 (22 Zeichen ohne Leerzeichen)
              const isLikelyEncrypted = ba.iban.length > 30 && !ba.iban.match(/^[A-Z]{2}[0-9]{2}[A-Z0-9]{4,}/);
              
              if (isLikelyEncrypted) {
                // Versuche zu entschlüsseln
                try {
                  bankAccount.iban = EncryptionService.decryptIBAN(ba.iban);
                } catch (decryptError) {
                  // Falls Entschlüsselung fehlschlägt, könnte es ein anderes Format sein
                  // Versuche es als normale IBAN zu behandeln
                  logger.warn('Fehler beim Entschlüsseln der IBAN, versuche als normale IBAN: ' + (decryptError instanceof Error ? decryptError.message : String(decryptError)));
                  if (ba.iban.match(/^[A-Z]{2}[0-9]{2}[A-Z0-9]{4,}/)) {
                    bankAccount.iban = ba.iban;
                  }
                }
              } else {
                // Bereits entschlüsselt oder nicht verschlüsselt
                bankAccount.iban = ba.iban;
              }
            } catch (error) {
              logger.warn('Fehler beim Verarbeiten der IBAN', {}, { error: error instanceof Error ? error.message : String(error) });
              // Falls Verarbeitung fehlschlägt, IBAN nicht setzen
            }
          }
          
          if (ba.bic) bankAccount.bic = ba.bic as string;
          if (ba.bankName) bankAccount.bankName = ba.bankName as string;
          if (ba.accountHolder) bankAccount.accountHolder = ba.accountHolder as string;
          
          return Object.keys(bankAccount).length > 0 ? bankAccount : undefined;
        })(),
        education: data.education || undefined,
        driversLicense: data.driversLicense || undefined,
        preferences: data.preferences || undefined,
        notificationSettings: data.notificationSettings || {
          emailNotifications: true,
          pushNotifications: true,
          shiftReminders: true,
          documentExpiry: true,
          systemAnnouncements: true,
        },
        wochenstundenLimit: typeof data.wochenstundenLimit === 'number' ? data.wochenstundenLimit : undefined,
        aktuelleWochenstunden: typeof data.aktuelleWochenstunden === 'number' ? data.aktuelleWochenstunden : undefined,
        limitStatus: data.limitStatus === 'normal' || data.limitStatus === 'warning' || data.limitStatus === 'blocked' ? data.limitStatus : undefined,
        createdAt: getDate(data.createdAt),
        updatedAt: getDate(data.updatedAt),
      };
    } catch (error) {
      logger.error('Error in userService.getById', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  },

  async getUserNotificationSettings(uid: string): Promise<UserNotificationSettings | null> {
    if (!db || typeof window === 'undefined') return null;
    try {
      const userDoc = await getDoc(doc(getDb(), COLLECTION_NAME, uid));
      if (!userDoc.exists()) return null;
      const data = userDoc.data();
      return (data.notificationSettings as UserNotificationSettings) ?? null;
    } catch (error) {
      logger.warn('getUserNotificationSettings failed', {}, { uid, error: error instanceof Error ? error.message : String(error) });
      return null;
    }
  },

  async updateUserNotificationSettings(uid: string, settings: UserNotificationSettings): Promise<void> {
    if (!db) throw new Error('Firestore not initialized');
    const userRef = doc(getDb(), COLLECTION_NAME, uid);
    const userDoc = await getDoc(userRef);
    if (!userDoc.exists()) throw new Error('User-Dokument existiert nicht');
    const current = (userDoc.data().notificationSettings as UserNotificationSettings) ?? {};
    await updateDoc(userRef, {
      notificationSettings: { ...current, ...settings },
      updatedAt: serverTimestamp(),
    });
  },

  async getActiveEmployees(options: { companyId?: string; roles?: User['role'][] } = {}): Promise<ActiveEmployee[]> {
    if (!db || typeof window === 'undefined') {
      logger.warn('Firebase not initialized or called server-side, returning empty active employee list');
      return [];
    }

    const constraints: QueryConstraint[] = [where('active', '==', true)];

    if (options.companyId) {
      constraints.push(where('companyId', '==', options.companyId));
    }

    constraints.push(where('status', '==', 'active'));

    if (options.roles?.length) {
      const uniqueRoles = Array.from(new Set(options.roles)).slice(0, 10);
      if (uniqueRoles.length === 1) {
        constraints.push(where('role', '==', uniqueRoles[0]));
      } else if (uniqueRoles.length > 1) {
        constraints.push(where('role', 'in', uniqueRoles));
      }
    }

    const queryConstraints: QueryConstraint[] = [...constraints, orderBy('displayName', 'asc')];

    try {
      const snapshot = await getDocs(query(collection(getDb(), COLLECTION_NAME), ...queryConstraints));
      if (snapshot.empty) {
        return [];
      }

      const employees = snapshot.docs.map(docSnap => {
        const data = docSnap.data() as Record<string, unknown>;
        const hourlyRateFromUser = toNumber(data.hourlyRate);
        const baseSalaryFromUser = toNumber(data.baseSalary);

        let hourlyRate = hourlyRateFromUser;
        let baseSalary = baseSalaryFromUser;

        if (hourlyRate <= 0 && baseSalary > 0) {
          hourlyRate = baseSalary / DEFAULT_MONTHLY_HOURS;
        }
        if (baseSalary <= 0 && hourlyRate > 0) {
          baseSalary = hourlyRate * DEFAULT_MONTHLY_HOURS;
        }

        hourlyRate = roundAmount(hourlyRate);
        baseSalary = roundAmount(baseSalary);

        const paymentFrequency: 'monatlich' | 'stündlich' =
          hourlyRate > 0 ? 'stündlich' : 'monatlich';

        return {
          id: docSnap.id,
          name: (data.displayName as string) || (data.name as string) || (data.email as string) || docSnap.id,
          role: (data.role as User['role']) || 'nurse',
          hourlyRate,
          baseSalary,
          paymentFrequency,
          employmentType: undefined,
          companyId: (data.companyId as string) || undefined,
        } satisfies ActiveEmployee;
      });

      return employees;
    } catch (error) {
      const firebaseError = error as FirebaseError;
      if (firebaseError?.code === 'failed-precondition') {
        throw new Error(
          'Firestore Index für getActiveEmployees fehlt. Bitte Composite Index auf (active, status, displayName) anlegen.'
        );
      }

      if (error instanceof Error) {
        if (error.message.startsWith('Fehlende Stammdaten') || error.message.startsWith('Daten-Verstoß')) {
          throw error;
        }
        throw new Error(`Fehler beim Laden aktiver Mitarbeiter: ${error.message}`);
      }

      throw new Error('Fehler beim Laden aktiver Mitarbeiter');
    }
  },

  // Get all users with server-side filters and pagination (offset via cursors)
  async getAll(
    page = 1,
    pageSize = 50,
    filters?: {
      role?: User['role'] | 'all';
      status?: 'active' | 'inactive' | 'all';
      group?: string | 'all';
      active?: boolean; // alias for status
      search?: string; // client-seitig angewandt
      companyId?: string; // Filter nach Firma
    }
  ): Promise<PaginatedResponse<User>> {
    // Prüfe zuerst, ob wir serverseitig sind - das ist der wichtigste Check
    if (typeof window === 'undefined' || !db) {
      logger.warn('Firebase not initialized or called server-side, returning empty result');
      return { data: [], total: 0, page, limit: pageSize, hasMore: false };
    }
    try {
      // Wenn kein companyId-Filter übergeben wurde, hole es aus Auth
      let companyId = filters?.companyId;
      if (!companyId) {
        // Prüfe, ob wir im Browser sind (getCompanyIdFromAuth funktioniert nur im Browser)
        if (typeof window !== 'undefined') {
          companyId = await getCompanyIdFromAuth() || undefined;
          
          // Falls keine companyId gefunden wurde, versuche Token-Refresh
          // Dies kann helfen, wenn Custom Claims kürzlich aktualisiert wurden
          if (!companyId) {
            if (process.env.NODE_ENV === 'development') {
              logger.debug('[users.getAll] No companyId found, attempting token refresh...');
            }
            companyId = await refreshTokenAndGetCompanyId() || undefined;
          }
        } else {
          // Serverseitig: companyId muss über Filter übergeben werden
          logger.warn('[users.getAll] Called server-side without companyId filter. Returning empty result.');
        }
      }

      // WICHTIG: Wenn keine companyId gefunden wird, können wir nicht sicher filtern
      // Die Firestore Rules erlauben nur Zugriff auf Users der eigenen Company
      // Daher müssen wir früh zurückkehren, um Permission-Denied-Fehler zu vermeiden
      if (!companyId) {
        const errorMsg = 'No companyId found in filters or auth. Cannot fetch users without companyId due to security rules.';
        logger.warn(`[users.getAll] ${errorMsg}`);
        if (process.env.NODE_ENV === 'development') {
          logger.debug('[users.getAll] This may indicate that Custom Claims need to be synced via Cloud Function.');
        }
        return { data: [], total: 0, page, limit: pageSize, hasMore: false };
      }

      const constraints: QueryConstraint[] = [];
      // Filters
      if (filters?.role && filters.role !== 'all') {
        constraints.push(where('role', '==', filters.role));
      }
      if (filters?.status && filters.status !== 'all') {
        constraints.push(where('active', '==', filters.status === 'active'));
      }
      if (typeof filters?.active === 'boolean') {
        constraints.push(where('active', '==', filters.active));
      }
      if (filters?.group && filters.group !== 'all') {
        constraints.push(where('group', '==', filters.group));
      }
      // companyId ist immer erforderlich
      constraints.push(where('companyId', '==', companyId));

      const colRef = collection(getDb(), COLLECTION_NAME);

      // Determine ordering and optional prefix search
      const hasSearch = !!(filters?.search && filters.search.trim());
      const searchValue = (filters?.search || '').trim();
      const searchEnd = hasSearch ? `${searchValue}\uf8ff` : undefined;

      // Build base queries for count and data
      let countQuery;
      let dataBaseQuery;

      if (hasSearch) {
        // Prefix-Search über displayName
        dataBaseQuery = query(colRef, ...constraints, orderBy('displayName', 'asc'));
        countQuery = query(colRef, ...constraints, orderBy('displayName', 'asc'), startAt(searchValue), endAt(searchEnd!));
      } else {
        dataBaseQuery = query(colRef, ...constraints, orderBy('createdAt', 'desc'));
        countQuery = query(colRef, ...constraints);
      }

      // Total via Firestore aggregation count (ohne clientseitige Suche; bei Suche: Prefix-Range)
      let total = 0;
      try {
        const totalSnapshot = await getCountFromServer(hasSearch ? countQuery : query(colRef, ...constraints));
        total = totalSnapshot.data().count || 0;
      } catch (error: unknown) {
        // Spezielle Behandlung für permission-denied Fehler
        const firebaseError = error as { code?: string; message?: string } | null;
        if (firebaseError?.code === 'permission-denied') {
          logger.error('[users.getAll] Permission denied for aggregation query. This may indicate: Missing companyId in token or Firestore Rules issue. companyId: ' + (companyId || 'not set') + '. Ensure Custom Claims are synced and token is refreshed');
          // Versuche Token-Refresh und erneute Query (nur einmal)
          if (companyId && typeof window !== 'undefined') {
            try {
              await refreshTokenAndGetCompanyId();
              const retrySnapshot = await getCountFromServer(hasSearch ? countQuery : query(colRef, ...constraints));
              total = retrySnapshot.data().count || 0;
              if (process.env.NODE_ENV === 'development') {
                logger.debug('[users.getAll] Retry after token refresh succeeded');
              }
            } catch (retryError) {
              logger.error('[users.getAll] Retry after token refresh failed', retryError instanceof Error ? retryError : new Error(String(retryError)));
              throw error; // Wirf den ursprünglichen Fehler
            }
          } else {
            throw error;
          }
        } else {
          throw error;
        }
      }

      // Pagination using startAfter cursor
      let cursorDoc: unknown = null;
      // For search, we need to apply startAt before pagination on the first page
      if (hasSearch) {
        // Preload first window starting at searchValue
        const firstPageSnap = await getDocs(query(dataBaseQuery, startAt(searchValue), endAt(searchEnd!), limit(pageSize)));
        if (page <= 1) {
          // Map directly below
          const usersFirst = firstPageSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));
          const users: User[] = usersFirst.map((row: Record<string, unknown>) => ({
            id: row.id as string,
            email: row.email as string,
            displayName: row.displayName as string,
            role: row.role as User['role'],
            customRoleId: (row.customRoleId as string) || undefined,
            jobTitle: (row.jobTitle as string) || '',
            group: (row.group as string) || '',
            phone: row.phone as string,
            qualifications: (row.qualifications as string[]) || [],
            workingHoursPerWeek: (row.workingHoursPerWeek as number) || undefined,
            documents: (row.documents as string[]) || [],
            active: row.active !== undefined ? (row.active as boolean) : true,
            address: (row.address as Record<string, unknown>) || undefined,
            contact: (row.contact as Record<string, unknown>) || undefined,
            emergencyContact: (row.emergencyContact as Record<string, unknown>) || undefined,
            bankAccount: (row.bankAccount as Record<string, unknown>) || undefined,
            education: (row.education as Record<string, unknown>) || undefined,
            driversLicense: (row.driversLicense as Record<string, unknown>) || undefined,
            notificationSettings: (row.notificationSettings as {
              emailNotifications?: boolean;
              pushNotifications?: boolean;
              shiftReminders?: boolean;
              documentExpiry?: boolean;
              systemAnnouncements?: boolean;
            }) || {
              emailNotifications: true,
              pushNotifications: true,
              shiftReminders: true,
              documentExpiry: true,
              systemAnnouncements: true,
            },
            wochenstundenLimit: typeof row.wochenstundenLimit === 'number' ? row.wochenstundenLimit : undefined,
            aktuelleWochenstunden: typeof row.aktuelleWochenstunden === 'number' ? row.aktuelleWochenstunden : undefined,
            limitStatus: row.limitStatus === 'normal' || row.limitStatus === 'warning' || row.limitStatus === 'blocked' ? row.limitStatus : undefined,
            createdAt: (row as { createdAt?: { toDate?: () => Date } | Date }).createdAt && (row as { createdAt?: { toDate?: () => Date } }).createdAt?.toDate ? (row as { createdAt: { toDate: () => Date } }).createdAt.toDate() : ((row as { createdAt?: Date }).createdAt || new Date()),
            updatedAt: (row as { updatedAt?: { toDate?: () => Date } | Date }).updatedAt && (row as { updatedAt?: { toDate?: () => Date } }).updatedAt?.toDate ? (row as { updatedAt: { toDate: () => Date } }).updatedAt.toDate() : ((row as { updatedAt?: Date }).updatedAt || new Date()),
          } as User));

          return {
            data: users,
            total,
            page,
            limit: pageSize,
            hasMore: users.length === pageSize,
          };
        } else {
          // Advance cursors page-1 times
          cursorDoc = firstPageSnap.docs[firstPageSnap.docs.length - 1] || null;
          for (let i = 2; i <= page; i++) {
            if (!cursorDoc) break;
            const snap = await getDocs(query(dataBaseQuery, startAt(searchValue), endAt(searchEnd!), startAfter(cursorDoc), limit(pageSize)));
            cursorDoc = snap.docs[snap.docs.length - 1] || cursorDoc;
            if (i === page) {
              const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));
              const users: User[] = rows.map((row: Record<string, unknown>) => ({
                id: row.id as string,
                email: row.email as string,
                displayName: row.displayName as string,
                role: row.role as User['role'],
                jobTitle: (row.jobTitle as string) || '',
                group: (row.group as string) || '',
                phone: row.phone as string,
                qualifications: (row.qualifications as string[]) || [],
                documents: (row.documents as string[]) || [],
                active: row.active !== undefined ? (row.active as boolean) : true,
                address: (row.address as Record<string, unknown>) || undefined,
                contact: (row.contact as Record<string, unknown>) || undefined,
                emergencyContact: (row.emergencyContact as Record<string, unknown>) || undefined,
                bankAccount: (row.bankAccount as Record<string, unknown>) || undefined,
                education: (row.education as Record<string, unknown>) || undefined,
                driversLicense: (row.driversLicense as Record<string, unknown>) || undefined,
                notificationSettings: (row.notificationSettings as {
                  emailNotifications?: boolean;
                  pushNotifications?: boolean;
                  shiftReminders?: boolean;
                  documentExpiry?: boolean;
                  systemAnnouncements?: boolean;
                }) || {
                  emailNotifications: true,
                  pushNotifications: true,
                  shiftReminders: true,
                  documentExpiry: true,
                  systemAnnouncements: true,
                },
                wochenstundenLimit: typeof row.wochenstundenLimit === 'number' ? row.wochenstundenLimit : undefined,
                aktuelleWochenstunden: typeof row.aktuelleWochenstunden === 'number' ? row.aktuelleWochenstunden : undefined,
                limitStatus: row.limitStatus === 'normal' || row.limitStatus === 'warning' || row.limitStatus === 'blocked' ? row.limitStatus : undefined,
                createdAt: (row.createdAt && typeof row.createdAt === 'object' && 'toDate' in row.createdAt) ? (row.createdAt as { toDate: () => Date }).toDate() : (row.createdAt ? new Date(row.createdAt as string | Date) : new Date()),
                updatedAt: (row.updatedAt && typeof row.updatedAt === 'object' && 'toDate' in row.updatedAt) ? (row.updatedAt as { toDate: () => Date }).toDate() : (row.updatedAt ? new Date(row.updatedAt as string | Date) : new Date()),
              } as User));
              return {
                data: users,
                total,
                page,
                limit: pageSize,
                hasMore: users.length === pageSize,
              };
            }
          }
        }
      }

      // Non-search pagination by startAfter.
      // WICHTIG: In jeder Zwischen-Query muss limit(pageSize) gesetzt sein (sonst wird
      // die komplette Collection gelesen) und der finale Read muss den in der Schleife
      // aufgebauten Cursor verwenden – vorher wurde fälschlich `cursorDoc` (nur im
      // Suchpfad belegt, hier immer null) benutzt, wodurch JEDE Seite > 1 wieder
      // Seite 1 lieferte.
      let snapForPage: QuerySnapshot;
      if (page <= 1) {
        snapForPage = await getDocs(query(dataBaseQuery, limit(pageSize)));
      } else {
        let cursor: QueryDocumentSnapshot | null = null;
        for (let i = 1; i < page; i++) {
          const snap: QuerySnapshot = await getDocs(
            cursor
              ? query(dataBaseQuery, startAfter(cursor), limit(pageSize))
              : query(dataBaseQuery, limit(pageSize))
          );
          if (snap.empty) {
            cursor = null;
            break;
          }
          cursor = snap.docs[snap.docs.length - 1];
          // Weniger Treffer als eine volle Seite ⇒ es gibt keine weitere Seite.
          if (snap.docs.length < pageSize) {
            cursor = null;
            break;
          }
        }
        snapForPage = cursor
          ? await getDocs(query(dataBaseQuery, startAfter(cursor), limit(pageSize)))
          : ({ docs: [], empty: true } as unknown as QuerySnapshot);
      }

      const current = snapForPage.docs.map((d: QueryDocumentSnapshot) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));

      // Map to User
      const users: User[] = current.map((row: Record<string, unknown>) => ({
        id: row.id as string,
        email: row.email as string,
        displayName: row.displayName as string,
        role: row.role as User['role'],
        customRoleId: (row.customRoleId as string) || undefined,
        jobTitle: (row.jobTitle as string) || '',
        group: (row.group as string) || '',
        phone: row.phone as string,
        qualifications: (row.qualifications as string[]) || [],
        workingHoursPerWeek: (row.workingHoursPerWeek as number) || undefined,
        wochenstundenLimit: typeof row.wochenstundenLimit === 'number' ? row.wochenstundenLimit : undefined,
        aktuelleWochenstunden: typeof row.aktuelleWochenstunden === 'number' ? row.aktuelleWochenstunden : undefined,
        limitStatus: row.limitStatus === 'normal' || row.limitStatus === 'warning' || row.limitStatus === 'blocked' ? row.limitStatus : undefined,
        documents: (row.documents as string[]) || [],
        active: row.active !== undefined && row.active !== null ? Boolean(row.active) : true,
        address: (row.address as Record<string, unknown>) || undefined,
        contact: (row.contact as Record<string, unknown>) || undefined,
        emergencyContact: (row.emergencyContact as Record<string, unknown>) || undefined,
        bankAccount: (row.bankAccount as Record<string, unknown>) || undefined,
        education: (row.education as Record<string, unknown>) || undefined,
        driversLicense: (row.driversLicense as Record<string, unknown>) || undefined,
        notificationSettings: (row.notificationSettings && typeof row.notificationSettings === 'object' ? {
          emailNotifications: (row.notificationSettings as { emailNotifications?: boolean }).emailNotifications ?? true,
          pushNotifications: (row.notificationSettings as { pushNotifications?: boolean }).pushNotifications ?? true,
          shiftReminders: (row.notificationSettings as { shiftReminders?: boolean }).shiftReminders ?? true,
          documentExpiry: (row.notificationSettings as { documentExpiry?: boolean }).documentExpiry ?? true,
          systemAnnouncements: (row.notificationSettings as { systemAnnouncements?: boolean }).systemAnnouncements ?? true,
        } : {
          emailNotifications: true,
          pushNotifications: true,
          shiftReminders: true,
          documentExpiry: true,
          systemAnnouncements: true,
        }),
        createdAt: (row.createdAt && typeof row.createdAt === 'object' && 'toDate' in row.createdAt) ? (row.createdAt as { toDate: () => Date }).toDate() : (row.createdAt ? new Date(row.createdAt as string | Date) : new Date()),
        updatedAt: (row.updatedAt && typeof row.updatedAt === 'object' && 'toDate' in row.updatedAt) ? (row.updatedAt as { toDate: () => Date }).toDate() : (row.updatedAt ? new Date(row.updatedAt as string | Date) : new Date()),
      }));

      return {
        data: users,
        total,
        page,
        limit: pageSize,
        hasMore: users.length === pageSize,
      };
    } catch (error) {
      throw error;
    }
  },

  // Get users by role
  async getByRole(role: User['role']): Promise<User[]> {
    if (!db || typeof window === 'undefined') {
      logger.warn('Firebase not initialized or called server-side, returning empty result');
      return [];
    }
    try {
      const q = query(
        collection(getDb(), COLLECTION_NAME),
        where('role', '==', role),
        orderBy('displayName', 'asc')
      );

      const snapshot = await getDocs(q);
      const users: User[] = [];

      snapshot.forEach(doc => {
        const data = doc.data();
        users.push({
          id: doc.id,
          email: data.email,
          displayName: data.displayName,
          role: data.role,
          customRoleId: (data.customRoleId as string) || undefined,
          jobTitle: data.jobTitle || '',
          group: data.group || '',
          phone: data.phone,
        qualifications: data.qualifications || [],
          workingHoursPerWeek: data.workingHoursPerWeek || undefined,
          documents: data.documents || [],
          active: data.active !== undefined ? data.active : true,
          address: data.address || undefined,
          contact: data.contact || undefined,
          emergencyContact: data.emergencyContact || undefined,
          bankAccount: data.bankAccount || undefined,
          education: data.education || undefined,
          driversLicense: data.driversLicense || undefined,
          notificationSettings: data.notificationSettings || {
            emailNotifications: true,
            pushNotifications: true,
            shiftReminders: true,
            documentExpiry: true,
            systemAnnouncements: true,
          },
          createdAt: data.createdAt?.toDate() || new Date(),
          updatedAt: data.updatedAt?.toDate() || new Date(),
        });
      });

      return users;
    } catch (error) {
      throw error;
    }
  },

  // Get users by status
  async getByStatus(status: string): Promise<User[]> {
    if (!db || typeof window === 'undefined') {
      logger.warn('Firebase not initialized or called server-side, returning empty result');
      return [];
    }
    try {
      const q = query(
        collection(getDb(), COLLECTION_NAME),
        where('currentStatus', '==', status),
        orderBy('displayName', 'asc')
      );

      const snapshot = await getDocs(q);
      const users: User[] = [];

      snapshot.forEach(doc => {
        const data = doc.data();
        users.push({
          id: doc.id,
          email: data.email,
          displayName: data.displayName,
          role: data.role,
          customRoleId: (data.customRoleId as string) || undefined,
          phone: data.phone,
        qualifications: data.qualifications || [],
          workingHoursPerWeek: data.workingHoursPerWeek || undefined,
          documents: data.documents || [],
          active: data.active !== undefined ? data.active : true,
          currentStatus: data.currentStatus,
          address: data.address || undefined,
          contact: data.contact || undefined,
          emergencyContact: data.emergencyContact || undefined,
          bankAccount: data.bankAccount || undefined,
          education: data.education || undefined,
          driversLicense: data.driversLicense || undefined,
          notificationSettings: data.notificationSettings || {
            emailNotifications: true,
            pushNotifications: true,
            shiftReminders: true,
            documentExpiry: true,
            systemAnnouncements: true,
          },
          createdAt: data.createdAt?.toDate() || new Date(),
          updatedAt: data.updatedAt?.toDate() || new Date(),
        });
      });

      return users;
    } catch (error) {
      throw error;
    }
  },

  // Get available users for shift assignment
  async getAvailableForShift(filters: {
    search?: string;
    role?: string;
    excludeAssigned?: boolean;
    shiftId?: string;
  } = {}): Promise<User[]> {
    if (!db || typeof window === 'undefined') {
      logger.warn('Firebase not initialized or called server-side, returning empty result');
      return [];
    }
    try {
      let q = query(collection(getDb(), COLLECTION_NAME));

      // Filter by role
      if (filters.role) {
        q = query(q, where('role', '==', filters.role));
      }

      // Filter by active status
      q = query(q, where('active', '==', true));

      const snapshot = await getDocs(q);
      const users: User[] = [];

      snapshot.forEach(doc => {
        const data = doc.data();
        users.push({
          id: doc.id,
          email: data.email,
          displayName: data.displayName,
          role: data.role,
          phone: data.phone,
          qualifications: data.qualifications || [],
          workingHoursPerWeek: data.workingHoursPerWeek || undefined,
          documents: data.documents || [],
          active: data.active !== undefined ? data.active : true,
          address: data.address || undefined,
          contact: data.contact || undefined,
          emergencyContact: data.emergencyContact || undefined,
          bankAccount: data.bankAccount || undefined,
          education: data.education || undefined,
          driversLicense: data.driversLicense || undefined,
          notificationSettings: data.notificationSettings || {
            emailNotifications: true,
            pushNotifications: true,
            shiftReminders: true,
            documentExpiry: true,
            systemAnnouncements: true,
          },
          createdAt: data.createdAt?.toDate() || new Date(),
          updatedAt: data.updatedAt?.toDate() || new Date(),
        });
      });

      // Filter by search term (client-side for now)
      let filteredUsers = users;
      if (filters.search) {
        const searchTerm = filters.search.toLowerCase();
        filteredUsers = users.filter(user => 
          user.displayName.toLowerCase().includes(searchTerm) ||
          user.email.toLowerCase().includes(searchTerm) ||
          (user.jobTitle ? user.jobTitle.toLowerCase().includes(searchTerm) : false)
        );
      }

      // Optional V2: excludeAssigned – bereits zugewiesene User für Zeitfenster aus Assignments filtern.

      return filteredUsers;
    } catch (error) {
      throw error;
    }
  },

  // Update user
  async update(id: string, data: Partial<UserUpdateForm>): Promise<void> {
    if (!db || typeof window === 'undefined') {
      throw new Error('Firebase not initialized or called server-side');
    }
    try {
      // Sanitize eingehende Freitextfelder gegen Stored XSS
      const safeData = sanitizeUserUpdate(data as Record<string, unknown>);
      const userRef = doc(getDb(), COLLECTION_NAME, id);
      await updateDoc(userRef, {
        ...safeData,
        updatedAt: serverTimestamp(),
      });
      try {
        const userDoc = await getDoc(doc(getDb(), COLLECTION_NAME, id));
        const userCompanyId = userDoc.exists() ? (userDoc.data() as Partial<User> & { companyId?: string }).companyId ?? null : null;
        await writeAuditLog({
          actorUid: (await import('firebase/auth')).getAuth().currentUser?.uid || 'unknown',
          companyId: userCompanyId || await (await import('@/lib/utils/companyId')).getCompanyIdFromAuth() || 'unknown',
          action: 'user.update',
          target: { collection: COLLECTION_NAME, id },
          after: { ...safeData },
        });
      } catch (_err) { void 0; }
    } catch (error) {
      throw error;
    }
  },

  // Update user role (admin only)
  async updateRole(id: string, role: User['role']): Promise<void> {
    if (!db || typeof window === 'undefined') {
      throw new Error('Firebase not initialized or called server-side');
    }
    try {
      const userRef = doc(getDb(), COLLECTION_NAME, id);
      await updateDoc(userRef, {
        role,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      throw error;
    }
  },

  // Toggle active status
  async toggleActive(id: string, active: boolean): Promise<void> {
    if (!db || typeof window === 'undefined') {
      throw new Error('Firebase not initialized or called server-side');
    }
    try {
      const userRef = doc(getDb(), COLLECTION_NAME, id);
      await updateDoc(userRef, {
        active,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      throw error;
    }
  },

  // Create user (admin only)
  async create(userData: Partial<User>): Promise<User> {
    if (!db || typeof window === 'undefined') {
      throw new Error('Firebase not initialized or called server-side');
    }
    try {
      const docRef = await addDoc(collection(getDb(), COLLECTION_NAME), {
        email: userData.email,
        displayName: userData.displayName,
        role: userData.role || 'nurse',
        jobTitle: userData.jobTitle || '',
        group: userData.group || '',
        phone: userData.phone || '',
        qualifications: userData.qualifications || [],
        workingHoursPerWeek: userData.workingHoursPerWeek || undefined,
        documents: userData.documents || [],
        active: userData.active !== undefined ? userData.active : true,
        address: userData.address || {},
        contact: userData.contact || {},
        emergencyContact: userData.emergencyContact || {},
        bankAccount: userData.bankAccount || {},
        education: userData.education || {},
        driversLicense: userData.driversLicense || {},
        notificationSettings: userData.notificationSettings || {
          emailNotifications: true,
          pushNotifications: true,
          shiftReminders: true,
          documentExpiry: true,
          systemAnnouncements: true,
        },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      try {
        await writeAuditLog({
          actorUid: (await import('firebase/auth')).getAuth().currentUser?.uid || 'unknown',
          companyId: userData.companyId || await (await import('@/lib/utils/companyId')).getCompanyIdFromAuth() || 'unknown',
          action: 'user.create',
          target: { collection: COLLECTION_NAME, id: docRef.id },
          after: {
            email: userData.email,
            displayName: userData.displayName,
            role: userData.role || 'nurse',
            jobTitle: userData.jobTitle || '',
            group: userData.group || '',
            phone: userData.phone || '',
            qualifications: userData.qualifications || [],
            active: userData.active !== undefined ? userData.active : true,
          },
        });
      } catch (_err) { void 0; }

      return {
        id: docRef.id,
        email: userData.email!,
        displayName: userData.displayName!,
        role: userData.role || 'nurse',
        jobTitle: userData.jobTitle || '',
        group: userData.group || '',
        phone: userData.phone,
        qualifications: userData.qualifications || [],
        workingHoursPerWeek: userData.workingHoursPerWeek || undefined,
        documents: userData.documents || [],
        active: userData.active !== undefined ? userData.active : true,
        address: userData.address || {},
        contact: userData.contact || {},
        emergencyContact: userData.emergencyContact || {},
        bankAccount: userData.bankAccount || {},
        education: userData.education || {},
        driversLicense: userData.driversLicense || {},
        notificationSettings: userData.notificationSettings || {
          emailNotifications: true,
          pushNotifications: true,
          shiftReminders: true,
          documentExpiry: true,
          systemAnnouncements: true,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    } catch (error) {
      throw error;
    }
  },

  // Delete user (admin only)
  // Löscht sowohl Firestore-Dokument als auch Firebase Auth User
  async delete(id: string): Promise<void> {
    if (!db || typeof window === 'undefined') {
      throw new Error('Firebase not initialized or called server-side');
    }

    // Hole Auth-Token für API-Aufruf
    const { auth } = await import('@/lib/firebase');
    if (!auth) {
      throw new Error('Firebase Auth not initialized');
    }
    if (!auth.currentUser) {
      throw new Error('User must be authenticated to delete users');
    }

    const token = await auth.currentUser.getIdToken();

    // Rufe API-Route auf, die sowohl Firestore als auch Firebase Auth löscht
    const response = await fetch(`/api/users/${id}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new Error(errorBody.message || `HTTP ${response.status}`);
    }

    const result = await response.json();
    if (!result.ok) {
      throw new Error(result.message || 'Failed to delete user');
    }
  },

  // Restore user (wiederherstellen nach Löschung)
  async restore(id: string, prevData: User): Promise<void> {
    if (!db || typeof window === 'undefined') {
      throw new Error('Firebase not initialized or called server-side');
    }
    try {
      const userRef = doc(getDb(), COLLECTION_NAME, id);
      // companyId MUSS mitgeschrieben werden – sonst ist der wiederhergestellte
      // Mitarbeiter für alle nach companyId gefilterten Admin-Queries unsichtbar.
      const restoredCompanyId =
        prevData.companyId ||
        (await (await import('@/lib/utils/companyId')).getCompanyIdFromAuth()) ||
        undefined;
      await setDoc(userRef, {
        ...(restoredCompanyId ? { companyId: restoredCompanyId } : {}),
        email: prevData.email,
        displayName: prevData.displayName,
        role: prevData.role,
        jobTitle: prevData.jobTitle || '',
        group: prevData.group || '',
        phone: prevData.phone || '',
        qualifications: prevData.qualifications || [],
        workingHoursPerWeek: prevData.workingHoursPerWeek || undefined,
        documents: prevData.documents || [],
        active: prevData.active !== undefined ? prevData.active : true,
        address: prevData.address || undefined,
        contact: prevData.contact || undefined,
        emergencyContact: prevData.emergencyContact || undefined,
        bankAccount: prevData.bankAccount || undefined,
        education: prevData.education || undefined,
        driversLicense: prevData.driversLicense || undefined,
        notificationSettings: prevData.notificationSettings || {
          emailNotifications: true,
          pushNotifications: true,
          shiftReminders: true,
          documentExpiry: true,
          systemAnnouncements: true,
        },
        createdAt: prevData.createdAt ? (prevData.createdAt instanceof Date ? prevData.createdAt : new Date(prevData.createdAt)) : serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      try {
        await writeAuditLog({
          actorUid: (await import('firebase/auth')).getAuth().currentUser?.uid || 'unknown',
          companyId: prevData.companyId || await (await import('@/lib/utils/companyId')).getCompanyIdFromAuth() || 'unknown',
          action: 'user.restore',
          target: { collection: COLLECTION_NAME, id },
          after: { ...prevData },
        });
      } catch (_err) { void 0; }
    } catch (error) {
      throw error;
    }
  },
};

function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.replace(',', '.');
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}
