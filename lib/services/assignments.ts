import { db, getDb } from '@/lib/firebase';
import { errorHandler, logger } from '@/lib/errors';
import { getCompanyIdFromAuth } from '@/lib/utils/companyId';

// Assignment Interface
export interface Assignment {
  id: string;
  userId: string;
  shiftId: string;
  companyId?: string; // Mandantenzugehörigkeit
  status: 'requested' | 'accepted' | 'declined' | 'assigned' | 'completed' | 'pending-signature' | 'pending' | 'done' | 'published';
  assignedAt: Date;
  acceptedAt?: Date;
  declinedAt?: Date;
  completedAt?: Date;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
  // Extended fields
  decidedAt?: Date;
  declineReason?: string;
  requiresSignature?: boolean;
  signedBy?: string;
  signedAt?: Date;
  penaltyFlag?: boolean;
  // Signaturen
  employeeSignatureUrl?: string;
  employeeSignedAt?: Date;
  adminSignatureUrl?: string;
  adminSignedAt?: Date;
  // Formular: Einsatzmitteilung/Ablehnung
  formStatus?: 'acknowledged' | 'declined';
  formPlace?: string;
  formTimes?: string;
  formNotes?: string;
  formSignatureName?: string;
  formSignedAt?: Date;
  // Tägliche Unterschriften
  dailySignatures?: Array<{ date: string; name: string; signedAt: Date }>;
  // Finalzusammenfassung
  finalSummarySignedBy?: string;
  finalSummarySignedAt?: Date;
  // Relieving Personnel Signatures (ablösendes Personal)
  relievingSignatures?: Array<{
    date: string; // ISO date string
    signerName: string;
    signerRole?: string;
    signatureUrl: string;
    signedAt: Date;
    timesheetId?: string; // Verknüpfung zu Timesheet
    verifiedTimes?: {
      startTime: string;
      endTime: string;
      breakMinutes: number;
      totalHours: number;
    };
  }>;
  // Signature Schedule Tracking
  signatureSchedule?: {
    requiredDates: Date[]; // Datum, an denen Signaturen erforderlich sind
    collectedDates: string[]; // ISO date strings der bereits gesammelten Signaturen
    nextRequiredDate?: Date; // Nächstes Datum, an dem Signatur erforderlich ist
  };
  // PDF Generation Tracking
  pdfGenerated?: boolean;
  pdfGeneratedAt?: Date;
  pdfUrl?: string;
  /** Einsatzmitteilung aus dem Mitarbeiter-Formular (getrennt von pdfUrl). */
  formPdfUrl?: string;
  formPdfGeneratedAt?: Date;
  pdfSentTo?: {
    employee: boolean;
    admin: boolean;
    facility: boolean;
  };
  adminSignerName?: string;
  // Resolved/denormalized from shift (for UI)
  facilityId?: string;
  startDate?: Date;
  endDate?: Date;
  startTime?: string;
  endTime?: string;
  qualification?: string;
  qualifications?: string[];
  candidateUserIds?: string[];
}

interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
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

const COLLECTION_NAME = 'assignments';

