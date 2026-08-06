import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { getFirestore } from 'firebase-admin/firestore';
import { validateTimesheetArbZG, TimesheetValidationData } from './timesheetValidationUtils';
const db = getFirestore();

interface Timesheet {
  id: string;
  userId: string;
  shiftId?: string;
  /** Schichtdatum (Firestore-Timestamp | ISO-String | Date) */
  date?: unknown;
  startTime: string;
  endTime?: string;
  breakStart?: string;
  breakEnd?: string;
  totalHours?: number;
  breakMinutes?: number;
  status: 'active' | 'completed' | 'rejected';
  location?: {
    latitude: number;
    longitude: number;
    address?: string;
  };
  createdAt: unknown;
  updatedAt: unknown;
}

/** Firestore-Wert (Timestamp | Date | String) robust zu Date normalisieren. */
function toValidDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'object' && 'toDate' in (value as Record<string, unknown>)) {
    const d = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export const validateTimesheet = onDocumentCreated(
  {
    document: 'timesheets/{timesheetId}',
    region: 'europe-west1',
  },
  async event => {
    const timesheet = event.data?.data() as Timesheet;
    if (!timesheet) return;

    logger.info('Validating new timesheet:', { timesheetId: event.params.timesheetId });

    try {
      const validation = await performTimesheetValidation(timesheet);

      // Update timesheet with validation results
      await db
        .collection('timesheets')
        .doc(event.params.timesheetId)
        .update({
          validation: {
            isValid: validation.isValid,
            errors: validation.errors,
            warnings: validation.warnings,
            validatedAt: FieldValue.serverTimestamp(),
          },
          updatedAt: FieldValue.serverTimestamp(),
        });

      // Create audit log
      await createAuditLog({
        action: 'timesheet_validation',
        userId: timesheet.userId,
        resourceType: 'timesheet',
        resourceId: event.params.timesheetId,
        description: `Timesheet validiert: ${validation.isValid ? 'Gültig' : 'Ungültig'}`,
        metadata: {
          validation,
          timesheetId: event.params.timesheetId,
        },
      });

      // Send notification if validation failed
      if (!validation.isValid) {
        await sendValidationNotification(timesheet.userId, validation.errors);
      }

      logger.info('Timesheet validation completed:', {
        timesheetId: event.params.timesheetId,
        isValid: validation.isValid,
        errorCount: validation.errors.length,
      });
    } catch (error) {
      logger.error('Error validating timesheet:', error);

      // Create error audit log
      await createAuditLog({
        action: 'timesheet_validation_error',
        userId: timesheet.userId,
        resourceType: 'timesheet',
        resourceId: event.params.timesheetId,
        description: `Fehler bei Timesheet-Validierung: ${(error as Error).message}`,
        error: (error as Error).message,
      });
    }
  }
);

export const updateTimesheetValidation = onDocumentUpdated(
  {
    document: 'timesheets/{timesheetId}',
    region: 'europe-west1',
  },
  async event => {
    const beforeData = event.data?.before.data() as Timesheet;
    const afterData = event.data?.after.data() as Timesheet;

    if (!beforeData || !afterData) return;

    // Only re-validate if significant changes occurred
    const significantChanges = ['startTime', 'endTime', 'breakStart', 'breakEnd', 'location'].some(
      field => (beforeData as any)[field] !== (afterData as any)[field]
    );

    if (!significantChanges) return;

    logger.info('Re-validating updated timesheet:', { timesheetId: event.params.timesheetId });

    try {
      const validation = await performTimesheetValidation(afterData);

      // Update timesheet with new validation results
      await db
        .collection('timesheets')
        .doc(event.params.timesheetId)
        .update({
          validation: {
            isValid: validation.isValid,
            errors: validation.errors,
            warnings: validation.warnings,
            validatedAt: FieldValue.serverTimestamp(),
          },
          updatedAt: FieldValue.serverTimestamp(),
        });

      // Create audit log
      await createAuditLog({
        action: 'timesheet_revalidation',
        userId: afterData.userId,
        resourceType: 'timesheet',
        resourceId: event.params.timesheetId,
        description: `Timesheet erneut validiert: ${validation.isValid ? 'Gültig' : 'Ungültig'}`,
        metadata: {
          validation,
          timesheetId: event.params.timesheetId,
        },
      });

      logger.info('Timesheet re-validation completed:', {
        timesheetId: event.params.timesheetId,
        isValid: validation.isValid,
      });
    } catch (error) {
      logger.error('Error re-validating timesheet:', error);
    }
  }
);

async function performTimesheetValidation(timesheet: Timesheet): Promise<ValidationResult> {
  // Nutze die gemeinsame Validierungslogik. Basis ist das SCHICHTDATUM
  // (timesheet.date); createdAt (Erfassungszeitpunkt) nur als Fallback.
  // Früher wurde new Date(Timestamp-Objekt) gerechnet → Invalid Date, und
  // die komplette Draft-Validierung lief mit NaN-Zeiten ins Leere.
  const timesheetDate =
    toValidDate(timesheet.date) ?? toValidDate(timesheet.createdAt) ?? new Date();
  
  const validationData: TimesheetValidationData = {
    id: timesheet.id,
    userId: timesheet.userId,
    date: timesheetDate,
    startTime: timesheet.startTime,
    endTime: timesheet.endTime || new Date().toISOString(),
    breakMinutes: timesheet.breakMinutes || 0,
    totalHours: timesheet.totalHours,
    shiftId: timesheet.shiftId,
    location: timesheet.location,
    status: timesheet.status,
  };

  const arbzgValidation = await validateTimesheetArbZG(validationData);
  
  // Zusätzliche Shift-Validierung (falls vorhanden)
  const errors = [...arbzgValidation.errors];
  const warnings = [...arbzgValidation.warnings];

  if (timesheet.shiftId) {
    const startTime = typeof timesheet.startTime === 'string' 
      ? new Date(timesheet.startTime) 
      : new Date(timesheet.startTime);
    const endTime = timesheet.endTime 
      ? (typeof timesheet.endTime === 'string' ? new Date(timesheet.endTime) : new Date(timesheet.endTime))
      : new Date();

    const shiftValidation = await validateShiftAssignment(
      timesheet.userId,
      timesheet.shiftId,
      startTime,
      endTime
    );
    if (!shiftValidation.isValid) {
      errors.push(...shiftValidation.errors);
    }
    warnings.push(...shiftValidation.warnings);
  }


  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

// Diese Funktionen wurden nach timesheetValidationUtils.ts verschoben
// Hier nur noch für Rückwärtskompatibilität, falls nötig

async function validateShiftAssignment(
  userId: string,
  shiftId: string,
  startTime: Date,
  endTime: Date
): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    const shiftDoc = await db.collection('shifts').doc(shiftId).get();
    if (!shiftDoc.exists) {
      errors.push('Zugewiesener Dienst nicht gefunden');
      return { isValid: false, errors, warnings };
    }

    const shift = shiftDoc.data();
    if (!shift) {
      errors.push('Dienst-Daten nicht verfügbar');
      return { isValid: false, errors, warnings };
    }

    // Check if user is assigned to this shift
    if (shift.assignedUserId !== userId) {
      errors.push('Benutzer ist diesem Dienst nicht zugewiesen');
    }

    // Check if timesheet is within shift hours
    // Hinweis: shiftDate war ungenutzt und wurde entfernt
    const shiftStart = new Date(`${shift.date}T${shift.start}`);
    const shiftEnd = new Date(`${shift.date}T${shift.end}`);

    if (startTime < shiftStart || endTime > shiftEnd) {
      warnings.push('Zeiterfassung liegt außerhalb der Dienstzeiten');
    }

    return { isValid: errors.length === 0, errors, warnings };
  } catch (error) {
    errors.push(`Fehler bei Dienst-Validierung: ${(error as Error).message}`);
    return { isValid: false, errors, warnings };
  }
}

async function createAuditLog(logData: any) {
  try {
    await db.collection('auditLogs').add({
      ...logData,
      timestamp: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (error) {
    logger.error('Error creating audit log:', error);
  }
}

async function sendValidationNotification(userId: string, errors: string[]) {
  try {
    // Prüfe User-Rolle und speichere in richtige Collection
    const userDoc = await db.collection('users').doc(userId).get();
    const userRole = userDoc.exists ? (userDoc.data()?.role || 'nurse') : 'nurse';
    const notificationCollection = userRole === 'nurse' ? 'employeeNotifications' : 'notifications';
    
    await db.collection(notificationCollection).add({
      userId,
      type: 'timesheet_validation_failed',
      title: 'Zeiterfassung ungültig',
      message: `Ihre Zeiterfassung wurde als ungültig eingestuft: ${errors.join(', ')}`,
      read: false,
      priority: 'high',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  } catch (error) {
    logger.error('Error sending validation notification:', error);
  }
}
