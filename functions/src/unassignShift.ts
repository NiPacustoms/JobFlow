import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import { releaseShiftCapacity } from './utils/shiftCapacity';

const db = admin.firestore();

/**
 * Cloud Function für Rücknahme von Schichtzuweisungen
 * Kann von Admins oder dem betroffenen User (bei eigenen Assignments) aufgerufen werden
 */
export const unassignShift = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { assignmentId, reason } = data;

  if (!assignmentId) {
    throw new functions.https.HttpsError('invalid-argument', 'assignmentId is required');
  }

  try {
    return await db.runTransaction(async transaction => {
      // 1. Assignment laden
      const assignmentRef = db.collection('assignments').doc(assignmentId);
      const assignmentDoc = await transaction.get(assignmentRef);

      if (!assignmentDoc.exists) {
        throw new functions.https.HttpsError('not-found', 'Assignment not found');
      }

      const assignment = assignmentDoc.data()!;

      // 2. Berechtigung prüfen
      const userClaims = context.auth!.token as { role?: string };
      const isAdmin = userClaims.role === 'admin';
      const isOwner = context.auth!.uid === assignment.userId;

      if (!isAdmin && !isOwner) {
        throw new functions.https.HttpsError(
          'permission-denied',
          'Not authorized to unassign this shift'
        );
      }

      // 3. Shift-Daten laden
      const shiftRef = db.collection('shifts').doc(assignment.shiftId);
      const shiftDoc = await transaction.get(shiftRef);

      if (!shiftDoc.exists) {
        throw new functions.https.HttpsError('not-found', 'Shift not found');
      }

      const shift = shiftDoc.data()!;

      // Alle Reads VOR den Writes (Firestore-Transaktionsregel): User für die
      // Notification-Collection jetzt lesen, nicht nach den Updates.
      const userRef = db.collection('users').doc(assignment.userId);
      const userDoc = await transaction.get(userRef);

      // 4. Assignment löschen oder als declined markieren
      if (assignment.status === 'requested') {
        // Bei Anfragen: Assignment löschen
        transaction.delete(assignmentRef);
      } else {
        // Bei zugewiesenen Schichten: als declined markieren
        transaction.update(assignmentRef, {
          status: 'declined',
          declinedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          declineReason: reason || 'Unassigned by admin',
        });
      }

      // 5. Shift-Kapazität aktualisieren (gemeinsame Regel, siehe utils/shiftCapacity).
      // Nur belegende Status ('assigned' | 'accepted' | 'pending') dekrementieren:
      // Ein bereits abgelehntes oder nur angefragtes Assignment hat keinen Platz
      // belegt – es erneut abzuziehen würde den Zähler dauerhaft verfälschen.
      const { assignedCount: newAssignedCount, status: newStatus } = releaseShiftCapacity(
        shift,
        assignment.status
      );

      transaction.update(shiftRef, {
        assignedCount: newAssignedCount,
        status: newStatus,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // 6. Notification an betroffenen User (in richtige Collection basierend auf User-Rolle)
      const userRole = userDoc.exists ? (userDoc.data()?.role || 'nurse') : 'nurse';
      const notificationCollection = userRole === 'nurse' ? 'employeeNotifications' : 'notifications';
      
      const notificationRef = db.collection(notificationCollection).doc();
      const notificationData = {
        userId: assignment.userId,
        type: 'shift-removed',
        title: 'Schichtzuweisung zurückgenommen',
        message: 'Deine Schichtzuweisung wurde zurückgenommen',
        actionUrl: '/employee/dienstplan',
        read: false,
        priority: 'normal',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      transaction.set(notificationRef, notificationData);

      // 7. Audit Log
      const auditLogRef = db.collection('auditLogs').doc();
      const auditData = {
        userId: context.auth!.uid,
        action: 'assignment_unassigned',
        resourceType: 'assignment',
        resourceId: assignmentId,
        changes: {
          status: { old: assignment.status, new: 'declined' },
          assignedCount: { old: shift.assignedCount, new: newAssignedCount },
        },
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      };

      transaction.set(auditLogRef, auditData);

      return {
        success: true,
        message: 'Schichtzuweisung erfolgreich zurückgenommen',
        newAssignedCount,
        newShiftStatus: newStatus,
      };
    });
  } catch (error) {
    console.error('Error in unassignShift:', error);

    if (error instanceof functions.https.HttpsError) {
      throw error;
    }

    throw new functions.https.HttpsError(
      'internal',
      'An error occurred while unassigning the shift'
    );
  }
});