export const assignmentService = {
  // Get assignment by ID
  async getById(id: string): Promise<Assignment | null> {
    if (!db) {
      logger.warn('Firebase not initialized, returning null');
      return null;
    }
    try {
      const assignmentDoc = await getDoc(doc(getDb(), COLLECTION_NAME, id));
      if (!assignmentDoc.exists()) return null;

      // Vollständiges Mapping (inkl. pdfGenerated, signatureSchedule, formStatus,
      // dailySignatures) – die frühere Teil-Abbildung ließ diese Felder weg und
      // hebelte damit u. a. den Mehrfachversand-Guard des Nachweis-PDFs aus.
      return this.mapDocToAssignment(assignmentDoc);
    } catch (error) {
      const appError = errorHandler.handleFirebaseError(error);
      logger.error('Failed to get assignment by ID', appError);
      throw appError;
    }
  },

  // Get assignments by user ID
  async getByUserId(userId: string, companyId?: string, limitCount = 50): Promise<Assignment[]> {
    if (!db) {
      logger.warn('Firebase not initialized, returning empty array');
      return [];
    }
    try {
      // companyId wird als Parameter übergeben, um SSR-Probleme zu vermeiden
      // Fallback zu getCompanyIdFromAuth() nur wenn nicht übergeben
      let resolvedCompanyId: string | undefined = companyId;
      if (!resolvedCompanyId) {
        const authCompanyId = await getCompanyIdFromAuth();
        resolvedCompanyId = authCompanyId || undefined;
      }
      if (!resolvedCompanyId) {
        logger.warn('No companyId found, returning empty array');
        return [];
      }

      const q = query(
        collection(getDb(), COLLECTION_NAME),
        where('companyId', '==', resolvedCompanyId),
        where('userId', '==', userId),
        orderBy('assignedAt', 'desc'),
        limit(limitCount)
      );

      const snapshot = await getDocs(q);
      const assignments: Assignment[] = [];

      snapshot.forEach(doc => {
        const data = doc.data();
        assignments.push({
          id: doc.id,
          userId: data.userId,
          shiftId: data.shiftId,
          companyId: data.companyId,
          status: data.status,
          assignedAt: data.assignedAt?.toDate() || new Date(),
          acceptedAt: data.acceptedAt?.toDate(),
          declinedAt: data.declinedAt?.toDate(),
          completedAt: data.completedAt?.toDate(),
          notes: data.notes,
          createdAt: data.createdAt?.toDate() || new Date(),
          updatedAt: data.updatedAt?.toDate() || new Date(),
          decidedAt: data.decidedAt?.toDate(),
          declineReason: data.declineReason,
          requiresSignature: data.requiresSignature,
          signedBy: data.signedBy,
          signedAt: data.signedAt?.toDate(),
          penaltyFlag: data.penaltyFlag,
        });
      });

      return assignments;
    } catch (error) {
      logger.error('Error getting assignments by user ID', error instanceof Error ? error : new Error(String(error)));
      // Return empty array instead of throwing error
      return [];
    }
  },

  // Get assignments by shift ID
  async getByShiftId(shiftId: string): Promise<Assignment[]> {
    if (!db) {
      logger.warn('Firebase not initialized, returning empty array');
      return [];
    }
    const companyId = await getCompanyIdFromAuth();
    if (!companyId) {
      logger.warn('No companyId found, returning empty array');
      return [];
    }

    const q = query(
      collection(getDb(), COLLECTION_NAME),
      where('companyId', '==', companyId),
      where('shiftId', '==', shiftId),
      orderBy('assignedAt', 'asc')
    );

    const snapshot = await getDocs(q);
    const assignments: Assignment[] = [];

    snapshot.forEach(doc => {
      const data = doc.data();
      assignments.push({
        id: doc.id,
        userId: data.userId,
        shiftId: data.shiftId,
        companyId: data.companyId,
        status: data.status,
        assignedAt: data.assignedAt.toDate(),
        acceptedAt: data.acceptedAt?.toDate(),
        declinedAt: data.declinedAt?.toDate(),
        completedAt: data.completedAt?.toDate(),
        notes: data.notes,
        createdAt: data.createdAt?.toDate() || new Date(),
        updatedAt: data.updatedAt?.toDate() || new Date(),
      });
    });

    return assignments;
  },

  // Get all assignments with pagination
  async getAll(page = 1, pageSize = 50): Promise<PaginatedResponse<Assignment>> {
    if (!db) {
      logger.warn('Firebase not initialized, returning empty result');
      return { data: [], total: 0, page, limit: pageSize, hasMore: false };
    }
    try {
      const companyId = await getCompanyIdFromAuth();
      if (!companyId) {
        logger.warn('No companyId found, returning empty result');
        return { data: [], total: 0, page, limit: pageSize, hasMore: false };
      }

      const q = query(
        collection(getDb(), COLLECTION_NAME),
        where('companyId', '==', companyId),
        orderBy('assignedAt', 'desc'),
        limit(pageSize)
      );

      const snapshot = await getDocs(q);
      const assignments: Assignment[] = [];

      snapshot.forEach(doc => {
        const data = doc.data();
        assignments.push({
          id: doc.id,
          userId: data.userId,
          shiftId: data.shiftId,
          companyId: data.companyId,
          status: data.status,
          assignedAt: data.assignedAt.toDate(),
          acceptedAt: data.acceptedAt?.toDate(),
          declinedAt: data.declinedAt?.toDate(),
          completedAt: data.completedAt?.toDate(),
          notes: data.notes,
          createdAt: data.createdAt?.toDate() || new Date(),
          updatedAt: data.updatedAt?.toDate() || new Date(),
        });
      });

      return {
        data: assignments,
        total: assignments.length,
        page,
        limit: pageSize,
        hasMore: assignments.length === pageSize,
      };
    } catch (error) {
      logger.error('Error getting all assignments', error instanceof Error ? error : new Error(String(error)));
      return { data: [], total: 0, page, limit: pageSize, hasMore: false };
    }
  },

  // Create assignment
  async create(userId: string, shiftId: string, notes?: string): Promise<string> {
    // Hole companyId aus dem Shift (da Assignment zu einem Shift gehört)
    const shiftDoc = await getDoc(doc(getDb(), 'shifts', shiftId));
    if (!shiftDoc.exists()) {
      throw new Error('Shift not found');
    }
    const shiftData = shiftDoc.data();
    const companyId = shiftData.companyId;
    
    if (!companyId) {
      // Fallback: Versuche companyId aus Auth zu holen
      const authCompanyId = await getCompanyIdFromAuth();
      if (!authCompanyId) {
        throw new Error('No companyId found for assignment');
      }
      const docRef = await addDoc(collection(getDb(), COLLECTION_NAME), {
        userId: userId,
        shiftId: shiftId,
        companyId: authCompanyId,
        status: 'pending',
        assignedAt: serverTimestamp(),
        notes,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return docRef.id;
    }

    const docRef = await addDoc(collection(getDb(), COLLECTION_NAME), {
      userId: userId,
      shiftId: shiftId,
      companyId: companyId,
      status: 'pending',
      assignedAt: serverTimestamp(),
      notes,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    return docRef.id;
  },

  // Accept assignment (nur aus offenen Zuständen – kein Wiederbeleben
  // abgelehnter/abgeschlossener Einsätze)
  async accept(id: string): Promise<void> {
    const assignmentRef = doc(getDb(), COLLECTION_NAME, id);
    const snap = await getDoc(assignmentRef);
    if (!snap.exists()) throw new Error('Einsatz nicht gefunden');
    const status = snap.data().status as string;
    if (!['pending', 'assigned', 'requested'].includes(status)) {
      throw new Error(`Einsatz kann im Status „${status}" nicht angenommen werden`);
    }
    await updateDoc(assignmentRef, {
      status: 'accepted',
      acceptedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  },

  // Decline assignment (nur aus offenen Zuständen)
  async decline(id: string): Promise<void> {
    const assignmentRef = doc(getDb(), COLLECTION_NAME, id);
    const snap = await getDoc(assignmentRef);
    if (!snap.exists()) throw new Error('Einsatz nicht gefunden');
    const status = snap.data().status as string;
    if (!['pending', 'assigned', 'requested', 'accepted'].includes(status)) {
      throw new Error(`Einsatz kann im Status „${status}" nicht abgelehnt werden`);
    }
    await updateDoc(assignmentRef, {
      status: 'declined',
      declinedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  },

  // Complete assignment (nur angenommene/zugewiesene Einsätze)
  async complete(id: string): Promise<void> {
    const assignmentRef = doc(getDb(), COLLECTION_NAME, id);
    const snap = await getDoc(assignmentRef);
    if (!snap.exists()) throw new Error('Einsatz nicht gefunden');
    const status = snap.data().status as string;
    if (!['accepted', 'assigned'].includes(status)) {
      throw new Error(`Einsatz kann im Status „${status}" nicht abgeschlossen werden`);
    }
    await updateDoc(assignmentRef, {
      status: 'completed',
      completedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  },

  // Update assignment
  async update(id: string, data: Partial<Assignment>): Promise<void> {
    const assignmentRef = doc(getDb(), COLLECTION_NAME, id);
    await updateDoc(assignmentRef, {
      ...data,
      updatedAt: serverTimestamp(),
    });
  },

  // Delete assignment
  async delete(id: string): Promise<void> {
    await deleteDoc(doc(getDb(), COLLECTION_NAME, id));
  },

  /** Benachrichtigt Admins über Formular-Status (Einsatzmitteilung/Ablehnung). */
  async notifyAdminsAboutFormStatus(_assignmentId: string, _reason: string): Promise<void> {
    // Stub: Backend/Cloud Function kann später angebunden werden.
  },

  // Get assignments by status
  async getByStatus(status: Assignment['status']): Promise<Assignment[]> {
    const companyId = await getCompanyIdFromAuth();
    if (!companyId) {
      logger.warn('No companyId found, returning empty array');
      return [];
    }

    const q = query(
      collection(getDb(), COLLECTION_NAME),
      where('companyId', '==', companyId),
      where('status', '==', status),
      orderBy('assignedAt', 'desc')
    );

    const snapshot = await getDocs(q);
    const assignments: Assignment[] = [];

    snapshot.forEach(doc => {
      const data = doc.data();
      assignments.push({
        id: doc.id,
        userId: data.userId,
        shiftId: data.shiftId,
        companyId: data.companyId,
        status: data.status,
        assignedAt: data.assignedAt.toDate(),
        acceptedAt: data.acceptedAt?.toDate(),
        declinedAt: data.declinedAt?.toDate(),
        completedAt: data.completedAt?.toDate(),
        notes: data.notes,
        createdAt: data.createdAt?.toDate() || new Date(),
        updatedAt: data.updatedAt?.toDate() || new Date(),
      });
    });

    return assignments;
  },

  // Bulk update assignments
  async bulkUpdate(ids: string[], updates: Partial<Assignment>): Promise<void> {
    const promises = ids.map(id => {
      const assignmentRef = doc(getDb(), COLLECTION_NAME, id);
      return updateDoc(assignmentRef, {
        ...updates,
        updatedAt: serverTimestamp(),
      });
    });

    await Promise.all(promises);
  },

  // Neue Methoden für erweiterte Assignment-Verwaltung
  async createRequest(userId: string, shiftId: string, notes?: string): Promise<string> {
    // Hole companyId aus dem Shift
    const shiftDoc = await getDoc(doc(getDb(), 'shifts', shiftId));
    if (!shiftDoc.exists()) {
      throw new Error('Shift not found');
    }
    const shiftData = shiftDoc.data();
    const companyId = shiftData.companyId || await getCompanyIdFromAuth();
    
    if (!companyId) {
      throw new Error('No companyId found for assignment');
    }

    const docRef = await addDoc(collection(getDb(), COLLECTION_NAME), {
      userId: userId,
      shiftId: shiftId,
      companyId: companyId,
      status: 'requested',
      assignedAt: serverTimestamp(),
      notes,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    return docRef.id;
  },

  async getByUserAndDateRange(
    userId: string,
    startDate: Date,
    endDate: Date,
    companyId?: string
  ): Promise<Assignment[]> {
    // companyId wird als Parameter übergeben, um SSR-Probleme zu vermeiden
    // Fallback zu getCompanyIdFromAuth() nur wenn nicht übergeben
    let resolvedCompanyId: string | undefined = companyId;
    if (!resolvedCompanyId) {
      const authCompanyId = await getCompanyIdFromAuth();
      resolvedCompanyId = authCompanyId || undefined;
    }
    if (!resolvedCompanyId) {
      logger.warn('No companyId found, returning empty array');
      return [];
    }

    // Temporarily simplified query to avoid index requirements
    const q = query(
      collection(getDb(), COLLECTION_NAME), 
      where('companyId', '==', resolvedCompanyId),
      where('userId', '==', userId)
    );

    const snapshot = await getDocs(q);
    const assignments: Assignment[] = [];

    snapshot.forEach(doc => {
      const data = doc.data();
      assignments.push({
        id: doc.id,
        userId: data.userId,
        shiftId: data.shiftId,
        companyId: data.companyId,
        status: data.status,
        assignedAt: data.assignedAt?.toDate?.() || new Date(),
        acceptedAt: data.acceptedAt?.toDate(),
        declinedAt: data.declinedAt?.toDate(),
        completedAt: data.completedAt?.toDate(),
        notes: data.notes,
        createdAt: data.createdAt?.toDate() || new Date(),
        updatedAt: data.updatedAt?.toDate() || new Date(),
        // Neue Felder
        decidedAt: data.decidedAt?.toDate(),
        declineReason: data.declineReason,
        requiresSignature: data.requiresSignature,
        signedBy: data.signedBy,
        signedAt: data.signedAt?.toDate(),
        penaltyFlag: data.penaltyFlag,
      });
    });

    const startTime = startDate.getTime();
    const endTime = endDate.getTime();

    // Nach SCHICHTDATUM filtern (nicht nach assignedAt = Zuweisungszeitpunkt):
    // Der Dienstplan fragt „welche Einsätze finden in diesem Zeitraum statt".
    const { shiftService } = await import('./shifts');
    const filtered: Assignment[] = [];
    for (const assignment of assignments) {
      try {
        const shift = await shiftService.getById(assignment.shiftId);
        if (!shift?.date) continue;
        const shiftTime = new Date(shift.date).getTime();
        if (shiftTime >= startTime && shiftTime <= endTime) {
          filtered.push(assignment);
        }
      } catch {
        // Schicht nicht ladbar → Assignment nicht zuordenbar, überspringen
      }
    }
    return filtered;
  },

  async getActiveByShift(shiftId: string): Promise<Assignment[]> {
    const companyId = await getCompanyIdFromAuth();
    if (!companyId) {
      logger.warn('No companyId found, returning empty array');
      return [];
    }

    // Temporarily simplified query to avoid index requirements
    const q = query(
      collection(getDb(), COLLECTION_NAME), 
      where('companyId', '==', companyId),
      where('shiftId', '==', shiftId)
    );

const snapshot = await getDocs(q);
const assignments: Assignment[] = [];

snapshot.forEach(doc => {
  const data = doc.data();
  assignments.push({
    id: doc.id,
    userId: data.userId,
    shiftId: data.shiftId,
    companyId: data.companyId,
    status: data.status,
    assignedAt: data.assignedAt.toDate(),
    acceptedAt: data.acceptedAt?.toDate(),
    declinedAt: data.declinedAt?.toDate(),
    completedAt: data.completedAt?.toDate(),
    notes: data.notes,
    createdAt: data.createdAt?.toDate() || new Date(),
    updatedAt: data.updatedAt?.toDate() || new Date(),
    // Neue Felder
    decidedAt: data.decidedAt?.toDate(),
    declineReason: data.declineReason,
    requiresSignature: data.requiresSignature,
    signedBy: data.signedBy,
    signedAt: data.signedAt?.toDate(),
    penaltyFlag: data.penaltyFlag,
  });
});

return assignments;
  },

  async bulkAssign(shiftId: string, userIds: string[]): Promise<string[]> {
    try {
      // Hole companyId aus dem Shift
      const shiftDoc = await getDoc(doc(getDb(), 'shifts', shiftId));
      if (!shiftDoc.exists()) {
        throw new Error('Shift not found');
      }
      const shiftData = shiftDoc.data();
      const companyId = shiftData.companyId || await getCompanyIdFromAuth();
      
      if (!companyId) {
        throw new Error('No companyId found for assignment');
      }

      const _assignmentIds: string[] = [];

      for (const userId of userIds) {
        const docRef = await addDoc(collection(getDb(), COLLECTION_NAME), {
          userId: userId,
          shiftId: shiftId,
          companyId: companyId,
          status: 'assigned',
          assignedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        _assignmentIds.push(docRef.id);
      }

      return _assignmentIds;
    } catch (error) {
      throw error;
    }
  },

  // Neue Methoden für Pflegekraft-Daten
  async getMyActiveAssignments(userId: string): Promise<Assignment[]> {
    let companyId = await getCompanyIdFromAuth();
    
    // Fallback: Versuche companyId aus User-Dokument zu holen, falls Custom Claims noch nicht geladen sind
    if (!companyId) {
      try {
        const userDoc = await getDoc(doc(getDb(), 'users', userId));
        if (userDoc.exists()) {
          const userData = userDoc.data();
          companyId = userData.companyId;
        }
      } catch (error) {
        logger.warn('Failed to get companyId from user document', {}, { error: error instanceof Error ? error.message : String(error) });
      }
    }
    
    // Query aufbauen - mit oder ohne companyId Filter
    let q;
    if (companyId) {
      // Normale Abfrage mit companyId (Production)
      q = query(
        collection(getDb(), COLLECTION_NAME),
        where('companyId', '==', companyId),
        where('userId', '==', userId),
        where('status', 'in', ['assigned', 'accepted']),
        orderBy('assignedAt', 'asc')
      );
    } else {
      // Fallback: Ohne companyId Filter (nur für Development/Testing)
      // WARNUNG: Dies umgeht die Mandantenisolation und sollte nur in Development verwendet werden
      // In Development: Nur Info-Level, nicht Warnung (App funktioniert trotzdem)
      if (process.env.NODE_ENV === 'development') {
        logger.info('No companyId found for user - querying assignments without companyId filter (Development mode)', { userId });
      } else {
        logger.warn('No companyId found for user - querying assignments without companyId filter. This may indicate a configuration issue', { userId });
      }
      q = query(
        collection(getDb(), COLLECTION_NAME),
        where('userId', '==', userId),
        where('status', 'in', ['assigned', 'accepted']),
        orderBy('assignedAt', 'asc')
      );
    }

const snapshot = await getDocs(q);
const assignments: Assignment[] = [];

snapshot.forEach(doc => {
  const data = doc.data();
  assignments.push({
    id: doc.id,
    userId: data.userId,
    shiftId: data.shiftId,
    companyId: data.companyId,
    status: data.status,
    assignedAt: data.assignedAt.toDate(),
    acceptedAt: data.acceptedAt?.toDate(),
    declinedAt: data.declinedAt?.toDate(),
    completedAt: data.completedAt?.toDate(),
    notes: data.notes,
    createdAt: data.createdAt?.toDate() || new Date(),
    updatedAt: data.updatedAt?.toDate() || new Date(),
    // Neue Felder
    decidedAt: data.decidedAt?.toDate(),
    declineReason: data.declineReason,
    requiresSignature: data.requiresSignature,
    signedBy: data.signedBy,
    signedAt: data.signedAt?.toDate(),
    penaltyFlag: data.penaltyFlag,
  });
});

return assignments;
  },

  async getMyPendingAssignments(userId: string): Promise<Assignment[]> {
    let companyId = await getCompanyIdFromAuth();
    
    // Fallback: Versuche companyId aus User-Dokument zu holen, falls Custom Claims noch nicht geladen sind
    if (!companyId) {
      try {
        const userDoc = await getDoc(doc(getDb(), 'users', userId));
        if (userDoc.exists()) {
          const userData = userDoc.data();
          companyId = userData.companyId;
        }
      } catch (error) {
        logger.warn('Failed to get companyId from user document', {}, { error: error instanceof Error ? error.message : String(error) });
      }
    }
    
    if (!companyId) {
      logger.warn('No companyId found, returning empty array');
      return [];
    }

    const q = query(
      collection(getDb(), COLLECTION_NAME),
      where('companyId', '==', companyId),
      where('userId', '==', userId),
      where('status', '==', 'pending'),
      orderBy('assignedAt', 'asc')
    );

const snapshot = await getDocs(q);
const assignments: Assignment[] = [];

snapshot.forEach(doc => {
  const data = doc.data();
  assignments.push({
    id: doc.id,
    userId: data.userId,
    shiftId: data.shiftId,
    companyId: data.companyId,
    status: data.status,
    assignedAt: data.assignedAt.toDate(),
    acceptedAt: data.acceptedAt?.toDate(),
    declinedAt: data.declinedAt?.toDate(),
    completedAt: data.completedAt?.toDate(),
    notes: data.notes,
    createdAt: data.createdAt?.toDate() || new Date(),
    updatedAt: data.updatedAt?.toDate() || new Date(),
    // Neue Felder
    decidedAt: data.decidedAt?.toDate(),
    declineReason: data.declineReason,
    requiresSignature: data.requiresSignature,
    signedBy: data.signedBy,
    signedAt: data.signedAt?.toDate(),
    penaltyFlag: data.penaltyFlag,
  });
});

return assignments;
  },

  async checkConflict(userId: string, shiftId: string): Promise<{
    hasConflict: boolean;
    conflictShift?: Record<string, unknown>;
    conflictAssignment?: Record<string, unknown>;
    conflictDetails?: string;
  } | null> {
    try {
      const companyId = await getCompanyIdFromAuth();
      if (!companyId) {
        return { hasConflict: false };
      }

      // Get user's existing assignments
      const userAssignmentsQuery = query(
        collection(getDb(), COLLECTION_NAME),
        where('companyId', '==', companyId),
        where('userId', '==', userId),
        where('status', 'in', ['assigned', 'accepted'])
      );

      const userAssignmentsSnapshot = await getDocs(userAssignmentsQuery);

      // Get the new shift data
      const shiftDoc = await getDoc(doc(getDb(), 'shifts', shiftId));
      if (!shiftDoc.exists()) return null;

      const newShift = { id: shiftDoc.id, ...shiftDoc.data() };

      // Check for conflicts with existing assignments
      for (const assignmentDoc of userAssignmentsSnapshot.docs) {
        const assignment = assignmentDoc.data();
        const existingShiftDoc = await getDoc(doc(getDb(), 'shifts', assignment.shiftId));

        if (existingShiftDoc.exists()) {
          const existingShiftData = existingShiftDoc.data() as Record<string, unknown>;
          const existingShift = { id: existingShiftDoc.id, ...existingShiftData };

          // Convert to format expected by checkTimeOverlap
          const newShiftData = newShift as Record<string, unknown>;
          const newShiftForCheck = {
            date: (newShiftData.date as { toDate?: () => Date })?.toDate?.()?.toISOString().split('T')[0] || String(newShiftData.date || ''),
            startTime: String(newShiftData.startTime || ''),
            endTime: String(newShiftData.endTime || ''),
          };
          const existingShiftForCheck = {
            date: (existingShiftData.date as { toDate?: () => Date })?.toDate?.()?.toISOString().split('T')[0] || String(existingShiftData.date || ''),
            startTime: String(existingShiftData.startTime || ''),
            endTime: String(existingShiftData.endTime || ''),
          };

          if (this.checkTimeOverlap(newShiftForCheck, existingShiftForCheck)) {
            return {
              hasConflict: true,
              conflictShift: existingShift,
              conflictAssignment: { id: assignmentDoc.id, ...assignment },
              conflictDetails: `Zeitkonflikt mit bestehender Schicht`,
            };
          }
        }
      }

      return { hasConflict: false };
    } catch (error) {
      throw error;
    }
  },

  // Helper method for time overlap checking
  checkTimeOverlap(shift1: { date: string; startTime: string; endTime: string }, shift2: { date: string; startTime: string; endTime: string }): boolean {
    const DAY_MS = 24 * 60 * 60 * 1000;
    const start1 = new Date(shift1.date).getTime() + this.timeToMs(shift1.startTime);
    let end1 = new Date(shift1.date).getTime() + this.timeToMs(shift1.endTime);
    const start2 = new Date(shift2.date).getTime() + this.timeToMs(shift2.startTime);
    let end2 = new Date(shift2.date).getTime() + this.timeToMs(shift2.endTime);

    // Nachtschicht über Mitternacht: Ende auf den Folgetag normalisieren
    // (vorher wurden Konflikte mit Nachtschichten nie erkannt)
    if (end1 <= start1) end1 += DAY_MS;
    if (end2 <= start2) end2 += DAY_MS;

    return start1 < end2 && start2 < end1;
  },

  timeToMs(timeString: string): number {
    const [hours, minutes] = timeString.split(':').map(Number);
    return (hours * 60 + minutes) * 60 * 1000;
  },

  /**
   * Batch-Konfliktprüfung für mehrere User bzgl. einer Schicht (z. B. für AssignShiftDialog).
   * Gibt pro userId zurück, ob ein Zeitkonflikt mit einer bestehenden Zuweisung besteht.
   */
  async checkConflictsForShift(
    shiftId: string,
    userIds: string[]
  ): Promise<Record<string, { hasConflict: boolean; conflictDetails?: string }>> {
    const result: Record<string, { hasConflict: boolean; conflictDetails?: string }> = {};
    if (userIds.length === 0) return result;
    try {
      const companyId = await getCompanyIdFromAuth();
      if (!companyId) {
        userIds.forEach(uid => (result[uid] = { hasConflict: false }));
        return result;
      }

      const shiftDoc = await getDoc(doc(getDb(), 'shifts', shiftId));
      if (!shiftDoc.exists()) {
        userIds.forEach(uid => (result[uid] = { hasConflict: false }));
        return result;
      }
      const newShiftData = shiftDoc.data() as Record<string, unknown>;
      const newShiftForCheck = {
        date: (newShiftData.date as { toDate?: () => Date })?.toDate?.()?.toISOString().split('T')[0] ?? String(newShiftData.date ?? ''),
        startTime: String(newShiftData.startTime ?? ''),
        endTime: String(newShiftData.endTime ?? ''),
      };

      const CHUNK = 10;
      const assignmentDocs: { userId: string; shiftId: string; assignmentId: string }[] = [];
      for (let i = 0; i < userIds.length; i += CHUNK) {
        const chunk = userIds.slice(i, i + CHUNK);
        const q = query(
          collection(getDb(), COLLECTION_NAME),
          where('companyId', '==', companyId),
          where('userId', 'in', chunk),
          where('status', 'in', ['assigned', 'accepted'])
        );
        const snap = await getDocs(q);
        snap.docs.forEach(d => {
          const a = d.data();
          if (a.shiftId !== shiftId) {
            assignmentDocs.push({ userId: a.userId as string, shiftId: a.shiftId as string, assignmentId: d.id });
          }
        });
      }

      const uniqueShiftIds = [...new Set(assignmentDocs.map(a => a.shiftId))];
      const shiftDataById: Record<string, { date: string; startTime: string; endTime: string }> = {};
      for (const sid of uniqueShiftIds) {
        const d = await getDoc(doc(getDb(), 'shifts', sid));
        if (d.exists()) {
          const data = d.data() as Record<string, unknown>;
          const date = (data.date as { toDate?: () => Date })?.toDate?.()?.toISOString().split('T')[0] ?? String(data.date ?? '');
          shiftDataById[sid] = {
            date,
            startTime: String(data.startTime ?? ''),
            endTime: String(data.endTime ?? ''),
          };
        }
      }

      userIds.forEach(uid => (result[uid] = { hasConflict: false }));
      for (const { userId, shiftId: existingShiftId } of assignmentDocs) {
        const existing = shiftDataById[existingShiftId];
        if (!existing) continue;
        if (this.checkTimeOverlap(newShiftForCheck, existing)) {
          result[userId] = { hasConflict: true, conflictDetails: 'Zeitkonflikt mit bestehender Schicht' };
        }
      }
      return result;
    } catch (error) {
      logger.error('checkConflictsForShift failed', error as Error);
      userIds.forEach(uid => (result[uid] = { hasConflict: false }));
      return result;
    }
  },

  // Get today's assignment for a user (only accepted or assigned)
  async getTodayAssignment(userId: string): Promise<Assignment | null> {
    try {
      if (!getDb()) {
        logger.warn('Firebase not initialized, returning null');
        return null;
      }

      const companyId = await getCompanyIdFromAuth();
      if (!companyId) {
        logger.warn('No companyId found, returning null');
        return null;
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      // „Heutiger Einsatz" = die SCHICHT findet heute statt (nicht: die
      // Zuweisung wurde heute erstellt). Deshalb aktive Assignments laden
      // und über das Schichtdatum filtern.
      const assignments = await this.getByUserId(userId, companyId, 100);
      const active = assignments.filter(
        a => a.status === 'accepted' || a.status === 'assigned'
      );
      if (active.length === 0) return null;

      const { shiftService } = await import('./shifts');
      for (const assignment of active) {
        try {
          const shift = await shiftService.getById(assignment.shiftId);
          if (!shift?.date) continue;
          const shiftDate = new Date(shift.date);
          if (shiftDate >= today && shiftDate < tomorrow) {
            return assignment;
          }
        } catch {
          // Schicht nicht ladbar → nächstes Assignment prüfen
        }
      }

      return null;
    } catch (error) {
      logger.error('Error fetching today assignment', error instanceof Error ? error : new Error(String(error)));
      // Nicht weiterwerfen, sondern null zurückgeben, um 500-Fehler zu vermeiden
      return null;
    }
  },

  // Get upcoming assignments for a user
  async getUpcomingAssignments(userId: string): Promise<Assignment[]> {
    try {
      const companyId = await getCompanyIdFromAuth();
      if (!companyId) {
        return [];
      }

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);

      // „Kommende Einsätze" = SCHICHTEN ab morgen (die frühere Query auf
      // assignedAt >= morgen war immer leer, da assignedAt der
      // Erstellungszeitpunkt ist und nie in der Zukunft liegt).
      const assignments = await this.getByUserId(userId, companyId, 100);
      const active = assignments.filter(
        a => a.status === 'accepted' || a.status === 'assigned'
      );

      const { shiftService } = await import('./shifts');
      const upcoming: Array<{ assignment: Assignment; date: Date }> = [];
      for (const assignment of active) {
        try {
          const shift = await shiftService.getById(assignment.shiftId);
          if (!shift?.date) continue;
          const shiftDate = new Date(shift.date);
          if (shiftDate >= tomorrow) {
            upcoming.push({ assignment, date: shiftDate });
          }
        } catch {
          // Schicht nicht ladbar → überspringen
        }
      }
      upcoming.sort((a, b) => a.date.getTime() - b.date.getTime());
      return upcoming.slice(0, 5).map(u => u.assignment);
    } catch (error) {
      logger.error('Error fetching upcoming assignments', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  },

  // Helper method to map Firestore document to Assignment
  mapDocToAssignment(doc: { id: string; data: () => Record<string, unknown> }): Assignment {
    const data = doc.data();
    const assignedAt = (data.assignedAt as { toDate?: () => Date } | undefined)?.toDate?.() || new Date();
    const acceptedAt = (data.acceptedAt as { toDate?: () => Date } | undefined)?.toDate?.();
    const declinedAt = (data.declinedAt as { toDate?: () => Date } | undefined)?.toDate?.();
    const completedAt = (data.completedAt as { toDate?: () => Date } | undefined)?.toDate?.();
    const createdAt = (data.createdAt as { toDate?: () => Date } | undefined)?.toDate?.() || new Date();
    const updatedAt = (data.updatedAt as { toDate?: () => Date } | undefined)?.toDate?.() || new Date();
    const decidedAt = (data.decidedAt as { toDate?: () => Date } | undefined)?.toDate?.();
    const signedAt = (data.signedAt as { toDate?: () => Date } | undefined)?.toDate?.();
    
    return {
      id: doc.id,
      userId: data.userId as string,
      shiftId: data.shiftId as string,
      companyId: data.companyId as string,
      status: data.status as Assignment['status'],
      assignedAt,
      acceptedAt,
      declinedAt,
      completedAt,
      notes: data.notes as string | undefined,
      createdAt,
      updatedAt,
      decidedAt,
      declineReason: data.declineReason as string | undefined,
      requiresSignature: data.requiresSignature as boolean | undefined,
      signedBy: data.signedBy as string | undefined,
      signedAt,
      penaltyFlag: data.penaltyFlag as boolean | undefined,
      employeeSignatureUrl: data.employeeSignatureUrl as string | undefined,
      employeeSignedAt: (data.employeeSignedAt as { toDate?: () => Date } | undefined)?.toDate?.(),
      adminSignatureUrl: data.adminSignatureUrl as string | undefined,
      adminSignedAt: (data.adminSignedAt as { toDate?: () => Date } | undefined)?.toDate?.(),
      adminSignerName: data.adminSignerName as string | undefined,
      relievingSignatures: (data.relievingSignatures as Array<{
        date: string;
        signerName: string;
        signerRole?: string;
        signatureUrl: string;
        signedAt: Date | { toDate: () => Date };
        timesheetId?: string;
        verifiedTimes?: {
          startTime: string;
          endTime: string;
          breakMinutes: number;
          totalHours: number;
        };
      }> | undefined)?.map(sig => ({
        ...sig,
        signedAt: sig.signedAt instanceof Date ? sig.signedAt : (sig.signedAt as { toDate: () => Date }).toDate()
      })),
      signatureSchedule: data.signatureSchedule ? {
        requiredDates: ((data.signatureSchedule as { requiredDates?: Array<{ toDate?: () => Date } | Date> }).requiredDates as Array<{ toDate?: () => Date } | Date>)?.map((d: { toDate?: () => Date } | Date) => 
          d instanceof Date ? d : (d as { toDate: () => Date }).toDate()
        ) || [],
        collectedDates: ((data.signatureSchedule as { collectedDates?: string[] }).collectedDates as string[]) || [],
        nextRequiredDate: (() => {
          const schedule = data.signatureSchedule as { nextRequiredDate?: Date | { toDate: () => Date } | string | number };
          if (!schedule.nextRequiredDate) return undefined;
          const nextDate = schedule.nextRequiredDate;
          if (nextDate instanceof Date) return nextDate;
          if (typeof nextDate === 'object' && 'toDate' in nextDate && typeof (nextDate as { toDate: () => Date }).toDate === 'function') {
            return (nextDate as { toDate: () => Date }).toDate();
          }
          return new Date(nextDate as string | number);
        })(),
      } : undefined,
      pdfGenerated: data.pdfGenerated as boolean | undefined,
      pdfGeneratedAt: (data.pdfGeneratedAt as { toDate?: () => Date } | undefined)?.toDate?.(),
      pdfUrl: data.pdfUrl as string | undefined,
      formPdfUrl: data.formPdfUrl as string | undefined,
      formPdfGeneratedAt: (data.formPdfGeneratedAt as { toDate?: () => Date } | undefined)?.toDate?.(),
      pdfSentTo: data.pdfSentTo as { employee: boolean; admin: boolean; facility: boolean } | undefined,
      formStatus: data.formStatus as Assignment['formStatus'],
      formPlace: data.formPlace as string | undefined,
      formTimes: data.formTimes as string | undefined,
      formNotes: data.formNotes as string | undefined,
      formSignatureName: data.formSignatureName as string | undefined,
      formSignedAt: (data.formSignedAt as { toDate?: () => Date } | undefined)?.toDate?.(),
      dailySignatures: (data.dailySignatures as Array<{ date: string; name: string; signedAt: Date | { toDate: () => Date } }> | undefined)?.map(sig => ({
        ...sig,
        signedAt: sig.signedAt instanceof Date ? sig.signedAt : (sig.signedAt as { toDate: () => Date }).toDate(),
      })),
      finalSummarySignedBy: data.finalSummarySignedBy as string | undefined,
      finalSummarySignedAt: (data.finalSummarySignedAt as { toDate?: () => Date } | undefined)?.toDate?.(),
    };
  },

  // Add relieving personnel signature
  async addRelievingSignature(
    assignmentId: string,
    signatureData: {
      date: string;
      signerName: string;
      signerRole?: string;
      signatureUrl: string;
      signedAt: Date;
      timesheetId?: string;
      verifiedTimes?: {
        startTime: string;
        endTime: string;
        breakMinutes: number;
        totalHours: number;
      };
    }
  ): Promise<void> {
    try {
      const assignmentRef = doc(getDb(), COLLECTION_NAME, assignmentId);
      const assignmentDoc = await getDoc(assignmentRef);

      if (!assignmentDoc.exists()) {
        throw new Error('Assignment not found');
      }

      const currentData = assignmentDoc.data();
      const existingSignatures = (currentData.relievingSignatures as Array<{
        date: string;
        signerName: string;
        signerRole?: string;
        signatureUrl: string;
        signedAt: Date | { toDate: () => Date };
        timesheetId?: string;
        verifiedTimes?: {
          startTime: string;
          endTime: string;
          breakMinutes: number;
          totalHours: number;
        };
      }>) || [];

      // Check if signature for this date already exists
      const existingIndex = existingSignatures.findIndex(sig => sig.date === signatureData.date);
      
      const newSignature = {
        date: signatureData.date,
        signerName: signatureData.signerName,
        signerRole: signatureData.signerRole,
        signatureUrl: signatureData.signatureUrl,
        signedAt: signatureData.signedAt,
        timesheetId: signatureData.timesheetId,
        verifiedTimes: signatureData.verifiedTimes,
      };

      let updatedSignatures: typeof existingSignatures;
      if (existingIndex >= 0) {
        // Update existing signature
        updatedSignatures = [...existingSignatures];
        updatedSignatures[existingIndex] = newSignature;
      } else {
        // Add new signature
        updatedSignatures = [...existingSignatures, newSignature];
      }

      // Update collected dates in signature schedule
      const collectedDates = (currentData.signatureSchedule?.collectedDates as string[]) || [];
      if (!collectedDates.includes(signatureData.date)) {
        collectedDates.push(signatureData.date);
      }

      // Update signature schedule
      const signatureSchedule = currentData.signatureSchedule || {};
      const updatedSchedule = {
        ...signatureSchedule,
        collectedDates,
      };

      await updateDoc(assignmentRef, {
        relievingSignatures: updatedSignatures,
        signatureSchedule: updatedSchedule,
        updatedAt: serverTimestamp(),
      });

      // Check if all signatures are collected and generate PDF if so
      await this.checkAndGeneratePDFIfComplete(assignmentId);
    } catch (error) {
      logger.error('Error adding relieving signature', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  },

  // Check if all signatures are collected and generate PDF automatically
  async checkAndGeneratePDFIfComplete(assignmentId: string): Promise<void> {
    try {
      const assignment = await this.getById(assignmentId);
      if (!assignment) {
        return;
      }

      // Skip if PDF already generated
      if (assignment.pdfGenerated) {
        return;
      }

      // Check if all signatures collected inline.
      // WICHTIG: echte Teilmengen-Prüfung statt Längenvergleich – eine Signatur für
      // einen NICHT geforderten Tag hätte sonst einen fehlenden Pflichttag
      // "aufgefüllt" und den Nachweis vorzeitig als vollständig gemeldet.
      const toDateKey = (value: Date | string): string => {
        const d = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      };
      const areAllSignaturesCollected = (schedule: typeof assignment.signatureSchedule) => {
        if (!schedule?.requiredDates?.length) return true;
        const collected = new Set((schedule.collectedDates || []).map(toDateKey));
        return schedule.requiredDates.every(required => collected.has(toDateKey(required)));
      };

      const allRelievingSignaturesCollected = areAllSignaturesCollected(assignment.signatureSchedule);

      if (!allRelievingSignaturesCollected) {
        return; // Not all signatures collected yet
      }

      // Mitarbeiter-Signaturen sind vollständig → Nachweis sofort versenden.
      // Die Einrichtungssignatur ist KEINE Voraussetzung (Entscheidung 22.07.2026):
      // fehlt sie, wird der Nachweis mit Vermerk „Einrichtungssignatur ausstehend"
      // an Mitarbeiter, Einrichtung und die Zentrale verschickt.
      await this.generateSignaturePDFAndSendEmails(assignmentId);
    } catch (error) {
      logger.error('Error checking and generating PDF', error instanceof Error ? error : new Error(String(error)));
      // Don't throw - this is a background check
    }
  },

  // Generate PDF and send emails for completed assignment signatures
  async generateSignaturePDFAndSendEmails(assignmentId: string): Promise<{ pdfUrl: string; emailsSent: boolean }> {
    try {
      const assignment = await this.getById(assignmentId);
      if (!assignment) {
        throw new Error('Assignment not found');
      }

      // Check if PDF already generated
      if (assignment.pdfGenerated && assignment.pdfUrl) {
        return { pdfUrl: assignment.pdfUrl, emailsSent: assignment.pdfSentTo?.employee && assignment.pdfSentTo?.admin && assignment.pdfSentTo?.facility || false };
      }

      // Import services dynamically
      const { documentGenerationService } = await import('./documentGeneration');
      const { shiftService } = await import('./shifts');
      const { facilityService } = await import('./facilities');
      const { userService } = await import('./users');
      const { sendAssignmentSignatureEmail } = await import('./email');
      const { timesheetService } = await import('./timesheets');

      const shift = await shiftService.getById(assignment.shiftId);
      if (!shift) {
        throw new Error('Shift not found');
      }

      const employee = await userService.getById(assignment.userId);
      if (!employee) {
        throw new Error('Employee not found');
      }

      const facility = shift.facilityId ? await facilityService.getById(shift.facilityId) : null;

      // Compute assignment date range
      const shiftDateVal = typeof shift.date === 'string' ? new Date(shift.date) : (shift.date as Date);
      const assignmentStart = shiftDateVal;
      const assignmentEnd = shiftDateVal;

      // Get all timesheets for this assignment
      const timesheets = await timesheetService.getByUserAndDateRange(
        assignment.userId,
        assignmentStart,
        assignmentEnd
      );
      const timesheetIds = timesheets.map(ts => ts.id);

      // Generate PDF
      const pdfResult = await documentGenerationService.generateDocument({
        type: 'assignment-signatures',
        assignmentId: assignment.id,
        timesheetIds,
      });

      // Update assignment with PDF info
      await updateDoc(doc(getDb(), COLLECTION_NAME, assignmentId), {
        pdfGenerated: true,
        pdfGeneratedAt: serverTimestamp(),
        pdfUrl: pdfResult.url,
        updatedAt: serverTimestamp(),
      });

      // Send emails
      const employeeName = employee.displayName || employee.email || 'Unbekannt';
      const facilityName = facility?.name || 'Unbekannt';
      const shiftDate = shiftDateVal.toLocaleDateString('de-DE');

      const emailPromises: Promise<void>[] = [];

      // Email to employee
      if (employee.email) {
        emailPromises.push(
          sendAssignmentSignatureEmail({
            to: employee.email,
            employeeName,
            assignmentId: assignment.id,
            pdfUrl: pdfResult.url,
            facilityName,
            shiftDate,
            recipientType: 'employee',
          }).catch(err => {
            logger.error('Error sending email to employee', err instanceof Error ? err : new Error(String(err)));
          })
        );
      }

      // Email to admin and save document for admins (get admin users from company)
      let adminEmailsSent = false;
      const documentPromises: Promise<void>[] = [];
      
      if (assignment.companyId) {
        try {
          const { userService } = await import('./users');
          const { documentService } = await import('./documents');
          // Get admin users for the company
          const allUsers = await userService.getAll(1, 1000, { 
            role: 'admin', 
            companyId: assignment.companyId 
          });
          const adminUsers = allUsers.data.filter(user => user.id); // Get all admins, not just those with email

          // Send email and save document for all admins
          for (const admin of adminUsers) {
            // Send email (only if email exists)
            if (admin.email) {
              emailPromises.push(
                sendAssignmentSignatureEmail({
                  to: admin.email,
                  employeeName,
                  assignmentId: assignment.id,
                  pdfUrl: pdfResult.url,
                  facilityName,
                  shiftDate,
                  recipientType: 'admin',
                }).then(() => {
                  adminEmailsSent = true;
                }).catch(err => {
                  logger.error(`Error sending email to admin ${admin.email}`, err instanceof Error ? err : new Error(String(err)));
                })
              );
            }

            // Save document in admin's document management (for all admins, even without email)
            documentPromises.push(
              documentService.create({
                userId: admin.id,
                type: 'contract',
                name: `Zeiterfassung mit Unterschriften - ${employeeName} - ${shiftDate}`,
                url: pdfResult.url,
                fileSize: pdfResult.fileSize,
                mimeType: 'application/pdf',
                notes: `Assignment-ID: ${assignment.id}, Einrichtung: ${facilityName}`,
              }).then(() => {
                // Document saved successfully
              }).catch(docErr => {
                logger.error(`Error saving document for admin ${admin.id}`, docErr instanceof Error ? docErr : new Error(String(docErr)));
                // Continue even if document save fails
              })
            );
          }
        } catch (err) {
          logger.error('Error getting admin users', err instanceof Error ? err : new Error(String(err)));
          // Continue even if admin email fails
        }
      }

      // Email to facility
      if (facility?.email) {
        emailPromises.push(
          sendAssignmentSignatureEmail({
            to: facility.email,
            employeeName,
            assignmentId: assignment.id,
            pdfUrl: pdfResult.url,
            facilityName,
            shiftDate,
            recipientType: 'facility',
            }).catch(err => {
              logger.error('Error sending email to facility', err instanceof Error ? err : new Error(String(err)));
            })
        );
      }

      // Email an die Zentrale (info@) – fester Empfänger für jeden Stundennachweis
      try {
        const { getLegalInfo } = await import('@/lib/config/legal');
        const centralEmail = getLegalInfo().contact.email;
        if (centralEmail) {
          emailPromises.push(
            sendAssignmentSignatureEmail({
              to: centralEmail,
              employeeName,
              assignmentId: assignment.id,
              pdfUrl: pdfResult.url,
              facilityName,
              shiftDate,
              recipientType: 'admin',
            }).catch(err => {
              logger.error('Error sending email to central office', err instanceof Error ? err : new Error(String(err)));
            })
          );
        }
      } catch (err) {
        logger.error('Error resolving central office email', err instanceof Error ? err : new Error(String(err)));
      }

      // Wait for all emails and documents to be saved (parallel execution)
      await Promise.allSettled([...emailPromises, ...documentPromises]);

      // Update pdfSentTo status
      await updateDoc(doc(getDb(), COLLECTION_NAME, assignmentId), {
        pdfSentTo: {
          employee: !!employee.email,
          admin: adminEmailsSent,
          facility: !!facility?.email,
        },
        updatedAt: serverTimestamp(),
      });

      return { 
        pdfUrl: pdfResult.url, 
        emailsSent: !!employee.email || adminEmailsSent || !!facility?.email 
      };
    } catch (error) {
      logger.error('Error generating PDF and sending emails', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  },
};
