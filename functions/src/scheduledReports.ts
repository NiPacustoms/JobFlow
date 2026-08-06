/**
 * Scheduled Reports: Zeitgesteuerte Berichte erzeugen und per E-Mail versenden.
 * Konfiguration in Firestore: scheduledReportConfigs
 */

import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import * as functions from 'firebase-functions/v1';
import { sendTemplatedEmail } from './email';
import { logger } from './utils/logger';

const db = getFirestore();

const SCHEDULED_REPORT_CONFIGS = 'scheduledReportConfigs';
const REPORTS_COLLECTION = 'reports';

export interface ScheduledReportConfig {
  id: string;
  companyId: string;
  type: 'timesheet' | 'shifts' | 'summary';
  period: 'current-month' | 'last-month' | 'current-quarter' | 'current-year';
  format: 'pdf' | 'excel' | 'csv';
  recipientEmails: string[];
  schedule: 'daily' | 'monthly';
  lastRunAt?: Timestamp | null;
  createdAt: Timestamp;
  createdBy: string;
}

function isDue(config: ScheduledReportConfig, now: Date): boolean {
  const raw = config.lastRunAt;
  const lastRun = raw && typeof (raw as { toDate?: () => Date }).toDate === 'function'
    ? (raw as { toDate: () => Date }).toDate()
    : null;
  if (!lastRun) return true;

  if (config.schedule === 'daily') {
    const lastRunDate = new Date(lastRun.getFullYear(), lastRun.getMonth(), lastRun.getDate());
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return lastRunDate.getTime() < today.getTime();
  }

  if (config.schedule === 'monthly') {
    const lastRunMonth = lastRun.getFullYear() * 12 + lastRun.getMonth();
    const currentMonth = now.getFullYear() * 12 + now.getMonth();
    return lastRunMonth < currentMonth;
  }

  return false;
}

function getReportTitle(type: string, period: string): string {
  const typeLabels: Record<string, string> = {
    timesheet: 'Zeiterfassung',
    shifts: 'Schichten',
    summary: 'Zusammenfassung',
  };
  const periodLabels: Record<string, string> = {
    'current-month': 'Aktueller Monat',
    'last-month': 'Vormonat',
    'current-quarter': 'Aktuelles Quartal',
    'current-year': 'Aktuelles Jahr',
  };
  return `${typeLabels[type] || type} – ${periodLabels[period] || period}`;
}

async function runScheduledReports(): Promise<void> {
  const now = new Date();
  const snapshot = await db.collection(SCHEDULED_REPORT_CONFIGS).get();

  for (const docSnap of snapshot.docs) {
    const config = { id: docSnap.id, ...docSnap.data() } as ScheduledReportConfig;
    if (!config.companyId || !config.recipientEmails?.length || !isDue(config, now)) {
      continue;
    }

    try {
      const reportRef = await db.collection(REPORTS_COLLECTION).add({
        userId: config.createdBy,
        companyId: config.companyId,
        type: config.type,
        title: getReportTitle(config.type, config.period),
        description: `Zeitgesteuerter Bericht (${config.schedule})`,
        period: config.period,
        format: config.format,
        status: 'completed',
        createdAt: FieldValue.serverTimestamp(),
        completedAt: FieldValue.serverTimestamp(),
        fileUrl: null,
        metadata: { scheduledReportConfigId: config.id, generatedAt: now.toISOString() },
      });

      const reportLink = `${process.env.APP_URL || 'https://yourapp.web.app'}/admin/berichte?reportId=${reportRef.id}`;
      const subject = `Schichtklar: ${getReportTitle(config.type, config.period)}`;
      const html = `
        <p>Der geplante Bericht wurde erstellt.</p>
        <p><strong>Typ:</strong> ${config.type}</p>
        <p><strong>Zeitraum:</strong> ${config.period}</p>
        <p><a href="${reportLink}">Bericht in Schichtklar öffnen</a></p>
      `;

      for (const to of config.recipientEmails) {
        if (to && typeof to === 'string') {
          await sendTemplatedEmail({ to, subject, html });
        }
      }

      await docSnap.ref.update({ lastRunAt: FieldValue.serverTimestamp() });
      logger.info(`Scheduled report ran for config ${config.id}, report ${reportRef.id}`);
    } catch (err) {
      logger.error(`Scheduled report failed for config ${config.id}`, err);
    }
  }
}

/** Läuft täglich um 6:00 Uhr Europe/Berlin */
export const scheduledReportsJob = functions.pubsub
  .schedule('0 6 * * *')
  .timeZone('Europe/Berlin')
  .onRun(async () => {
    await runScheduledReports();
  });

/** Manueller Aufruf für Tests/Admin */
export const runScheduledReportsNow = functions.https.onCall(async (_data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Nicht angemeldet');
  }
  const callerUid = context.auth.uid;
  const callerDoc = await db.collection('users').doc(callerUid).get();
  const role = callerDoc.data()?.role;
  if (role !== 'admin') {
    throw new functions.https.HttpsError('permission-denied', 'Nur Admins dürfen den Job auslösen');
  }
  await runScheduledReports();
  return { ok: true };
});
