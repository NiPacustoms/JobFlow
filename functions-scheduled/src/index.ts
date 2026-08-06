import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import { sendFormReminderEmails } from './formReminders';
import { runFirestoreBackup } from './firestoreBackup';

admin.initializeApp();

export const scheduledFormReminders = functions.pubsub
  .schedule('every 24 hours')
  .timeZone('Europe/Berlin')
  .onRun(async () => {
    await sendFormReminderEmails();
  });

export const runFormReminders = functions.https.onRequest(async (_req, res) => {
  try {
    await sendFormReminderEmails();
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : 'unknown' });
  }
});

export const scheduledFirestoreBackup = functions.pubsub
  .schedule('0 3 * * *')
  .timeZone('Europe/Berlin')
  .onRun(async () => {
    await runFirestoreBackup();
  });
