import { db, getDb, auth, functions } from '@/lib/firebase';
import { ValidationError, ErrorCode, createAppError } from '@/lib/errors';
import { offlineQueueService } from './offlineQueue';
import { getCompanyIdFromAuth } from '@/lib/utils/companyId';
import { logger } from '@/lib/logging';
import { computeNetHours } from './timesheets/computeNetHours';

// Timesheet Interface - sollte mit lib/types/index.ts kompatibel sein
// Verwende das Timesheet aus lib/types für Konsistenz
import type { Timesheet as TimesheetType } from '@/lib/types';

// Erweitere das Timesheet Interface um zusätzliche Felder, die nur im Service verwendet werden
export interface Timesheet extends TimesheetType {
  overtimeHours?: number;
  regularHours?: number;
  breaks?: Break[]; // Array of breaks during work
  location?: {
    latitude: number;
    longitude: number;
    address?: string;
  };
}

export interface TimesheetAggregation {
  userId: string;
  totalHours: number;
  approvedHours: number;
  overtimeHours: number;
  nightHours: number;
  weekendHours: number;
  holidayHours: number;
}

export interface TimesheetRangeMetadata {
  userId?: string;
  startDate: Date;
  endDate: Date;
  approvedOnly: boolean;
}

export interface TimesheetRangeResult {
  timesheets: Timesheet[];
  aggregates: TimesheetAggregation[];
  metadata: TimesheetRangeMetadata;
}

export interface Break {
  id: string;
  startTime: string;
  endTime?: string;
  duration?: number; // in minutes
  reason?: string;
  createdAt: Date;
}

export interface TimesheetForm {
  date: Date;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  notes?: string;
  facilityId?: string;
  station?: string;
  location?: {
    latitude: number;
    longitude: number;
    address?: string;
  };
}
// Firestore raw data shape for a Timesheet document
type FirestoreTimesheetData = {
  userId: string;
  companyId?: string; // Mandantenzugehörigkeit
  date?: { toDate: () => Date };
  startDate?: { toDate: () => Date };
  endDate?: { toDate: () => Date };
  startTime: string;
  endTime: string;
  breakMinutes?: number;
  totalHours?: number;
  nightHours?: number;
  weekendHours?: number;
  holidayHours?: number;
  overtimeHours?: number;
  regularHours?: number;
  notes?: string;
  status?: Timesheet['status'];
  submittedAt?: { toDate: () => Date };
  approvedAt?: { toDate: () => Date };
  approvedBy?: string;
  rejectionReason?: string;
  breaks?: Break[];
  facilityId?: string;
  station?: string;
  location?: {
    latitude: number;
    longitude: number;
    address?: string;
  };
  createdAt?: { toDate: () => Date };
  updatedAt?: { toDate: () => Date };
  // Signature fields
  employeeSignatureUrl?: string;
  employeeSignedAt?: { toDate: () => Date };
  facilitySignatureUrl?: string;
  facilitySignedAt?: { toDate: () => Date };
  facilitySignedBy?: string;
  facilityConfirmationStatus?: 'performed' | 'aborted' | 'no-show';
  facilitySignerName?: string;
  facilityNotes?: string;
};

const DEFAULT_DECIMALS = 2;

function roundToDecimals(value: number, decimals: number = DEFAULT_DECIMALS): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

