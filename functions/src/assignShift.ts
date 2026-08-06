import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';

const db = admin.firestore();

/**
 * Normalisiert unterschiedliche Firestore-Datumsrepräsentationen zu Date
 */
function normalizeFirestoreDate(value: unknown): Date | null {
  if (!value) {
    return null;
  }

  // Firestore Timestamp mit toDate()
  if (typeof value === 'object' && value !== null && typeof (value as { toDate?: () => Date }).toDate === 'function') {
    try {
      return (value as { toDate: () => Date }).toDate();
    } catch {
      return null;
    }
  }

  // Bereits ein Date-Objekt
  if (value instanceof Date) {
    return value;
  }

  // Plain object mit seconds (z. B. JSON exportiert)
  if (typeof value === 'object' && value !== null && 'seconds' in (value as Record<string, unknown>)) {
    const seconds = (value as { seconds?: number }).seconds;
    if (typeof seconds === 'number') {
      return new Date(seconds * 1000);
    }
  }

  // ISO-String
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  // Unix timestamp (ms)
  if (typeof value === 'number') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return null;
}

/**
 * Cloud Function für sichere Schichtzuweisung mit vollständiger Validierung
 * Nur Admins können diese Function aufrufen
 */
export const assignShift = functions.https.onCall(async (data, context) => {
  const { checkOverlap, parseShiftToUTC } = await import('./utils/timeUtils');

  // Authentifizierung prüfen
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { shiftId, userId, isRequest = false, adminOverride = false } = data;

  // Log für Debugging
  functions.logger.info('assignShift called', {
    shiftId,
    userId,
    isRequest,
    adminOverride,
    adminOverrideType: typeof adminOverride,
    adminOverrideValue: String(adminOverride),
    hasAdminOverride: adminOverride === true,
    rawData: JSON.stringify(data),
  });

  if (!shiftId || !userId) {
    throw new functions.https.HttpsError('invalid-argument', 'shiftId and userId are required');
  }

  // Rollenprüfung
  const userClaims = context.auth.token as { role?: string };
  if (userClaims.role !== 'admin') {
    throw new functions.https.HttpsError(
      'permission-denied',
      'Only admins can assign shifts'
    );
  }

  try {
    return await db.runTransaction(async transaction => {
      // 1. Shift-Daten laden
      const shiftRef = db.collection('shifts').doc(shiftId);
      const shiftDoc = await transaction.get(shiftRef);

      if (!shiftDoc.exists) {
        throw new functions.https.HttpsError('not-found', 'Shift not found');
      }

      const shift = shiftDoc.data()!;

      // Mandantenisolation: Der aufrufende Admin darf nur Schichten der EIGENEN
      // Company zuweisen. Ohne diese Prüfung könnte ein Admin mit fremder shiftId
      // ein Assignment in einem anderen Mandanten anlegen.
      const callerToken = context.auth!.token as { companyId?: string; claims?: { companyId?: string } };
      const callerCompanyId = callerToken.companyId || callerToken.claims?.companyId;
      if (shift.companyId && callerCompanyId && shift.companyId !== callerCompanyId) {
        throw new functions.https.HttpsError(
          'permission-denied',
          'Shift belongs to a different company'
        );
      }

      const capacity = shift.capacity || 1;
      const assignedCount = shift.assignedCount || 0;

      // 2. Kapazitätsprüfung
      if (assignedCount >= capacity) {
        throw new functions.https.HttpsError('failed-precondition', 'Shift is already full');
      }

      // 3. User-Daten laden
      const userRef = db.collection('users').doc(userId);
      const userDoc = await transaction.get(userRef);

      if (!userDoc.exists) {
        throw new functions.https.HttpsError('not-found', 'User not found');
      }

      const user = userDoc.data()!;

      // Duplikat-Guard: derselbe User darf derselben Schicht nicht zweimal
      // zugewiesen werden (z. B. Doppelklick, Retry, Vorschlags-Chip).
      const duplicateSnap = await transaction.get(
        db
          .collection('assignments')
          .where('shiftId', '==', shiftId)
          .where('userId', '==', userId)
          .where('status', 'in', ['requested', 'assigned', 'accepted', 'pending', 'pending-signature'])
          .limit(1)
      );
      if (!duplicateSnap.empty) {
        throw new functions.https.HttpsError(
          'already-exists',
          'User is already assigned to this shift'
        );
      }

      // 4. Qualifikationsprüfung
      const requiredSkills = shift.requiredSkills || [];
      const userQualifications = user.qualifications || [];

      const missingQualifications = requiredSkills.filter(
        (skill: string) => !userQualifications.includes(skill)
      );

      if (missingQualifications.length > 0 && !isRequest && !adminOverride) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          `Missing qualifications: ${missingQualifications.join(', ')}`
        );
      }

      // 5. Zeitkonflikt-Prüfung
      const shiftDate = normalizeFirestoreDate(shift.date);
      if (!shiftDate) {
        throw new functions.https.HttpsError('invalid-argument', 'Invalid shift date format');
      }

      const { startUTC, endUTC } = parseShiftToUTC(
        shiftDate,
        shift.startTime,
        shift.endTime,
        shift.tz || 'Europe/Berlin'
      );

      // Bestehende Assignments des Users laden
      const existingAssignmentsQuery = db
        .collection('assignments')
        .where('userId', '==', userId)
        .where('status', 'in', ['assigned', 'accepted']);

      const existingAssignments = await transaction.get(existingAssignmentsQuery);

      // Zeitkonflikte prüfen
      const conflicts: Array<{
        assignmentId: string;
        shiftId: string;
        conflictStart: Date;
        conflictEnd: Date;
        facilityName: string;
        stationName: string;
      }> = [];
      for (const assignmentDoc of existingAssignments.docs) {
        const assignment = assignmentDoc.data();
        const existingShiftRef = db.collection('shifts').doc(assignment.shiftId);
        const existingShiftDoc = await transaction.get(existingShiftRef);

        if (existingShiftDoc.exists) {
          const existingShift = existingShiftDoc.data()!;
          const existingShiftDate = normalizeFirestoreDate(existingShift.date);

          if (!existingShiftDate) {
            functions.logger.warn('Skipping conflict check due to invalid existing shift date', {
              existingShiftId: assignment.shiftId,
            });
            continue;
          }

          const { startUTC: existingStartUTC, endUTC: existingEndUTC } = parseShiftToUTC(
            existingShiftDate,
            existingShift.startTime,
            existingShift.endTime,
            existingShift.tz || 'Europe/Berlin'
          );

          if (
            checkOverlap(
              { start: startUTC, end: endUTC },
              { start: existingStartUTC, end: existingEndUTC }
            )
          ) {
            // Facility/Station Namen laden
            const facilityRef = db.collection('facilities').doc(existingShift.facilityId);
            const facilityDoc = await transaction.get(facilityRef);
            const facilityName = facilityDoc.exists ? facilityDoc.data()!.name : 'Unknown';

            conflicts.push({
              assignmentId: assignmentDoc.id,
              shiftId: assignment.shiftId,
              conflictStart: new Date(Math.max(startUTC.getTime(), existingStartUTC.getTime())),
              conflictEnd: new Date(Math.min(endUTC.getTime(), existingEndUTC.getTime())),
              facilityName,
              stationName: existingShift.stationId, // Vereinfacht, sollte Station-Name sein
            });
          }
        }
      }

      if (conflicts.length > 0 && !isRequest && !adminOverride) {
        functions.logger.warn('Time conflict detected but adminOverride is false', {
          conflicts: conflicts.length,
          adminOverride,
          isRequest,
        });
        throw new functions.https.HttpsError(
          'failed-precondition',
          `Time conflicts detected: ${conflicts.length} overlapping shifts`
        );
      }
      
      if (conflicts.length > 0 && adminOverride) {
        functions.logger.info('Time conflict detected but adminOverride is true - allowing assignment', {
          conflicts: conflicts.length,
        });
      }

      // 6. Assignment erstellen
      // WICHTIG: companyId aus Shift holen, damit Frontend-Queries funktionieren
      // Fallback-Kette: Shift -> User -> Admin-Token (claims.companyId)
      const adminToken = context.auth?.token as { companyId?: string; claims?: { companyId?: string } } | undefined;
      const tokenCompanyId = adminToken?.companyId || adminToken?.claims?.companyId;
      const shiftCompanyId = shift.companyId || user.companyId || tokenCompanyId;
      if (!shiftCompanyId) {
        functions.logger.error('No companyId found', {
          shiftId,
          userId,
          shiftHasCompanyId: !!shift.companyId,
          userHasCompanyId: !!user.companyId,
          tokenHasCompanyId: !!tokenCompanyId,
          tokenKeys: adminToken ? Object.keys(adminToken) : [],
        });
        throw new functions.https.HttpsError(
          'failed-precondition',
          'Shift, user, or admin token must have a companyId'
        );
      }

      const assignmentRef = db.collection('assignments').doc();
      const assignmentData = {
        userId,
        shiftId,
        companyId: shiftCompanyId, // WICHTIG: companyId für Mandantenisolation
        status: isRequest ? 'requested' : 'assigned',
        assignedAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        ...(isRequest && { requiresSignature: false }),
      };

      transaction.set(assignmentRef, assignmentData);

      // 7. Shift-Status aktualisieren (App erwartet 'open' | 'filled' | 'cancelled', nicht 'assigned')
      const newAssignedCount = assignedCount + 1;
      const newStatus = newAssignedCount >= capacity ? 'filled' : 'open';

      transaction.update(shiftRef, {
        assignedCount: newAssignedCount,
        status: newStatus,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // 8. Notification erstellen (in richtige Collection basierend auf User-Rolle)
      const userRole = user.role || 'nurse';
      const notificationCollection = userRole === 'nurse' ? 'employeeNotifications' : 'notifications';
      const notificationRef = db.collection(notificationCollection).doc();
      const notificationData = {
        userId,
        companyId: shiftCompanyId, // WICHTIG: companyId für Mandantenisolation
        type: 'shift' as const, // WICHTIG: employeeNotifications erwartet 'shift', nicht 'shift-assigned'
        title: isRequest ? 'Schichtanfrage gesendet' : 'Schicht zugewiesen',
        message: isRequest
          ? `Du hast eine Anfrage für eine Schicht gesendet`
          : `Dir wurde eine Schicht zugewiesen`,
        actionUrl: '/employee/dienstplan',
        read: false,
        starred: false, // WICHTIG: employeeNotifications benötigt starred
        archived: false, // WICHTIG: employeeNotifications benötigt archived
        priority: 'high' as const,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        metadata: {
          shiftId,
          assignmentId: assignmentRef.id,
          isRequest,
        },
      };

      transaction.set(notificationRef, notificationData);

      // 9. Audit Log
      const auditLogRef = db.collection('auditLogs').doc();
      const auditData = {
        userId: context.auth?.uid || 'unknown',
        companyId: shiftCompanyId, // WICHTIG: companyId für Mandantenisolation
        action: isRequest ? 'assignment_requested' : 'assignment_created',
        resourceType: 'assignment',
        resourceId: assignmentRef.id,
        changes: {
          status: { old: null, new: assignmentData.status },
          userId: { old: null, new: userId },
          shiftId: { old: null, new: shiftId },
          ...(adminOverride && { adminOverride: { old: null, new: true } }),
          ...(missingQualifications.length > 0 &&
            adminOverride && {
              missingQualifications: { old: null, new: missingQualifications },
              overrideReason: { old: null, new: 'Admin override for missing qualifications' },
            }),
          ...(conflicts.length > 0 &&
            adminOverride && {
              timeConflicts: { old: null, new: conflicts.length },
              overrideReason: { old: null, new: 'Admin override for time conflicts' },
            }),
        },
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      };

      transaction.set(auditLogRef, auditData);

      return {
        success: true,
        assignmentId: assignmentRef.id,
        message: isRequest
          ? 'Schichtanfrage erfolgreich gesendet'
          : 'Schicht erfolgreich zugewiesen',
        conflicts: conflicts.length > 0 ? conflicts : undefined,
        missingQualifications: missingQualifications.length > 0 ? missingQualifications : undefined,
        adminOverride: adminOverride,
        ...(adminOverride && {
          overrideWarnings: [
            ...(missingQualifications.length > 0
              ? [`Fehlende Qualifikationen: ${missingQualifications.join(', ')}`]
              : []),
            ...(conflicts.length > 0
              ? [`Zeitkonflikte: ${conflicts.length} Überschneidungen`]
              : []),
          ],
        }),
      };
    });
  } catch (error) {
    console.error('Error in assignShift:', error);
    console.error('Error details:', {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      code: (error as { code?: string })?.code,
    });

    if (error instanceof functions.https.HttpsError) {
      throw error;
    }

    // Provide more specific error messages
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('date') || errorMessage.includes('Date')) {
      throw new functions.https.HttpsError('invalid-argument', 'Invalid date format in shift data');
    }

    throw new functions.https.HttpsError('internal', `An error occurred while assigning the shift: ${errorMessage}`);
  }
});
