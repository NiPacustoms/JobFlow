import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';

/** Firestore-Datum robust normalisieren (Timestamp | Date | ISO-String). */
function normalizeShiftDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'object' && 'toDate' in (value as Record<string, unknown>)) {
    return (value as { toDate: () => Date }).toDate();
  }
  if (typeof value === 'string') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}


const db = admin.firestore();

/**
 * Cloud Function für Kandidatensuche bei Schichtzuweisung
 * Filtert nach Qualifikationen, Verfügbarkeit und Erfahrung
 */
export const findCandidates = functions.https.onCall(async (data, context) => {
  const { checkOverlap, parseShiftToUTC } = await import('./utils/timeUtils');

  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { shiftId, filters = {} } = data;

  if (!shiftId) {
    throw new functions.https.HttpsError('invalid-argument', 'shiftId is required');
  }

  // Rollenprüfung
  const userClaims = context.auth.token as { role?: string };
  if (userClaims.role !== 'admin') {
    throw new functions.https.HttpsError(
      'permission-denied',
      'Only admins can search candidates'
    );
  }

  try {
    // 1. Shift-Daten laden
    const shiftRef = db.collection('shifts').doc(shiftId);
    const shiftDoc = await shiftRef.get();

    if (!shiftDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'Shift not found');
    }

    const shift = shiftDoc.data()!;

    // 2. Schicht-Zeitfenster berechnen
    const shiftDateNorm = normalizeShiftDate(shift.date);
    if (!shiftDateNorm) {
      throw new functions.https.HttpsError('failed-precondition', 'Shift has no valid date');
    }
    const { startUTC, endUTC } = parseShiftToUTC(
      shiftDateNorm,
      shift.startTime,
      shift.endTime,
      shift.tz || 'Europe/Berlin'
    );

    // 3. Alle Pflegekräfte laden
    const usersQuery = db.collection('users').where('role', '==', 'nurse');

    const usersSnapshot = await usersQuery.get();
    const candidates: Array<{
      userId: string;
      displayName: string;
      qualifications: string[];
      hasConflict: boolean;
      conflictDetails: string;
      score: number;
      stationExperience: number;
      missingQualifications?: string[];
    }> = [];

    // 4. Für jeden User prüfen
    for (const userDoc of usersSnapshot.docs) {
      const user = userDoc.data();

      // Filter nach Name (falls angegeben)
      if (filters.name && !user.displayName?.toLowerCase().includes(filters.name.toLowerCase())) {
        continue;
      }

      // 5. Qualifikationsprüfung
      const requiredSkills = shift.requiredSkills || [];
      const userQualifications = user.qualifications || [];
      const missingQualifications = requiredSkills.filter(
        (skill: string) => !userQualifications.includes(skill)
      );

      // 6. Verfügbarkeitsprüfung
      const assignmentsQuery = db
        .collection('assignments')
        .where('userId', '==', userDoc.id)
        .where('status', 'in', ['assigned', 'accepted']);

      const assignmentsSnapshot = await assignmentsQuery.get();
      let hasConflict = false;
      let conflictDetails = '';

      for (const assignmentDoc of assignmentsSnapshot.docs) {
        const assignment = assignmentDoc.data();
        const existingShiftRef = db.collection('shifts').doc(assignment.shiftId);
        const existingShiftDoc = await existingShiftRef.get();

        if (existingShiftDoc.exists) {
          const existingShift = existingShiftDoc.data()!;
          const existingDateNorm = normalizeShiftDate(existingShift.date);
          if (!existingDateNorm) continue;
          const { startUTC: existingStartUTC, endUTC: existingEndUTC } = parseShiftToUTC(
            existingDateNorm,
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
            hasConflict = true;
            conflictDetails = `Konflikt mit Schicht am ${existingDateNorm.toLocaleDateString('de-DE')}`;
            break;
          }
        }
      }

      // 7. Scoring berechnen
      let score = 0;

      // Basis-Score
      score += 10;

      // Qualifikations-Bonus
      const qualificationMatch =
        requiredSkills.length > 0
          ? (requiredSkills.length - missingQualifications.length) / requiredSkills.length
          : 1;
      score += qualificationMatch * 20;

      // Verfügbarkeits-Bonus
      if (!hasConflict) {
        score += 15;
      }

      // Erfahrungs-Bonus (vereinfacht)
      const yearsExperience = user.yearsExperience || 0;
      score += Math.min(yearsExperience * 2, 20);

      // Station-Erfahrung (falls verfügbar)
      const stationExperience = user.stationExperience?.[shift.stationId] || 0;
      score += Math.min(stationExperience * 3, 15);

      // 8. Kandidat hinzufügen
      candidates.push({
        userId: userDoc.id,
        displayName: user.displayName || user.email,
        qualifications: userQualifications,
        hasConflict,
        conflictDetails,
        score,
        stationExperience,
        missingQualifications: missingQualifications.length > 0 ? missingQualifications : undefined,
      });
    }

    // 9. Sortieren nach Score (höchster zuerst)
    candidates.sort((a, b) => b.score - a.score);

    // 10. Filter anwenden
    let filteredCandidates = candidates;

    if (filters.onlyAvailable) {
      filteredCandidates = candidates.filter(c => !c.hasConflict);
    }

    if (filters.onlyQualified) {
      filteredCandidates = filteredCandidates.filter(c => !c.missingQualifications);
    }

    if (filters.minScore) {
      filteredCandidates = filteredCandidates.filter(c => c.score >= filters.minScore);
    }

    // 11. Limit anwenden
    const limit = filters.limit || 20;
    filteredCandidates = filteredCandidates.slice(0, limit);

    return {
      success: true,
      candidates: filteredCandidates,
      totalFound: candidates.length,
      shiftInfo: {
        facilityId: shift.facilityId,
        stationId: shift.stationId,
        date: shift.date,
        startTime: shift.startTime,
        endTime: shift.endTime,
        requiredQualifications: shift.requiredSkills || [],
      },
    };
  } catch (error) {
    console.error('Error in findCandidates:', error);

    if (error instanceof functions.https.HttpsError) {
      throw error;
    }

    throw new functions.https.HttpsError(
      'internal',
      'An error occurred while searching candidates'
    );
  }
});
