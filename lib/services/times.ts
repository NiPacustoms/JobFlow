import { getDb } from '@/lib/firebase';
import {
  addDoc,
  collection,
  doc,
  getDocs,
  query,
  QueryDocumentSnapshot,
  QuerySnapshot,
  serverTimestamp,
  updateDoc,
  where,
  orderBy,
  getDoc,
} from 'firebase/firestore';
import { assignmentService, type Assignment } from './assignments';
import { logger } from '@/lib/logging';
import { getCompanyIdFromAuth } from '@/lib/utils/companyId';

const COLLECTION_NAME = 'times';

export interface TimeEntry {
  id: string;
  userId: string;
  companyId?: string; // Mandantenzugehörigkeit für vollständige Isolation
  assignmentId?: string; // Pflichtfeld für work/break, optional für krankheitsbedingte Einträge
  date: Date;
  type: 'work' | 'break' | 'sick';
  startTime?: string;
  endTime?: string;
  hours: number;
  balance: number;
  status: 'active' | 'completed' | 'pending' | 'approved' | 'rejected';
  reason?: string;
  facility?: string;
  shiftType?: string;
  breaks?: number;
  remark?: string;
  approvedBy?: string;
  doctor?: string;
  startDate?: Date; // Zeitraumfelder für Abwesenheiten (z. B. Krankheit)
  endDate?: Date;
  days?: number;
  createdAt?: Date; // Erstellungsdatum
  updatedAt?: Date; // Aktualisierungsdatum
  employeeName?: string;
  employeeSignatureUrl?: string;
  employeeSignedAt?: Date;
}

// Helper function to find active assignment for a user at a specific date
async function findActiveAssignmentForDate(userId: string, date: Date): Promise<Assignment | null> {
  try {
    // Get all active assignments for the user
    const activeAssignments = await assignmentService.getMyActiveAssignments(userId);
    
    if (activeAssignments.length === 0) {
      return null;
    }
    
    // Find assignment where the shift date matches
    for (const assignment of activeAssignments) {
      const shift = await (await import('./shifts')).shiftService.getById(assignment.shiftId);
      if (shift) {
        const shiftDate = new Date(shift.date);
        const queryDate = new Date(date);
        
        // Check if dates match (same day)
        if (
          shiftDate.getFullYear() === queryDate.getFullYear() &&
          shiftDate.getMonth() === queryDate.getMonth() &&
          shiftDate.getDate() === queryDate.getDate()
        ) {
          return assignment;
        }
      }
    }
    
    return null;
  } catch (error) {
    logger.error('Error finding active assignment', error instanceof Error ? error : new Error(String(error)));
    return null;
  }
}

