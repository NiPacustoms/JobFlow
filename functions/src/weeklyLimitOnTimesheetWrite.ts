/**
 * Cloud Function: Bei jedem Schreiben in timesheets/{timesheetId}
 * aktuelleWochenstunden und limitStatus des Mitarbeiters (users/{userId}) aktualisieren.
 * 100% Firebase – keine Mocks.
 */

import * as functions from 'firebase-functions/v1';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const db = getFirestore();

const USERS_COLLECTION = 'users';
const TIMESHEETS_COLLECTION = 'timesheets';
const DEFAULT_LIMIT = 48;
const WARNING_THRESHOLD_PERCENT = 90;

type WeeklyLimitStatus = 'normal' | 'warning' | 'blocked';

/** Exportiert für die Unit-Tests (functions/test/weeklyLimit.test.ts). */
export function getStartOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  // Für einen Sonntag liegt der Montag der ISO-Woche sechs Tage ZURÜCK.
  // Mit diff = -6 wurde sechs Tage vorwärts gerechnet – das Wochenlimit prüfte
  // sonntags gegen die Folgewoche und blockierte deshalb nie.
  const diff = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Exportiert für die Unit-Tests. */
export function getEndOfWeek(date: Date): Date {
  const start = getStartOfWeek(date);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
}

/** Exportiert für die Unit-Tests. */
export function computeStatus(
  limit: number,
  aktuelleWochenstunden: number
): WeeklyLimitStatus {
  if (limit <= 0) return 'normal';
  if (aktuelleWochenstunden > limit) return 'blocked';
  const percent = (aktuelleWochenstunden / limit) * 100;
  return percent >= WARNING_THRESHOLD_PERCENT ? 'warning' : 'normal';
}

/**
 * Summiert totalHours aller Timesheets (Mo–So) für einen User.
 * Zählt alle Status (draft, submitted, approved), damit Anzeige live ist.
 */
async function calculateWeeklyHoursForUser(userId: string): Promise<number> {
  const now = new Date();
  const startOfWeek = getStartOfWeek(now);
  const endOfWeek = getEndOfWeek(now);

  const snapshot = await db
    .collection(TIMESHEETS_COLLECTION)
    .where('userId', '==', userId)
    .where('date', '>=', startOfWeek)
    .where('date', '<=', endOfWeek)
    .get();

  let total = 0;
  snapshot.docs.forEach(docSnap => {
    const data = docSnap.data();
    const hours = typeof data.totalHours === 'number' ? data.totalHours : 0;
    total += hours;
  });
  return Math.round(total * 100) / 100;
}

export const onTimesheetWrite = functions
  .region('europe-west1')
  .firestore.document(`${TIMESHEETS_COLLECTION}/{timesheetId}`)
  .onWrite(async (change, context) => {
    const after = change.after.exists ? change.after.data() : null;
    const before = change.before.exists ? change.before.data() : null;
    const userId = after?.userId ?? before?.userId;
    if (!userId || typeof userId !== 'string') {
      functions.logger.warn('onTimesheetWrite: no userId in document', {
        timesheetId: context.params.timesheetId,
      });
      return;
    }

    try {
      const nettoStunden = await calculateWeeklyHoursForUser(userId);
      const userRef = db.collection(USERS_COLLECTION).doc(userId);
      const userSnap = await userRef.get();
      const limit =
        userSnap.exists && typeof userSnap.data()?.wochenstundenLimit === 'number'
          ? (userSnap.data()?.wochenstundenLimit as number)
          : DEFAULT_LIMIT;
      const status = computeStatus(limit, nettoStunden);

      await userRef.update({
        aktuelleWochenstunden: nettoStunden,
        limitStatus: status,
        updatedAt: FieldValue.serverTimestamp(),
      });
      functions.logger.info('Weekly limit updated', {
        userId,
        nettoStunden,
        limit,
        status,
      });
    } catch (err) {
      functions.logger.error('onTimesheetWrite failed', {
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  });