function formatDateTime(date: Date): string {
  return date.toLocaleString('de-DE', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function ensureValidDate(value: Date | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const time = value.getTime();
  if (Number.isNaN(time)) {
    return null;
  }
  return new Date(time);
}

type TimesheetInterval = {
  start: Date;
  end: Date;
};

function getTimesheetInterval(timesheet: Timesheet): TimesheetInterval | null {
  let start = ensureValidDate(timesheet.startDate) ?? ensureValidDate(timesheet.date);
  if (!start) {
    return null;
  }

  // Uhrzeiten anwenden: ohne startTime/endTime landeten früher alle
  // Timesheets eines Tages auf [Mitternacht, Mitternacht+totalHours] und
  // kollidierten fälschlich (z. B. geteilter Dienst 06–10 und 14–18).
  const applyTime = (base: Date, hhmm?: string): Date | null => {
    if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return null;
    const [h, m] = hhmm.split(':').map(Number);
    const d = new Date(base);
    d.setHours(h, m, 0, 0);
    return d;
  };

  const startWithTime = applyTime(start, timesheet.startTime);
  if (startWithTime) start = startWithTime;

  let end = ensureValidDate(timesheet.endDate);
  if (!end || end <= start) {
    const endWithTime = applyTime(start, timesheet.endTime);
    if (endWithTime) {
      end = endWithTime;
      // Overnight: Ende vor Start → Folgetag
      if (end <= start) end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
    } else {
      const totalHours = Number.isFinite(timesheet.totalHours) ? timesheet.totalHours : 0;
      end = new Date(start.getTime() + Math.max(totalHours, 0) * 60 * 60 * 1000);
    }
  }

  return { start, end };
}

function detectTimesheetOverlaps(timesheets: Timesheet[]): string[] {
  const conflicts: string[] = [];
  const groupedByUser = new Map<string, Timesheet[]>();

  for (const sheet of timesheets) {
    if (!groupedByUser.has(sheet.userId)) {
      groupedByUser.set(sheet.userId, []);
    }
    groupedByUser.get(sheet.userId)!.push(sheet);
  }

  for (const [userId, list] of groupedByUser.entries()) {
    const sorted = [...list].sort((a, b) => {
      const intervalA = getTimesheetInterval(a);
      const intervalB = getTimesheetInterval(b);
      if (!intervalA || !intervalB) {
        return 0;
      }
      return intervalA.start.getTime() - intervalB.start.getTime();
    });

    let previousInterval: TimesheetInterval | null = null;
    let previousSheet: Timesheet | null = null;

    for (const sheet of sorted) {
      const interval = getTimesheetInterval(sheet);
      if (!interval) {
        conflicts.push(`Zeiterfassung ${sheet.id} für Nutzer ${userId} enthält ungültige Zeitangaben.`);
        continue;
      }

      if (interval.end <= interval.start) {
        conflicts.push(
          `Zeiterfassung ${sheet.id} für Nutzer ${userId} hat eine Endzeit vor oder gleich der Startzeit (${formatDateTime(
            interval.start
          )} – ${formatDateTime(interval.end)}).`
        );
        continue;
      }

      if (previousInterval && previousSheet && interval.start < previousInterval.end) {
        conflicts.push(
          `Zeiterfassungskonflikt für Nutzer ${userId}: ${previousSheet.id} (${formatDateTime(
            previousInterval.start
          )} – ${formatDateTime(previousInterval.end)}) überschneidet sich mit ${sheet.id} (${formatDateTime(
            interval.start
          )} – ${formatDateTime(interval.end)}).`
        );
      }

      if (!previousInterval || interval.end > previousInterval.end) {
        previousInterval = interval;
        previousSheet = sheet;
      }
    }
  }

  return conflicts;
}

export function aggregateTimesheetsByUser(timesheets: Timesheet[]): TimesheetAggregation[] {
  const map = new Map<string, TimesheetAggregation>();

  for (const sheet of timesheets) {
    const existing = map.get(sheet.userId) ?? {
      userId: sheet.userId,
      totalHours: 0,
      approvedHours: 0,
      overtimeHours: 0,
      nightHours: 0,
      weekendHours: 0,
      holidayHours: 0,
    };

    const totalHours = Number.isFinite(sheet.totalHours) ? sheet.totalHours : 0;
    const overtimeHours = Number.isFinite(sheet.overtimeHours) ? sheet.overtimeHours : 0;
    const nightHours = Number.isFinite(sheet.nightHours) ? sheet.nightHours : 0;
    const weekendHours = Number.isFinite(sheet.weekendHours) ? sheet.weekendHours : 0;
    const holidayHours = Number.isFinite(sheet.holidayHours) ? sheet.holidayHours : 0;

    existing.totalHours += totalHours;
    existing.overtimeHours = (existing.overtimeHours ?? 0) + (overtimeHours ?? 0);
    existing.nightHours = (existing.nightHours ?? 0) + (nightHours ?? 0);
    existing.weekendHours = (existing.weekendHours ?? 0) + (weekendHours ?? 0);
    existing.holidayHours = (existing.holidayHours ?? 0) + (holidayHours ?? 0);

    if (sheet.status === 'approved') {
      existing.approvedHours += totalHours;
    }

    map.set(sheet.userId, existing);
  }

  return Array.from(map.values()).map(entry => ({
    ...entry,
    totalHours: roundToDecimals(entry.totalHours),
    approvedHours: roundToDecimals(entry.approvedHours),
    overtimeHours: roundToDecimals(entry.overtimeHours),
    nightHours: roundToDecimals(entry.nightHours),
    weekendHours: roundToDecimals(entry.weekendHours),
    holidayHours: roundToDecimals(entry.holidayHours),
  }));
}
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';

const COLLECTION_NAME = 'timesheets';

export const timesheetService = {
  // Get timesheet by ID
  async getById(id: string): Promise<Timesheet | null> {
    if (!db) {
      logger.warn('Firebase not initialized, returning null');
      return null;
    }
    try {
      const firestoreDb = getDb();
      const timesheetDoc = await getDoc(doc(firestoreDb, COLLECTION_NAME, id));
      if (!timesheetDoc.exists()) return null;

      const data = timesheetDoc.data() as FirestoreTimesheetData;
      return this.mapDocToTimesheet({
        id: timesheetDoc.id,
        data: () => data,
      });
    } catch (error) {
      logger.error('Error getting timesheet by ID', error instanceof Error ? error : new Error(String(error)));
      return null;
    }
  },

  // Get timesheets by user ID
  async getByUserId(userId: string, limitCount = 50): Promise<Timesheet[]> {
    if (!db) {
      logger.warn('Firebase not initialized, returning empty array');
      return [];
    }
    try {
      const q = query(
        collection(getDb(), COLLECTION_NAME),
        where('userId', '==', userId),
        orderBy('date', 'desc'),
        limit(limitCount)
      );

      const snapshot = await getDocs(q);
      const timesheets: Timesheet[] = [];

      snapshot.forEach(doc => {
        const data = doc.data() as FirestoreTimesheetData;
        timesheets.push(
          this.mapDocToTimesheet({
            id: doc.id,
            data: () => data,
          })
        );
      });

      return timesheets;
    } catch (error) {
      throw error;
    }
  },

  // Get timesheet for specific date
  async getByDate(userId: string, date: Date): Promise<Timesheet | null> {
    try {
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);

      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);

      const q = query(
        collection(getDb(), COLLECTION_NAME),
        where('userId', '==', userId),
        where('date', '>=', startOfDay),
        where('date', '<=', endOfDay),
        limit(1)
      );

      const snapshot = await getDocs(q);
      if (snapshot.empty) return null;

      const doc = snapshot.docs[0];
      const data = doc.data() as FirestoreTimesheetData;

      return this.mapDocToTimesheet({
        id: doc.id,
        data: () => data,
      });
    } catch (error) {
      logger.error('Error getting timesheet by date', error instanceof Error ? error : new Error(String(error)));
      return null;
    }
  },

  // Create timesheet
  async create(userId: string, data: TimesheetForm): Promise<string> {
    try {
      // Hole companyId aus dem User
      let companyId: string | null = null;
      const userDoc = await getDoc(doc(getDb(), 'users', userId));
      if (userDoc.exists()) {
        companyId = userDoc.data().companyId || null;
      }
      if (!companyId) {
        companyId = await getCompanyIdFromAuth();
      }
      if (!companyId) {
        throw new Error('No companyId found for timesheet');
      }

      // Stundenberechnung inkl. Validierung (verhindert negative/NaN-Werte).
      const totalHours = computeNetHours(data.startTime, data.endTime, data.breakMinutes);

      const timesheetData = {
        userId: userId,
        companyId: companyId,
        date: data.date,
        startTime: data.startTime,
        endTime: data.endTime,
        breakMinutes: data.breakMinutes,
        totalHours,
        notes: data.notes,
        facilityId: data.facilityId,
        station: data.station,
        location: data.location, // GPS-Standort
        status: 'draft',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      // Offline-Support: Wenn offline, zur Queue hinzufügen
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        return await offlineQueueService.addToQueue('timesheet', 'create', timesheetData);
      }

      // Online: Direkt zu Firestore
      if (!db) {
        // Fallback: Zur Queue hinzufügen
        return await offlineQueueService.addToQueue('timesheet', 'create', timesheetData);
      }

      const docRef = await addDoc(collection(getDb(), COLLECTION_NAME), timesheetData);
      return docRef.id;
    } catch (error) {
      // Bei Fehler: Zur Offline-Queue hinzufügen
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        // Versuche companyId zu holen
        let companyId: string | null = null;
        try {
          const userDoc = await getDoc(doc(getDb(), 'users', userId));
          if (userDoc.exists()) {
            companyId = userDoc.data().companyId || null;
          }
          if (!companyId) {
            companyId = await getCompanyIdFromAuth();
          }
        } catch {
          // Ignoriere Fehler beim Holen von companyId für Offline-Queue
        }

        const timesheetData = {
          userId: userId,
          companyId: companyId || '',
          date: data.date,
          startTime: data.startTime,
          endTime: data.endTime,
          breakMinutes: data.breakMinutes,
          notes: data.notes,
          location: data.location,
          status: 'draft',
        };
        return await offlineQueueService.addToQueue('timesheet', 'create', timesheetData);
      }
      throw error;
    }
  },

  // Update timesheet
  // GoBD-konform: approved/submitted Timesheets können nicht geändert werden
  async update(id: string, data: Partial<TimesheetForm>): Promise<void> {
    try {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        await offlineQueueService.addToQueue('timesheet', 'update', { id, ...data });
        return;
      }
      const timesheetRef = doc(getDb(), COLLECTION_NAME, id);
      
      // KRITISCH: Status prüfen - GoBD-Konformität
      const currentDoc = await getDoc(timesheetRef);
      if (!currentDoc.exists()) {
        throw new Error('Timesheet not found');
      }
      
      const currentData = currentDoc.data() as FirestoreTimesheetData;
      if (currentData.status === 'approved' || currentData.status === 'submitted') {
        throw new Error('Cannot update approved or submitted timesheet. GoBD-Konformität: Belege müssen nach Genehmigung unveränderlich sein.');
      }

      // Recalculate total hours if times changed
      const updateData: Partial<TimesheetForm> & { updatedAt: ReturnType<typeof serverTimestamp>; totalHours?: number } = {
        ...data,
        updatedAt: serverTimestamp(),
      };

      if (data.startTime || data.endTime || data.breakMinutes !== undefined) {
        const startTime = data.startTime || currentData.startTime;
        const endTime = data.endTime || currentData.endTime;
        const breakMinutes =
          data.breakMinutes !== undefined ? data.breakMinutes : (currentData.breakMinutes ?? 0);

        updateData.totalHours = computeNetHours(startTime, endTime, breakMinutes);
      }

      await updateDoc(timesheetRef, updateData);
    } catch (error) {
      throw error;
    }
  },

  // Submit timesheet
  async submit(id: string): Promise<void> {
    // Einreichen läuft IMMER über die Cloud Function submitTimesheet:
    // serverseitige ArbZG-Validierung, Stunden-Berechnung und
    // Nacht-/Wochenend-/Feiertags-Breakdown. Das frühere direkte
    // updateDoc umging all das.
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      throw new Error(
        'Einreichen erfordert eine Internetverbindung (serverseitige ArbZG-Prüfung). Die Erfassung bleibt gespeichert – bitte später erneut einreichen.'
      );
    }
    if (!functions) {
      throw new Error('Firebase Functions ist nicht initialisiert.');
    }
    const { httpsCallable } = await import('firebase/functions');
    const call = httpsCallable<{ timesheetId: string }, { success: boolean; totalHours: number }>(
      functions,
      'submitTimesheet'
    );
    await call({ timesheetId: id });
  },

  // Approve timesheet (admin only)
  // GoBD-konform: Doppelprüfung verhindert mehrfache Genehmigung
  async approve(id: string, approvedBy: string): Promise<void> {
    try {
      const timesheetRef = doc(getDb(), COLLECTION_NAME, id);
      
      // KRITISCH: Doppelprüfung - verhindert mehrfache Genehmigung
      const currentDoc = await getDoc(timesheetRef);
      if (!currentDoc.exists()) {
        throw new Error('Timesheet not found');
      }
      
      const currentData = currentDoc.data() as FirestoreTimesheetData;
      if (currentData.status === 'approved') {
        throw new Error('Timesheet already approved');
      }
      
      await updateDoc(timesheetRef, {
        status: 'approved',
        approvedAt: serverTimestamp(),
        approvedBy,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      throw error;
    }
  },

  // Approve single timesheet with facility signature (facility/supervisor)
  // GoBD-konform: Doppelprüfung verhindert mehrfache Genehmigung
  async approveWithFacilitySignature(params: {
    timesheetId: string;
    signatureUrl: string;
    signerUserId?: string;
    status?: 'performed' | 'aborted' | 'no-show';
    signerName?: string;
    /** Anmerkung der Einrichtung zur Tagesbestätigung. */
    facilityNotes?: string;
  }): Promise<void> {
    try {
      const { timesheetId, signatureUrl, signerUserId, status, signerName, facilityNotes } = params;
      const timesheetRef = doc(getDb(), COLLECTION_NAME, timesheetId);
      
      // KRITISCH: Doppelprüfung - verhindert mehrfache Genehmigung
      const currentDoc = await getDoc(timesheetRef);
      if (!currentDoc.exists()) {
        throw new Error('Timesheet not found');
      }
      
      const currentData = currentDoc.data() as FirestoreTimesheetData;
      if (currentData.status === 'approved') {
        throw new Error('Timesheet already approved');
      }
      
      await updateDoc(timesheetRef, {
        facilitySignatureUrl: signatureUrl,
        facilitySignedAt: new Date(),
        facilitySignedBy: signerUserId || null, // Aus Datenbank: signerUserId muss übergeben werden
        ...(status ? { facilityConfirmationStatus: status } : {}),
        ...(signerName ? { facilitySignerName: signerName } : {}),
        ...(facilityNotes && facilityNotes.trim() ? { facilityNotes: facilityNotes.trim() } : {}),
        // falls bereits eingereicht, direkt freigeben
        status: 'approved',
        updatedAt: new Date(),
      });
    } catch (error) {
      throw error;
    }
  },

  // Reject timesheet (admin only)
  async reject(id: string, rejectionReason: string): Promise<void> {
    try {
      const timesheetRef = doc(getDb(), COLLECTION_NAME, id);
      await updateDoc(timesheetRef, {
        status: 'rejected',
        rejectionReason,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      throw error;
    }
  },

  // Delete timesheet
  // GoBD-konform: approved/submitted Timesheets können nicht gelöscht werden
  async delete(id: string): Promise<void> {
    const timesheetRef = doc(getDb(), COLLECTION_NAME, id);
    
    // KRITISCH: Status prüfen - GoBD-Konformität
    const currentDoc = await getDoc(timesheetRef);
    if (!currentDoc.exists()) {
      throw new Error('Timesheet not found');
    }
    
    const currentData = currentDoc.data() as FirestoreTimesheetData;
    if (currentData.status === 'approved' || currentData.status === 'submitted') {
      throw new Error('Cannot delete approved or submitted timesheet. GoBD-Konformität: Belege müssen 10 Jahre aufbewahrt werden.');
    }
    
    await deleteDoc(timesheetRef);
  },

  // Get all timesheets (admin view)
  async getAll(companyIdParam?: string): Promise<Timesheet[]> {
    if (!db) {
      logger.warn('Firebase not initialized, returning empty array');
      return [];
    }
    try {
      // Hole companyId aus Auth, falls nicht übergeben
      let companyId = companyIdParam;
      if (!companyId) {
        companyId = await getCompanyIdFromAuth() || undefined;
      }
      if (!companyId) {
        logger.warn('No companyId found, returning empty array');
        return [];
      }

      let q;
      
      // Filter nach companyId: Hole zuerst alle User-IDs der Firma
      if (companyId) {
        const usersQuery = query(
          collection(getDb(), 'users'),
          where('companyId', '==', companyId)
        );
        const usersSnapshot = await getDocs(usersQuery);
        const userIds = usersSnapshot.docs.map(doc => doc.id);
        // Wenn keine User für diese Firma existieren, gibt es auch keine Timesheets
        if (userIds.length === 0) {
          return [];
        }
        // Firestore unterstützt nur 'in' mit max. 10 Werten
        // Wenn mehr als 10 User, müssen wir mehrere Queries machen
        if (userIds.length <= 10) {
          q = query(collection(getDb(), COLLECTION_NAME), where('companyId', '==', companyId), where('userId', 'in', userIds), orderBy('date', 'desc'));
        } else {
          // Für mehr als 10 User: Mehrere Queries ausführen
          const chunks: string[][] = [];
          for (let i = 0; i < userIds.length; i += 10) {
            chunks.push(userIds.slice(i, i + 10));
          }
          const allTimesheets: Timesheet[] = [];
          for (const chunk of chunks) {
            const chunkQuery = query(collection(getDb(), COLLECTION_NAME), where('companyId', '==', companyId), where('userId', 'in', chunk), orderBy('date', 'desc'));
            const chunkSnapshot = await getDocs(chunkQuery);
            chunkSnapshot.forEach(doc => {
              const data = doc.data() as FirestoreTimesheetData;
            allTimesheets.push(
              this.mapDocToTimesheet({
                id: doc.id,
                data: () => data,
              })
            );
            });
          }
          // Sortiere nach date
          allTimesheets.sort((a, b) => b.date.getTime() - a.date.getTime());
          return allTimesheets;
        }
      }
      
      if (!q) {
        return [];
      }

      const snapshot = await getDocs(q);
      const timesheets: Timesheet[] = [];

      snapshot.forEach(doc => {
        const data = doc.data() as FirestoreTimesheetData;
        timesheets.push(
          this.mapDocToTimesheet({
            id: doc.id,
            data: () => data,
          })
        );
      });

      return timesheets;
    } catch (error) {
      logger.error('Error getting all timesheets', error instanceof Error ? error : new Error(String(error)));
      return []; // Return empty array instead of throwing
    }
  },

  // Get timesheets by date range (mit Aggregation und Validierung)
  async getByDateRange(
    userId: string | undefined,
    startDate: Date,
    endDate: Date,
    approvedOnly: boolean = true
  ): Promise<TimesheetRangeResult> {
    let normalizedStart: Date | null = null;
    let normalizedEnd: Date | null = null;
    const normalizedUserId = typeof userId === 'string' && userId.trim().length > 0 ? userId.trim() : undefined;
    const metadata: TimesheetRangeMetadata = {
      userId: normalizedUserId,
      startDate: new Date(),
      endDate: new Date(),
      approvedOnly,
    };

    try {
      if (!(startDate instanceof Date) || Number.isNaN(startDate.getTime())) {
        throw new ValidationError(
          ErrorCode.VALIDATION_INVALID_FORMAT,
          'Startdatum ist ungültig.',
          {
            additionalData: { startDate },
          },
          { component: 'timesheetService.getByDateRange' }
        );
      }

      if (!(endDate instanceof Date) || Number.isNaN(endDate.getTime())) {
        throw new ValidationError(
          ErrorCode.VALIDATION_INVALID_FORMAT,
          'Enddatum ist ungültig.',
          {
            additionalData: { endDate },
          },
          { component: 'timesheetService.getByDateRange' }
        );
      }

      normalizedStart = new Date(startDate);
      normalizedStart.setHours(0, 0, 0, 0);
      normalizedEnd = new Date(endDate);
      normalizedEnd.setHours(23, 59, 59, 999);

      if (normalizedStart > normalizedEnd) {
        throw new ValidationError(
          ErrorCode.VALIDATION_OUT_OF_RANGE,
          'Startdatum darf nicht nach dem Enddatum liegen.',
          {
            additionalData: { startDate: normalizedStart, endDate: normalizedEnd },
          },
          { component: 'timesheetService.getByDateRange' }
        );
      }

      metadata.startDate = normalizedStart;
      metadata.endDate = normalizedEnd;

      if (!db) {
        logger.warn('Firebase not initialized, returning empty timesheet range result');
        return {
          timesheets: [],
          aggregates: [],
          metadata,
        };
      }

      const constraints = [
        where('date', '>=', normalizedStart),
        where('date', '<=', normalizedEnd),
        orderBy('date', 'asc'),
      ];

      if (normalizedUserId) {
        constraints.unshift(where('userId', '==', normalizedUserId));
      }

      if (approvedOnly) {
        constraints.push(where('status', '==', 'approved'));
      }

      const snapshot = await getDocs(query(collection(getDb(), COLLECTION_NAME), ...constraints));
      const timesheets = snapshot.docs.map(docSnapshot => this.mapDocToTimesheet(docSnapshot));

      // Prüfe auf überlappende Zeiten
      const overlapConflicts = detectTimesheetOverlaps(timesheets);
      if (overlapConflicts.length > 0) {
        throw new ValidationError(
          ErrorCode.TIMESHEET_INVALID,
          overlapConflicts[0],
          {
            userId: normalizedUserId,
            additionalData: {
              conflicts: overlapConflicts,
              startDate: normalizedStart,
              endDate: normalizedEnd,
            },
          },
          { component: 'timesheetService.getByDateRange' }
        );
      }

      const aggregates = aggregateTimesheetsByUser(timesheets);

      return {
        timesheets,
        aggregates,
        metadata,
      };
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }

      const appError = createAppError(error, ErrorCode.INTERNAL_ERROR, {
        userId: normalizedUserId,
        additionalData: {
          startDate: normalizedStart ?? startDate,
          endDate: normalizedEnd ?? endDate,
          approvedOnly,
        },
      });
      appError.metadata.component = 'timesheetService.getByDateRange';
      throw appError;
    }
  },

  // Get today's timesheet for a user
  async getTodayTimesheet(userId: string): Promise<Timesheet | null> {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      
      const q = query(
        collection(getDb(), COLLECTION_NAME),
        where('userId', '==', userId),
        where('date', '>=', today),
        where('date', '<', tomorrow),
        orderBy('date', 'desc'),
        limit(1)
      );
      
      const snapshot = await getDocs(q);
      if (snapshot.empty) return null;
      
      const doc = snapshot.docs[0];
      return this.mapDocToTimesheet(doc);
    } catch (error) {
      logger.error('Error fetching today timesheet', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  },

  // Get recent timesheets for a user
  async getRecentTimesheets(userId: string, days: number = 7): Promise<Timesheet[]> {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      startDate.setHours(0, 0, 0, 0);
      
      const q = query(
        collection(getDb(), COLLECTION_NAME),
        where('userId', '==', userId),
        where('date', '>=', startDate),
        orderBy('date', 'desc'),
        limit(days)
      );
      
      const snapshot = await getDocs(q);
      return snapshot.docs.map(d => this.mapDocToTimesheet({ id: d.id, data: () => d.data() as FirestoreTimesheetData }));
    } catch (error) {
      logger.error('Error fetching recent timesheets', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  },

  // Get timesheets by date range
  async getTimesheetsByDateRange(startDate: Date, endDate: Date, userId?: string): Promise<Timesheet[]> {
    try {
      const db = getDb();
      if (!db) {
        logger.warn('Firebase not initialized, returning empty array');
        return [];
      }

      // Prüfe, ob der Benutzer ein Admin ist und hole companyId
      let isAdmin = false;
      let companyId: string | null = null;
      
      if (typeof window !== 'undefined' && auth?.currentUser) {
        try {
          const tokenResult = await auth.currentUser.getIdTokenResult(false);
          const role = tokenResult.claims.role as string | undefined;
          isAdmin = role === 'admin';
          companyId = (tokenResult.claims.companyId as string | undefined) || null;
        } catch (tokenError) {
          // Token-Fehler ignorieren, verwende Standard-Verhalten
          logger.warn('Failed to get token claims for timesheet query: ' + (tokenError instanceof Error ? tokenError.message : String(tokenError)));
        }
      }

      let q;
      
      if (userId) {
        // Wenn userId angegeben ist, filtere nach userId
        // Wenn Admin, filtere zusätzlich nach companyId für Mandantenisolation
        if (isAdmin && companyId) {
          q = query(
            collection(db, 'timesheets'),
            where('userId', '==', userId),
            where('companyId', '==', companyId),
            where('date', '>=', startDate),
            where('date', '<=', endDate),
            orderBy('date', 'desc')
          );
        } else {
          q = query(
            collection(db, 'timesheets'),
            where('userId', '==', userId),
            where('date', '>=', startDate),
            where('date', '<=', endDate),
            orderBy('date', 'desc')
          );
        }
      } else {
        // Wenn kein userId angegeben ist, muss der Benutzer ein Admin sein
        // Filtere nach companyId für Mandantenisolation
        if (isAdmin && companyId) {
          q = query(
            collection(db, 'timesheets'),
            where('companyId', '==', companyId),
            where('date', '>=', startDate),
            where('date', '<=', endDate),
            orderBy('date', 'desc')
          );
        } else {
          // Wenn kein Admin oder keine companyId, filtere nach eigener userId
          if (typeof window !== 'undefined' && auth?.currentUser) {
            q = query(
              collection(db, 'timesheets'),
              where('userId', '==', auth.currentUser.uid),
              where('date', '>=', startDate),
              where('date', '<=', endDate),
              orderBy('date', 'desc')
            );
          } else {
            logger.warn('No authenticated user for timesheet query, returning empty array');
            return [];
          }
        }
      }
      
      const snapshot = await getDocs(q);
      return snapshot.docs.map(d => this.mapDocToTimesheet({ id: d.id, data: () => d.data() as FirestoreTimesheetData }));
    } catch (error) {
      logger.error('Error fetching timesheets by date range', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  },

  // Add break to timesheet
  async addBreak(timesheetId: string, breakData: { reason?: string; duration?: number }): Promise<void> {
    try {
      const timesheetRef = doc(getDb(), 'timesheets', timesheetId);
      const timesheetDoc = await getDoc(timesheetRef);
      
      if (!timesheetDoc.exists()) {
        throw new Error('Timesheet not found');
      }
      
      const currentData = timesheetDoc.data() as FirestoreTimesheetData;
      const currentBreaks = currentData.breaks || [];
      
      const newBreak: Break = {
        id: `break_${Date.now()}`,
        startTime: new Date().toTimeString().slice(0, 5),
        duration: breakData.duration || 0,
        reason: breakData.reason,
        createdAt: new Date(),
      };
      
      const updatedBreaks = [...currentBreaks, newBreak];
      const totalBreakMinutes = updatedBreaks.reduce((sum, b) => sum + (b.duration || 0), 0);
      
      await updateDoc(timesheetRef, {
        breaks: updatedBreaks,
        breakMinutes: totalBreakMinutes,
        updatedAt: new Date(),
      });
    } catch (error) {
      logger.error('Error adding break', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  },

  // End break (if needed for future implementation)
  async endBreak(timesheetId: string, breakId: string): Promise<void> {
    try {
      const timesheetRef = doc(getDb(), 'timesheets', timesheetId);
      const timesheetDoc = await getDoc(timesheetRef);
      
      if (!timesheetDoc.exists()) {
        throw new Error('Timesheet not found');
      }
      
      const currentData = timesheetDoc.data() as FirestoreTimesheetData;
      const currentBreaks = currentData.breaks || [];
      
      const updatedBreaks = currentBreaks.map(breakItem => {
        if (breakItem.id === breakId && !breakItem.endTime) {
          return {
            ...breakItem,
            endTime: new Date().toTimeString().slice(0, 5),
          };
        }
        return breakItem;
      });
      
      await updateDoc(timesheetRef, {
        breaks: updatedBreaks,
        updatedAt: new Date(),
      });
    } catch (error) {
      logger.error('Error ending break', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  },

  async getByUserAndDateRange(userId: string, start: Date, end: Date): Promise<Timesheet[]> {
    const q = query(
      collection(getDb(), COLLECTION_NAME),
      where('userId', '==', userId),
      where('date', '>=', start),
      where('date', '<=', end),
      orderBy('date', 'asc')
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => this.mapDocToTimesheet({ id: d.id, data: () => d.data() as FirestoreTimesheetData }));
  },

  /**
   * @deprecated Wochensignatur ist obsolet. Verwende stattdessen tägliche Signaturen über approveWithFacilitySignature.
   */
  async approveRangeWithFacilitySignature(params: {
    userId: string;
    start: Date;
    end: Date;
    signatureUrl: string;
    signerUserId: string;
  }): Promise<number> {
    const { userId, start, end, signatureUrl, signerUserId } = params;
    const list = await this.getByUserAndDateRange(userId, start, end);
    let updated = 0;
    for (const t of list) {
      const ref = doc(getDb(), COLLECTION_NAME, t.id);
      await updateDoc(ref, {
        facilitySignatureUrl: signatureUrl,
        facilitySignedAt: new Date(),
        facilitySignedBy: signerUserId,
        status: t.status === 'submitted' ? 'approved' : t.status,
        updatedAt: new Date(),
      });
      updated++;
    }
    return updated;
  },

  // Helper method to map Firestore document to Timesheet
  mapDocToTimesheet(doc: { id: string; data: () => unknown }): Timesheet {
    const data = doc.data() as FirestoreTimesheetData;
    return {
      id: doc.id,
      userId: data.userId,
      companyId: data.companyId || '', // companyId ist erforderlich für Timesheet aus lib/types
      date: data.date?.toDate() || new Date(),
      startDate: data.startDate?.toDate() || data.date?.toDate() || new Date(),
      endDate: data.endDate?.toDate() || data.date?.toDate() || new Date(),
      startTime: data.startTime,
      endTime: data.endTime,
      breakMinutes: data.breakMinutes || 0,
      totalHours: data.totalHours || 0,
      nightHours: data.nightHours || 0,
      weekendHours: data.weekendHours || 0,
      holidayHours: data.holidayHours || 0,
      overtimeHours: data.overtimeHours || 0,
      regularHours: data.regularHours || 0,
      notes: data.notes,
      status: data.status || 'draft',
      submittedAt: data.submittedAt?.toDate(),
      approvedAt: data.approvedAt?.toDate(),
      approvedBy: data.approvedBy,
      rejectionReason: data.rejectionReason,
      breaks: data.breaks || [],
      employeeSignatureUrl: data.employeeSignatureUrl,
      employeeSignedAt: data.employeeSignedAt?.toDate(),
      facilitySignatureUrl: data.facilitySignatureUrl,
      facilitySignedAt: data.facilitySignedAt?.toDate(),
      facilitySignedBy: data.facilitySignedBy,
      facilityConfirmationStatus: data.facilityConfirmationStatus,
      facilitySignerName: data.facilitySignerName,
      facilityNotes: data.facilityNotes,
      facilityId: data.facilityId,
      station: data.station,
      location: data.location,
      createdAt: data.createdAt?.toDate() || new Date(),
      updatedAt: data.updatedAt?.toDate() || new Date(),
    };
  },
};
