import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import { logger } from '../utils/logger';
import { parseShiftToUTC, checkOverlap } from '../utils/timeUtils';
import { sendUserPushNotification } from '../pushNotifications';
import { getAvailableEmployeeIds } from './availability';

const db = admin.firestore();

export interface CreateWithMatchingPayload {
  facilityId: string;
  companyId: string;
  startDate: string; // ISO date
  startTime: string;
  endTime: string;
  qualification?: string;
  /** Zu arbeitende Stunden (optional). */
  hours?: number;
  limit?: number;
  /** Wenn gesetzt: nur diese Mitarbeiter benachrichtigen (anstatt Auto-Matching). */
  selectedUserIds?: string[];
}

/**
 * Erstellt einen Einsatz (Assignment) mit Status published, findet 5–10 passende MA
 * und sendet FCM an alle Kandidaten.
 */
export const createWithMatching = functions.https.onCall(async (data: CreateWithMatchingPayload, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }

  const userClaims = context.auth.token as { role?: string };
  if (userClaims.role !== 'admin') {
    throw new functions.https.HttpsError('permission-denied', 'Only admins can create assignments');
  }

  const { facilityId, companyId, startDate, startTime, endTime, qualification, hours, limit = 10, selectedUserIds } = data || {};

  if (!facilityId || !companyId || !startDate || !startTime || !endTime) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'facilityId, companyId, startDate, startTime, endTime are required'
    );
  }

  // Mandantenisolation: Die übergebene companyId muss der des aufrufenden Admins
  // entsprechen (kein Anlegen in fremden Mandanten bei Direktaufruf der Function).
  // Fehlt der Claim (noch nicht gesynct), wird die companyId aus dem User-Dokument
  // nachgeladen. Ein fehlender Claim darf die Prüfung NICHT überspringen – sonst
  // könnte ein Admin per Direktaufruf Einsätze in einem fremden Mandanten anlegen.
  const callerToken = context.auth.token as { companyId?: string; claims?: { companyId?: string } };
  let callerCompanyId = callerToken.companyId || callerToken.claims?.companyId;
  if (!callerCompanyId) {
    const callerDoc = await db.collection('users').doc(context.auth.uid).get();
    const docCompanyId = callerDoc.data()?.companyId;
    callerCompanyId = typeof docCompanyId === 'string' && docCompanyId ? docCompanyId : undefined;
  }
  if (!callerCompanyId) {
    throw new functions.https.HttpsError('permission-denied', 'companyId des Aufrufers unbekannt');
  }
  if (companyId !== callerCompanyId) {
    throw new functions.https.HttpsError('permission-denied', 'companyId mismatch');
  }

  try {
    const date = new Date(startDate);
    const { startUTC, endUTC } = parseShiftToUTC(date, startTime, endTime, 'Europe/Berlin');

    // Facility laden (für Namen)
    const facilitySnap = await db.collection('facilities').doc(facilityId).get();
    const facilityName = facilitySnap.exists ? (facilitySnap.data()?.name as string) || 'Einrichtung' : 'Einrichtung';

    // Assignment anlegen (published, ohne userId)
    const assignmentRef = db.collection('assignments').doc();
    const assignmentData = {
      facilityId,
      companyId,
      createdBy: context.auth.uid,
      startDate: admin.firestore.Timestamp.fromDate(date),
      startTime,
      endTime,
      qualification: qualification || null,
      hours: hours ?? null,
      status: 'published',
      candidateUserIds: [] as string[],
      declinedUserIds: [] as string[],
      declines: [] as unknown[],
      assignedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    let candidateUserIds: string[];

    if (selectedUserIds && selectedUserIds.length > 0) {
      // Nur verfügbare Mitarbeiter (Company, Rolle nurse, Qualifikation, keine Zeitüberschneidung)
      const availableIds = await getAvailableEmployeeIds(
        db,
        companyId,
        startDate,
        startTime,
        endTime,
        qualification
      );
      const availableSet = new Set(availableIds);
      candidateUserIds = selectedUserIds.filter((uid) => availableSet.has(uid));
    } else {
      // Auto-Matching: Nurses derselben Company, Qualifikation optional, keine Überlappung
      const usersSnap = await db.collection('users').where('role', '==', 'nurse').get();
      const candidates: Array<{ userId: string; score: number }> = [];

      for (const userDoc of usersSnap.docs) {
        const user = userDoc.data();
        const userCompanyId = user.companyId as string | undefined;
        if (userCompanyId && userCompanyId !== companyId) continue;

        if (qualification) {
          const qualifications = (user.qualifications as string[]) || [];
          if (!qualifications.includes(qualification)) continue;
        }

        // Konflikt mit bestehenden Assignments prüfen
        const myAssignments = await db
          .collection('assignments')
          .where('userId', '==', userDoc.id)
          .where('status', 'in', ['assigned', 'accepted'])
          .get();

        let hasConflict = false;
        for (const aDoc of myAssignments.docs) {
          const a = aDoc.data();
          const shiftId = a.shiftId;
          if (!shiftId) continue;
          const shiftSnap = await db.collection('shifts').doc(shiftId).get();
          if (!shiftSnap.exists) continue;
          const shift = shiftSnap.data()!;
          const shiftDate = shift.date?.toDate?.() || new Date();
          const { startUTC: sStart, endUTC: sEnd } = parseShiftToUTC(
            shiftDate,
            shift.startTime || '08:00',
            shift.endTime || '16:00',
            'Europe/Berlin'
          );
          if (checkOverlap({ start: startUTC, end: endUTC }, { start: sStart, end: sEnd })) {
            hasConflict = true;
            break;
          }
        }
        if (hasConflict) continue;

        const score = (user.qualifications as string[]).length * 2 + 10;
        candidates.push({ userId: userDoc.id, score });
      }

      candidates.sort((a, b) => b.score - a.score);
      candidateUserIds = candidates.slice(0, Math.min(limit, 10)).map(c => c.userId);
    }

    await assignmentRef.set({
      ...assignmentData,
      candidateUserIds,
    });

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://localhost:3000';
    const link = `${appUrl}/employee/einsaetze/${assignmentRef.id}`;

    for (const userId of candidateUserIds) {
      await sendUserPushNotification({
        userId,
        title: 'Neuer Einsatz',
        body: `${facilityName} am ${date.toLocaleDateString('de-DE')} – ${startTime}–${endTime}`,
        data: { assignmentId: assignmentRef.id, type: 'assignment_published' },
        link,
        notificationType: 'assignment_published',
      });
    }

    return {
      success: true,
      assignmentId: assignmentRef.id,
      candidateUserIds,
      candidateCount: candidateUserIds.length,
    };
  } catch (error) {
    logger.error('createWithMatching error', error);
    if (error instanceof functions.https.HttpsError) throw error;
    throw new functions.https.HttpsError('internal', 'Failed to create assignment with matching');
  }
});
