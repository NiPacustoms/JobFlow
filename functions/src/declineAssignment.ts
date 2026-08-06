import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import { consumesCapacity, releaseShiftCapacity } from './utils/shiftCapacity';

const db = admin.firestore();

/**
 * Cloud Function für Ablehnung von Schichtzuweisungen mit Unterschrifts-Workflow
 * Unterscheidet zwischen nurse-initiated und admin-initiated Ablehnungen
 */
export const declineAssignment = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { assignmentId, declineType, declineReason, adminSignature } = data;

  if (!assignmentId || !declineType) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'assignmentId and declineType are required'
    );
  }

  if (!['nurse-initiated', 'admin-initiated'].includes(declineType)) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'declineType must be nurse-initiated or admin-initiated'
    );
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

      if (declineType === 'nurse-initiated' && !isOwner) {
        throw new functions.https.HttpsError(
          'permission-denied',
          'Only the assigned user can decline their own assignment'
        );
      }

      if (declineType === 'admin-initiated' && !isAdmin) {
        throw new functions.https.HttpsError(
          'permission-denied',
          'Only admins can initiate admin decline'
        );
      }

      // 3. Status-Übergang prüfen
      // Erlaubt: assigned, accepted, requested, pending (alle Status, die abgelehnt werden können)
      if (!['assigned', 'accepted', 'requested', 'pending'].includes(assignment.status)) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'Assignment cannot be declined in current status'
        );
      }

      // 4. Shift-Daten laden
      const shiftRef = db.collection('shifts').doc(assignment.shiftId);
      const shiftDoc = await transaction.get(shiftRef);

      if (!shiftDoc.exists) {
        throw new functions.https.HttpsError('not-found', 'Shift not found');
      }

      const shift = shiftDoc.data()!;

      // Alle Reads VOR den Writes (Firestore-Transaktionsregel): User für die
      // Notification-Collection jetzt lesen, nicht nach den Updates.
      const declinedUserRef = db.collection('users').doc(assignment.userId);
      const declinedUserDoc = await transaction.get(declinedUserRef);

      // 5. Ablehnung verarbeiten
      let newStatus: string;
      let requiresSignature = false;

      if (declineType === 'nurse-initiated') {
        // Mitarbeiter lehnt ab → Unterschrift erforderlich
        newStatus = 'pending-signature';
        requiresSignature = true;
      } else {
        // Admin lehnt ab → direkt declined
        newStatus = 'declined';
        requiresSignature = false;
      }

      // 6. Assignment aktualisieren
      const updateData: Record<string, unknown> = {
        status: newStatus,
        declineReason: declineReason || 'No reason provided',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      if (declineType === 'nurse-initiated') {
        updateData.declinedAt = admin.firestore.FieldValue.serverTimestamp();
        updateData.requiresSignature = true;
      } else {
        updateData.declinedAt = admin.firestore.FieldValue.serverTimestamp();
        updateData.signedBy = context.auth!.uid;
        updateData.signedAt = admin.firestore.FieldValue.serverTimestamp();
      }

      // Wenn Admin-Unterschrift vorhanden (bei nurse-initiated)
      if (declineType === 'nurse-initiated' && adminSignature) {
        updateData.status = 'declined';
        updateData.signedBy = context.auth!.uid;
        updateData.signedAt = admin.firestore.FieldValue.serverTimestamp();
        updateData.requiresSignature = false;
        updateData.penaltyFlag = true; // Flag für mögliche Gehaltsabzüge
      }

      transaction.update(assignmentRef, updateData);

      // 7. Shift-Kapazität aktualisieren (nur wenn Assignment tatsächlich declined
      // UND es überhaupt Kapazität belegt hatte – 'requested'-Anfragen belegen keine).
      if (updateData.status === 'declined' && consumesCapacity(assignment.status)) {
        const { assignedCount: newAssignedCount, status: newShiftStatus } = releaseShiftCapacity(
          shift,
          assignment.status
        );

        transaction.update(shiftRef, {
          assignedCount: newAssignedCount,
          status: newShiftStatus,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      // 8. Notifications
      if (declineType === 'nurse-initiated' && !adminSignature) {
        // Admin-Benachrichtigung für Unterschrift (immer in notifications Collection)
        const adminNotificationRef = db.collection('notifications').doc();
        transaction.set(adminNotificationRef, {
          userId: shift.createdBy, // Admin der die Schicht erstellt hat
          type: 'signature-required',
          title: 'Unterschrift erforderlich',
          message: `Ein Mitarbeiter hat eine Schicht abgelehnt. Unterschrift erforderlich.`,
          actionUrl: `/admin/einsaetze/${assignmentId}`,
          read: false,
          important: true,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } else if (declineType === 'nurse-initiated' && adminSignature) {
        // User-Benachrichtigung über bestätigte Ablehnung (in richtige Collection basierend auf User-Rolle)
        const userRole = declinedUserDoc.exists ? (declinedUserDoc.data()?.role || 'nurse') : 'nurse';
        const notificationCollection = userRole === 'nurse' ? 'employeeNotifications' : 'notifications';
        
        const userNotificationRef = db.collection(notificationCollection).doc();
        transaction.set(userNotificationRef, {
          userId: assignment.userId,
          type: 'assignment-declined',
          title: 'Schichtablehnung bestätigt',
          message: 'Deine Schichtablehnung wurde von einem Admin bestätigt.',
          actionUrl: '/employee/dienstplan',
          read: false,
          priority: 'normal',
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      // 9. Audit Log
      const auditLogRef = db.collection('auditLogs').doc();
      const auditData = {
        userId: context.auth!.uid,
        action:
          declineType === 'nurse-initiated'
            ? 'assignment_declined_by_nurse'
            : 'assignment_declined_by_admin',
        resourceType: 'assignment',
        resourceId: assignmentId,
        changes: {
          status: { old: assignment.status, new: updateData.status },
          declineReason: { old: null, new: updateData.declineReason },
          requiresSignature: { old: false, new: requiresSignature },
        },
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      };

      transaction.set(auditLogRef, auditData);

      return {
        success: true,
        message: requiresSignature
          ? 'Ablehnung gespeichert, Admin-Unterschrift erforderlich'
          : 'Schicht erfolgreich abgelehnt',
        requiresSignature,
        newStatus: updateData.status,
      };
    });
  } catch (error) {
    console.error('Error in declineAssignment:', error);

    if (error instanceof functions.https.HttpsError) {
      throw error;
    }

    throw new functions.https.HttpsError(
      'internal',
      'An error occurred while declining the assignment'
    );
  }
});
