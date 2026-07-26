import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}

/**
 * Reine Handler-Funktion mit injizierbarer Firestore-Instanz.
 * Getrennt vom onCall-Wrapper, damit die Mandanten- und Personenfilter ohne
 * Emulator testbar sind (siehe functions/test/dsr.test.ts).
 */
export async function exportUserDataHandler(
  data: { uid?: string } | undefined,
  context: functions.https.CallableContext,
  firestore?: admin.firestore.Firestore
) {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  }

  const targetUid: string = data?.uid ?? context.auth.uid;
  const companyId: string | undefined = (context.auth.token as { companyId?: string })?.companyId;
  if (!companyId) {
    throw new functions.https.HttpsError('permission-denied', 'Missing company context');
  }

  const db = firestore ?? admin.firestore();

  const collections = [
    { name: 'users', field: 'uid', queryField: admin.firestore.FieldPath.documentId() },
    { name: 'assignments', field: 'userId' },
    { name: 'timesheets', field: 'userId' },
    { name: 'documents', field: 'userId' },
    { name: 'notifications', field: 'userId' },
    { name: 'messages', field: 'userId' },
  ];

  const result: Record<string, Array<{ id: string } & Record<string, unknown>>> = {};

  for (const c of collections) {
    let q = db.collection(c.name).where('companyId', '==', companyId);
    if (c.queryField instanceof admin.firestore.FieldPath) {
      // users: match by docId and verify companyId
      const snap = await db.collection('users').doc(targetUid).get();
      if (snap.exists && snap.get('companyId') === companyId) {
        result[c.name] = [{ id: snap.id, ...snap.data() }];
      } else {
        result[c.name] = [];
      }
      continue;
    }
    q = q.where(c.field!, '==', targetUid);
    const snap = await q.get();
    result[c.name] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  return { uid: targetUid, companyId, exportedAt: new Date().toISOString(), data: result };
}

export const exportUserData = functions.https.onCall(async (data, context) =>
  exportUserDataHandler(data, context)
);


