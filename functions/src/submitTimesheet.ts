import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import { validateTimesheetArbZG, TimesheetValidationData } from './timesheetValidationUtils';
import { computeWorkHoursBreakdown } from './utils/workHoursBreakdown';

const db = admin.firestore();

/**
 * Cloud Function für sichere Timesheet-Einreichung
 * Server-seitige Berechnung von totalHours (verhindert Client-Manipulation)
 */
export const submitTimesheet = functions.https.onCall(async (data, context) => {
  // Authentifizierung prüfen
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { timesheetId } = data;

  if (!timesheetId) {
    throw new functions.https.HttpsError('invalid-argument', 'timesheetId is required');
  }

  try {
    return await db.runTransaction(async transaction => {
      // 1. Timesheet-Daten laden
      const timesheetRef = db.collection('timesheets').doc(timesheetId);
      const timesheetDoc = await transaction.get(timesheetRef);

      if (!timesheetDoc.exists) {
        throw new functions.https.HttpsError('not-found', 'Timesheet not found');
      }

      const timesheet = timesheetDoc.data()!;

      // 2. Ownership prüfen
      if (timesheet.userId !== context.auth?.uid) {
        throw new functions.https.HttpsError(
          'permission-denied',
          'You can only submit your own timesheets'
        );
      }

      // 3. Status prüfen
      if (timesheet.status === 'submitted' || timesheet.status === 'approved') {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'Timesheet already submitted or approved'
        );
      }

      // 4. SERVER-SEITIGE Berechnung von totalHours
      const { startTime, endTime, breakMinutes } = timesheet;

      if (!startTime || !endTime) {
        throw new functions.https.HttpsError('invalid-argument', 'Start and end time are required');
      }

      const timesheetDate = timesheet.date?.toDate ? timesheet.date.toDate() : new Date(timesheet.date || new Date());

      // Start/Ende mit echtem Schichtdatum (für ArbZG Ruhezeit/Wochenstunden korrekt)
      const [startH, startM] = String(startTime).split(':').map(Number);
      const [endH, endM] = String(endTime).split(':').map(Number);
      const start = new Date(timesheetDate);
      start.setHours(startH, startM || 0, 0, 0);
      const end = new Date(timesheetDate);
      end.setHours(endH, endM || 0, 0, 0);
      if (end.getTime() <= start.getTime()) {
        end.setDate(end.getDate() + 1);
      }

      const totalMinutes = (end.getTime() - start.getTime()) / (1000 * 60);
      if ((breakMinutes || 0) >= totalMinutes) {
        throw new functions.https.HttpsError(
          'invalid-argument',
          `Pause (${breakMinutes} Min) ist länger oder gleich der Arbeitszeit (${totalMinutes} Min)`
        );
      }
      const totalHours = (totalMinutes - (breakMinutes || 0)) / 60;
      const roundedTotalHours = Math.round(totalHours * 100) / 100;

      // Stunden-Breakdown (Nacht/Wochenende/Feiertag/Überstunden)
      const breakdown = computeWorkHoursBreakdown(start, end, breakMinutes || 0);

      // 5. VOLLSTÄNDIGE ARBZG-VALIDIERUNG (inkl. Ruhezeiten, 45-Minuten-Pause, etc.)
      const validationData: TimesheetValidationData = {
        id: timesheetId,
        userId: timesheet.userId,
        date: timesheetDate,
        startTime: start,
        endTime: end,
        breakMinutes: breakMinutes || 0,
        totalHours: roundedTotalHours,
        shiftId: timesheet.shiftId,
        location: timesheet.location,
        status: timesheet.status,
      };

      const validation = await validateTimesheetArbZG(validationData);

      // 6. Bei Validierungsfehlern: Submit blockieren
      if (!validation.isValid) {
        // Speichere Validierungsergebnis für spätere Anzeige
        transaction.update(timesheetRef, {
          validation: {
            isValid: false,
            errors: validation.errors,
            warnings: validation.warnings,
            validatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        throw new functions.https.HttpsError(
          'failed-precondition',
          `Zeiterfassung kann nicht eingereicht werden: ${validation.errors.join('; ')}`
        );
      }

      // 7. Timesheet aktualisieren (inkl. serverseitigem Stunden-Breakdown)
      transaction.update(timesheetRef, {
        totalHours: roundedTotalHours, // SERVER setzt den Wert
        nightHours: breakdown.nightHours,
        weekendHours: breakdown.weekendHours,
        holidayHours: breakdown.holidayHours,
        overtimeHours: breakdown.overtimeHours,
        status: 'submitted',
        submittedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        validation: {
          isValid: true,
          errors: [],
          warnings: validation.warnings, // Warnungen werden gespeichert, blockieren aber nicht
          validatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
      });

      // 8. Audit Log erstellen
      const auditLogRef = db.collection('auditLogs').doc();
      const auditData = {
        userId: context.auth?.uid || 'unknown',
        action: 'timesheet_submitted',
        resourceType: 'timesheet',
        resourceId: timesheetId,
        changes: {
          status: { old: timesheet.status || 'draft', new: 'submitted' },
          totalHours: { old: timesheet.totalHours || 0, new: roundedTotalHours },
        },
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      };

      transaction.set(auditLogRef, auditData);

      return {
        success: true,
        totalHours: roundedTotalHours,
        message: 'Zeiterfassung erfolgreich eingereicht',
      };
    });
  } catch (error) {
    console.error('Error in submitTimesheet:', error);

    if (error instanceof functions.https.HttpsError) {
      throw error;
    }

    throw new functions.https.HttpsError(
      'internal',
      'An error occurred while submitting the timesheet'
    );
  }
});