export const timesService = {
  // Get all time entries for current user
  async getAll(userId?: string): Promise<TimeEntry[]> {
    try {
      const timeUserId = userId || 'current-user-id'; // Use provided userId or fallback
      
      const q = query(
        collection(getDb(), COLLECTION_NAME),
        where('userId', '==', timeUserId),
        orderBy('date', 'desc')
      );

      const snapshot = await getDocs(q);
      const times: TimeEntry[] = [];

      snapshot.forEach(doc => {
        const data = doc.data() as {
          userId: string;
          date: { toDate: () => Date };
          type: TimeEntry['type'];
          startTime?: string;
          endTime?: string;
          hours?: number;
          balance?: number;
          status: TimeEntry['status'];
          reason?: string;
          facility?: string;
          shiftType?: string;
          breaks?: number;
          remark?: string;
          approvedBy?: string;
          doctor?: string;
          assignmentId?: string;
          startDate?: { toDate: () => Date } | Date;
          endDate?: { toDate: () => Date } | Date;
          days?: number;
        };
        times.push({
          id: doc.id,
          userId: data.userId,
          companyId: (data as unknown as Partial<TimeEntry> & { companyId?: string }).companyId || undefined,
          assignmentId: data.assignmentId,
          date: data.date?.toDate() || new Date(),
          type: data.type,
          startTime: data.startTime,
          endTime: data.endTime,
          hours: data.hours || 0,
          balance: data.balance || 0,
          status: data.status,
          reason: data.reason,
          facility: data.facility,
          shiftType: data.shiftType,
          breaks: data.breaks,
          remark: data.remark,
          approvedBy: data.approvedBy,
          doctor: data.doctor,
        });
      });

      return times;
    } catch (error) {
      throw error;
    }
  },

  // Get time entries by user ID
  async getByUserId(userId: string): Promise<TimeEntry[]> {
    const db = getDb();
    if (!db) {
      logger.warn('Firebase not initialized, returning empty array');
      return [];
    }
    
    // Helper function to process documents
    const processDocs = (snapshot: QuerySnapshot): TimeEntry[] => {
      const times: TimeEntry[] = [];
      snapshot.forEach((doc: QueryDocumentSnapshot) => {
        const data = doc.data() as {
          userId: string;
          date: { toDate: () => Date };
          type: TimeEntry['type'];
          startTime?: string;
          endTime?: string;
          hours?: number;
          balance?: number;
          status: TimeEntry['status'];
          reason?: string;
          facility?: string;
          shiftType?: string;
          breaks?: number;
          remark?: string;
          approvedBy?: string;
          doctor?: string;
          assignmentId?: string;
          startDate?: { toDate: () => Date } | Date;
          endDate?: { toDate: () => Date } | Date;
          days?: number;
        };
        const entry = {
          id: doc.id,
          userId: data.userId,
          companyId: (data as unknown as Partial<TimeEntry> & { companyId?: string }).companyId || undefined,
          assignmentId: data.assignmentId,
          date: data.date?.toDate() || new Date(),
          type: data.type,
          startTime: data.startTime,
          endTime: data.endTime,
          hours: data.hours || 0,
          balance: data.balance || 0,
          status: data.status,
          reason: data.reason,
          facility: data.facility,
          shiftType: data.shiftType,
          breaks: data.breaks,
          remark: data.remark,
          approvedBy: data.approvedBy,
          doctor: data.doctor,
        } as TimeEntry & { startDate?: Date; endDate?: Date; days?: number };
        
        // Extract startDate and endDate if they exist
        if (data.startDate) {
          entry.startDate = data.startDate instanceof Date ? data.startDate : data.startDate.toDate();
        }
        if (data.endDate) {
          entry.endDate = data.endDate instanceof Date ? data.endDate : data.endDate.toDate();
        }
        if (data.days) {
          entry.days = data.days;
        }
        
        times.push(entry);
      });
      
      // Sort by date descending (client-side)
      return times.sort((a, b) => b.date.getTime() - a.date.getTime());
    };
    
    try {
      // Try with orderBy first (requires index)
      const q = query(
        collection(getDb(), COLLECTION_NAME),
        where('userId', '==', userId),
        orderBy('date', 'desc')
      );

      const snapshot = await getDocs(q);
      return processDocs(snapshot);
    } catch (error: unknown) {
      // Check if it's an index error
      const err = error as { code?: string; message?: string };
      const isIndexError = err?.code === 'failed-precondition' || 
                          err?.message?.includes('index') ||
                          err?.message?.includes('requires an index');
      
      if (isIndexError) {
        // Fallback: Query without orderBy and sort client-side
        try {
          logger.warn('Index not available yet, using fallback query without orderBy');
          const fallbackQ = query(
            collection(getDb(), COLLECTION_NAME),
            where('userId', '==', userId)
          );
          
          const snapshot = await getDocs(fallbackQ);
          return processDocs(snapshot);
        } catch (fallbackError) {
          logger.error('Error getting time entries by userId (fallback)', fallbackError instanceof Error ? fallbackError : new Error(String(fallbackError)));
          return [];
        }
      }
      
      // Other errors
      logger.error('Error getting time entries by userId', error instanceof Error ? error : new Error(String(error)));
      return [];
    }
  },

  // Start shift
  async startShift(userId: string, assignmentId?: string): Promise<string> {
    try {
      const now = new Date();
      
      // Find active assignment if not provided
      let activeAssignment: Assignment | null = null;
      if (assignmentId) {
        activeAssignment = await assignmentService.getById(assignmentId);
        if (!activeAssignment || activeAssignment.userId !== userId) {
          throw new Error('Zugewiesener Auftrag nicht gefunden oder gehört nicht zum Benutzer');
        }
        if (activeAssignment.status !== 'accepted' && activeAssignment.status !== 'assigned') {
          throw new Error('Zugewiesener Auftrag ist nicht aktiv (nicht akzeptiert oder zugewiesen)');
        }
      } else {
        activeAssignment = await findActiveAssignmentForDate(userId, now);
        if (!activeAssignment) {
          throw new Error('Kein aktiver zugewiesener Auftrag für heute gefunden. Bitte wählen Sie einen Auftrag aus oder warten Sie auf eine Zuweisung.');
        }
      }
      
      // Verify assignment date matches
      const shift = await (await import('./shifts')).shiftService.getById(activeAssignment.shiftId);
      if (shift) {
        const shiftDate = new Date(shift.date);
        const today = new Date(now);
        if (
          shiftDate.getFullYear() !== today.getFullYear() ||
          shiftDate.getMonth() !== today.getMonth() ||
          shiftDate.getDate() !== today.getDate()
        ) {
          throw new Error('Der zugewiesene Auftrag ist nicht für heute');
        }
      }
      
      // Hole companyId aus Auth oder Assignment
      let companyId = await getCompanyIdFromAuth();
      if (!companyId && activeAssignment.companyId) {
        companyId = activeAssignment.companyId;
      }
      if (!companyId) {
        // Fallback: Hole companyId aus User-Dokument
        try {
          const userDoc = await getDoc(doc(getDb(), 'users', userId));
          if (userDoc.exists()) {
            companyId = userDoc.data().companyId;
          }
        } catch (error) {
          logger.warn('Failed to get companyId from user document: ' + (error instanceof Error ? error.message : String(error)));
        }
      }

      const timeData = {
        userId: userId,
        companyId: companyId || null, // Setze null wenn nicht gefunden (für Migration)
        assignmentId: activeAssignment.id,
        date: now,
        type: 'work',
        startTime: now.toTimeString().slice(0, 5),
        hours: 0,
        balance: 0,
        status: 'active',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      const docRef = await addDoc(collection(getDb(), COLLECTION_NAME), timeData);
      return docRef.id;
    } catch (error) {
      throw error;
    }
  },

  // End shift
  async endShift(userId?: string): Promise<void> {
    try {
      const shiftUserId = userId || 'current-user-id'; // Use provided userId or fallback
      
      // Find active work entry
      const q = query(
        collection(getDb(), COLLECTION_NAME),
        where('userId', '==', shiftUserId),
        where('type', '==', 'work'),
        where('status', '==', 'active')
      );

      const snapshot = await getDocs(q);
      if (snapshot.empty) {
        throw new Error('Keine aktive Schicht gefunden');
      }

      const doc = snapshot.docs[0];
      const workData = doc.data() as {
        date: { toDate: () => Date } | Date;
        startTime: string;
        assignmentId?: string;
      };
      const now = new Date();
      const workDate = workData.date instanceof Date ? workData.date : workData.date.toDate();
      const startTime = new Date(workDate);
      startTime.setHours(parseInt(workData.startTime.split(':')[0]));
      startTime.setMinutes(parseInt(workData.startTime.split(':')[1]));
      
      // Berechne Gesamtstunden (Start bis Ende)
      const totalHours = (now.getTime() - startTime.getTime()) / (1000 * 60 * 60);
      
      // Finde alle abgeschlossenen Pausen für diese Schicht
      const breakQuery = query(
        collection(getDb(), COLLECTION_NAME),
        where('userId', '==', shiftUserId),
        where('type', '==', 'break'),
        where('status', '==', 'completed')
      );
      const breakSnapshot = await getDocs(breakQuery);
      
      // Summiere Pausen, die zu dieser Schicht gehören
      let totalBreakHours = 0;
      const workDateStart = new Date(workDate);
      workDateStart.setHours(0, 0, 0, 0);
      
      breakSnapshot.docs.forEach(breakDoc => {
        const breakData = breakDoc.data();
        const breakDate = breakData.date instanceof Date ? breakData.date : breakData.date.toDate();
        const breakDateStart = new Date(breakDate);
        breakDateStart.setHours(0, 0, 0, 0);
        
        // Prüfe ob Pause zum gleichen Tag gehört
        if (workDateStart.getTime() === breakDateStart.getTime()) {
          // Prüfe ob assignmentId übereinstimmt (falls vorhanden)
          if (workData.assignmentId && breakData.assignmentId) {
            if (workData.assignmentId === breakData.assignmentId) {
              totalBreakHours += breakData.hours || 0;
            }
          } else {
            // Für alte Einträge ohne assignmentId: Prüfe ob Pause zeitlich zur Schicht passt
            if (breakData.startTime) {
              const breakStart = breakData.startTime.split(':').map(Number);
              const breakStartMinutes = breakStart[0] * 60 + breakStart[1];
              const workStartMinutes = parseInt(workData.startTime.split(':')[0]) * 60 + parseInt(workData.startTime.split(':')[1]);
              const workEndMinutes = now.getHours() * 60 + now.getMinutes();
              
              // Pause liegt zwischen Start und Ende
              if (breakStartMinutes >= workStartMinutes && breakStartMinutes <= workEndMinutes) {
                totalBreakHours += breakData.hours || 0;
              }
            } else {
              // Wenn keine Startzeit vorhanden, aber hours vorhanden, zähle sie trotzdem
              totalBreakHours += breakData.hours || 0;
            }
          }
        }
      });
      
      // Stunden = Gesamtstunden - Pausen
      const hours = Math.max(0, totalHours - totalBreakHours);
      const balance = hours - 8; // Assuming 8-hour workday

      await updateDoc(doc.ref, {
        endTime: now.toTimeString().slice(0, 5),
        hours: Math.round(hours * 100) / 100,
        balance: Math.round(balance * 100) / 100,
        status: 'completed',
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      throw error;
    }
  },

  // Add break
  async addBreak(userId: string, data: { reason: string; duration: number }, assignmentId?: string): Promise<string> {
    try {
      const now = new Date();
      
      // Find active assignment if not provided
      let activeAssignment: Assignment | null = null;
      if (assignmentId) {
        activeAssignment = await assignmentService.getById(assignmentId);
        if (!activeAssignment || activeAssignment.userId !== userId) {
          throw new Error('Zugewiesener Auftrag nicht gefunden oder gehört nicht zum Benutzer');
        }
        if (activeAssignment.status !== 'accepted' && activeAssignment.status !== 'assigned') {
          throw new Error('Zugewiesener Auftrag ist nicht aktiv (nicht akzeptiert oder zugewiesen)');
        }
      } else {
        // Try to find assignment from active work entry
        const activeWorkQuery = query(
          collection(getDb(), COLLECTION_NAME),
          where('userId', '==', userId),
          where('type', '==', 'work'),
          where('status', '==', 'active')
        );
        const activeWorkSnapshot = await getDocs(activeWorkQuery);
        
        if (!activeWorkSnapshot.empty) {
          const activeWorkData = activeWorkSnapshot.docs[0].data();
          if (activeWorkData.assignmentId) {
            activeAssignment = await assignmentService.getById(activeWorkData.assignmentId);
          }
        }
        
        // If no active work entry, try to find assignment for today
        if (!activeAssignment) {
          activeAssignment = await findActiveAssignmentForDate(userId, now);
        }
        
        if (!activeAssignment) {
          throw new Error('Kein aktiver zugewiesener Auftrag gefunden. Bitte starten Sie zuerst eine Schicht.');
        }
      }
      
      // Hole companyId aus Auth oder Assignment
      let companyId = await getCompanyIdFromAuth();
      if (!companyId && activeAssignment.companyId) {
        companyId = activeAssignment.companyId;
      }
      if (!companyId) {
        // Fallback: Hole companyId aus User-Dokument
        try {
          const userDoc = await getDoc(doc(getDb(), 'users', userId));
          if (userDoc.exists()) {
            companyId = userDoc.data().companyId;
          }
        } catch (error) {
          logger.warn('Failed to get companyId from user document: ' + (error instanceof Error ? error.message : String(error)));
        }
      }

      const breakData = {
        userId: userId,
        companyId: companyId || null, // Setze null wenn nicht gefunden (für Migration)
        assignmentId: activeAssignment.id,
        date: now,
        type: 'break',
        startTime: now.toTimeString().slice(0, 5),
        hours: data.duration / 60,
        balance: -(data.duration / 60),
        status: 'active',
        reason: data.reason,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      const docRef = await addDoc(collection(getDb(), COLLECTION_NAME), breakData);
      return docRef.id;
    } catch (error) {
      throw error;
    }
  },

  // End break
  async endBreak(userId: string): Promise<void> {
    try {
      if (!userId) {
        throw new Error('User ID ist erforderlich');
      }
      
      // Find active break entry
      const q = query(
        collection(getDb(), COLLECTION_NAME),
        where('userId', '==', userId),
        where('type', '==', 'break'),
        where('status', '==', 'active')
      );

      const snapshot = await getDocs(q);
      if (snapshot.empty) {
        // Try to find any break entry for debugging
        const allBreaksQuery = query(
          collection(getDb(), COLLECTION_NAME),
          where('userId', '==', userId),
          where('type', '==', 'break')
        );
        const allBreaksSnapshot = await getDocs(allBreaksQuery);
        logger.debug('Active breaks found: ' + snapshot.size);
        logger.debug('All breaks found: ' + allBreaksSnapshot.size);
        if (allBreaksSnapshot.size > 0) {
          allBreaksSnapshot.forEach(doc => {
            logger.debug('Break entry: ' + doc.id);
          });
        }
        throw new Error('Keine aktive Pause gefunden. Bitte starten Sie zuerst eine Pause.');
      }

      const doc = snapshot.docs[0];
      const data = doc.data() as {
        date: { toDate: () => Date } | Date;
        startTime: string;
        assignmentId?: string;
        type: string;
      };
      
      const now = new Date();
      const breakDate = data.date instanceof Date ? data.date : data.date.toDate();
      const startTime = new Date(breakDate);
      const [startHours, startMinutes] = data.startTime.split(':').map(Number);
      startTime.setHours(startHours, startMinutes, 0, 0);
      
      const hours = (now.getTime() - startTime.getTime()) / (1000 * 60 * 60);

      // Ensure balance is calculated correctly (negative for breaks)
      const balance = -Math.max(0, Math.round(hours * 100) / 100);
      
      // Prepare update data - ALWAYS include assignmentId if it exists in the document
      // This is required by Firestore Security Rules
      const updateData: {
        endTime: string;
        hours: number;
        balance: number;
        status: string;
        updatedAt: Date | unknown;
        assignmentId?: string;
        type?: string;
      } = {
        endTime: now.toTimeString().slice(0, 5),
        hours: Math.max(0, Math.round(hours * 100) / 100), // Ensure hours is not negative
        balance: balance, // Breaks have negative balance
        status: 'completed',
        updatedAt: serverTimestamp(),
        type: data.type || 'break', // Preserve type
      };
      
      // CRITICAL: Always preserve assignmentId if it exists - required by Security Rules
      // Die Security Rule erlaubt Updates wenn:
      // 1. assignmentId im Update vorhanden ist (nicht null) ODER
      // 2. assignmentId im bestehenden Dokument vorhanden ist ODER
      // 3. assignmentId in beiden null ist (Migration)
      
      // Schritt 1: Wenn das bestehende Dokument eine assignmentId hat, immer beibehalten
      if (data.assignmentId) {
        updateData.assignmentId = data.assignmentId;
        logger.debug('Preserving existing assignmentId: ' + data.assignmentId);
      } else {
        // Schritt 2: Wenn keine assignmentId im Dokument, versuche sie zu finden
        logger.warn('Break entry missing assignmentId, trying to find it: ' + doc.id);
        
        try {
          // Versuche von aktiver Work-Entry
          const activeWorkQuery = query(
            collection(getDb(), COLLECTION_NAME),
            where('userId', '==', userId),
            where('type', '==', 'work'),
            where('status', '==', 'active')
          );
          const activeWorkSnapshot = await getDocs(activeWorkQuery);
          
          if (!activeWorkSnapshot.empty) {
            const activeWorkData = activeWorkSnapshot.docs[0].data();
            if (activeWorkData.assignmentId) {
              updateData.assignmentId = activeWorkData.assignmentId;
              logger.debug('Found assignmentId from active work entry: ' + activeWorkData.assignmentId);
            }
          }
          
          // Wenn immer noch keine, versuche von aktiver Assignment
          if (!updateData.assignmentId) {
            const activeAssignment = await findActiveAssignmentForDate(userId, breakDate);
            if (activeAssignment) {
              updateData.assignmentId = activeAssignment.id;
              logger.debug('Found assignmentId from active assignment: ' + activeAssignment.id);
            }
          }
        } catch (error) {
          logger.warn('Failed to find assignmentId for break entry: ' + (error instanceof Error ? error.message : String(error)));
        }
        
        // Schritt 3: Wenn keine assignmentId gefunden wurde, setze explizit null
        // Die Security Rule prüft auf null (nicht undefined), daher müssen wir null setzen
        // für den Fall, dass beide (Update und bestehendes Dokument) null sind
        if (!updateData.assignmentId) {
          // WICHTIG: Setze explizit null, nicht undefined
          // Die Security Rule prüft: request.resource.data.assignmentId == null
          // undefined würde die Prüfung fehlschlagen lassen
          updateData.assignmentId = undefined;
          logger.warn('No assignmentId found, setting to null for migration mode');
        }
      }
      
      await updateDoc(doc.ref, updateData);
    } catch (error) {
      logger.error('Error ending break', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  },

  // Report sick
  async reportSick(userId: string, data: {
    startDate: Date;
    endDate: Date;
    reason: string;
    doctorNote?: string;
  }): Promise<string> {
    try {
      const sickUserId = userId || 'current-user-id'; // Use provided userId or fallback
      const days = Math.ceil((data.endDate.getTime() - data.startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      
      const sickData = {
        userId: sickUserId,
        date: data.startDate,
        type: 'sick',
        hours: days * 8, // Assuming 8 hours per day
        balance: -(days * 8),
        status: 'pending',
        reason: data.reason,
        startDate: data.startDate,
        endDate: data.endDate,
        days,
        doctorNote: data.doctorNote,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      const docRef = await addDoc(collection(getDb(), COLLECTION_NAME), sickData);
      return docRef.id;
    } catch (error) {
      throw error;
    }
  },

  /**
   * Exportiert die Stempeluhr-Einträge des Mitarbeiters.
   *
   * PDF: gebrandetes Dokument über die zentrale PDF-Erzeugung (Storage-URL,
   * wird vom Aufrufer geöffnet). CSV/Excel: lokale Datei über den
   * ExportService – der Download startet dort direkt, zurück kommt der
   * Dateiname. (Der frühere Stand lieferte den Pfad einer nicht
   * existierenden Datei und täuschte damit einen Export vor.)
   */
  async exportTimes(
    format: 'pdf' | 'excel' | 'csv',
    userId?: string
  ): Promise<{ art: 'url' | 'datei'; wert: string }> {
    if (!userId) {
      throw new Error('Für den Export wird die Benutzer-ID benötigt.');
    }

    const eintraege = await this.getByUserId(userId);
    if (eintraege.length === 0) {
      throw new Error('Keine Zeiteinträge zum Exportieren vorhanden.');
    }

    if (format === 'pdf') {
      const { documentGenerationService } = await import('./documentGeneration');
      const dokument = await documentGenerationService.generateDocument({
        type: 'time-entries-report',
        userId,
        timeEntries: eintraege.map(e => ({
          date: e.date,
          type: e.type,
          startTime: e.startTime,
          endTime: e.endTime,
          hours: e.hours,
          status: e.status,
          reason: e.reason,
        })),
      });
      return { art: 'url', wert: dokument.url };
    }

    const { ExportService } = await import('./exportService');
    const artLabel: Record<TimeEntry['type'], string> = {
      work: 'Arbeit',
      break: 'Pause',
      sick: 'Krank',
    };
    const zeilen = eintraege.map(e => ({
      Datum: e.date,
      Art: artLabel[e.type] ?? e.type,
      Start: e.startTime || '',
      Ende: e.endTime || '',
      Stunden: e.hours,
      Status: e.status,
      Anmerkung: e.reason || '',
    }));
    const dateiname = `meine-zeiten-${new Date().toISOString().split('T')[0]}`;
    const datei =
      format === 'excel'
        ? await ExportService.exportToExcel(zeilen, { filename: `${dateiname}.xls` })
        : await ExportService.exportToCSV(zeilen, { filename: `${dateiname}.csv` });
    return { art: 'datei', wert: datei };
  },

  // Get time statistics
  async getStats(): Promise<{
    totalHours: number;
    workHours: number;
    overtimeHours: number;
    sickHours: number;
    totalBalance: number;
  }> {
    try {
      const userId = 'current-user-id'; // This should come from auth context
      
      const q = query(
        collection(getDb(), COLLECTION_NAME),
        where('userId', '==', userId)
      );

      const snapshot = await getDocs(q);
      let totalHours = 0;
      let workHours = 0;
      let overtimeHours = 0;
      let sickHours = 0;
      let totalBalance = 0;

      snapshot.forEach(doc => {
        const data = doc.data() as {
          hours?: number;
          balance?: number;
          type: TimeEntry['type'];
        };
        totalHours += data.hours || 0;
        totalBalance += data.balance || 0;

        switch (data.type) {
          case 'work':
            workHours += data.hours || 0;
            if (data.balance && data.balance > 0) {
              overtimeHours += data.balance;
            }
            break;
          case 'sick':
            sickHours += data.hours || 0;
            break;
        }
      });

      return {
        totalHours,
        workHours,
        overtimeHours,
        sickHours,
        totalBalance,
      };
    } catch (error) {
      throw error;
    }
  },

  // Get current status
  async getCurrentStatus(): Promise<'working' | 'break' | 'off' | 'sick'> {
    try {
      const userId = 'current-user-id'; // This should come from auth context
      
      // Check for active work entry
      const workQuery = query(
        collection(getDb(), COLLECTION_NAME),
        where('userId', '==', userId),
        where('type', '==', 'work'),
        where('status', '==', 'active')
      );

      const workSnapshot = await getDocs(workQuery);
      if (!workSnapshot.empty) {
        return 'working';
      }

      // Check for active break entry
      const breakQuery = query(
        collection(getDb(), COLLECTION_NAME),
        where('userId', '==', userId),
        where('type', '==', 'break'),
        where('status', '==', 'active')
      );

      const breakSnapshot = await getDocs(breakQuery);
      if (!breakSnapshot.empty) {
        return 'break';
      }

      // Check for krankheitsbedingte Abwesenheit
      const today = new Date();
      const sickQuery = query(
        collection(getDb(), COLLECTION_NAME),
        where('userId', '==', userId),
        where('type', '==', 'sick'),
        where('startDate', '<=', today),
        where('endDate', '>=', today),
        where('status', '==', 'approved')
      );

      const sickSnapshot = await getDocs(sickQuery);
      if (!sickSnapshot.empty) {
        return 'sick';
      }

      return 'off';
    } catch (error) {
      throw error;
    }
  },

  // Get today's work time
  async getTodayWorkTime(): Promise<{ hours: string; minutes: number }> {
    try {
      const userId = 'current-user-id'; // This should come from auth context
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const q = query(
        collection(getDb(), COLLECTION_NAME),
        where('userId', '==', userId),
        where('type', '==', 'work'),
        where('date', '>=', today)
      );

      const snapshot = await getDocs(q);
      let totalMinutes = 0;

      snapshot.forEach(doc => {
        const data = doc.data() as {
          status: TimeEntry['status'];
          startTime?: string;
          date: { toDate: () => Date };
          hours?: number;
        };
        if (data.status === 'active' && data.startTime) {
          const startTime = new Date(data.date.toDate());
          startTime.setHours(parseInt(data.startTime.split(':')[0]));
          startTime.setMinutes(parseInt(data.startTime.split(':')[1]));
          
          const now = new Date();
          const minutes = (now.getTime() - startTime.getTime()) / (1000 * 60);
          totalMinutes += Math.max(0, minutes);
        } else if (data.hours) {
          totalMinutes += data.hours * 60;
        }
      });

      const hours = Math.floor(totalMinutes / 60);
      const minutes = Math.floor(totalMinutes % 60);
      
      return {
        hours: `${hours}h ${minutes}min`,
        minutes: totalMinutes,
      };
    } catch (error) {
      throw error;
    }
  },
};
