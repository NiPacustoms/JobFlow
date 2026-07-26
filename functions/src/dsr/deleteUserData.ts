import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}

// Best-effort DSGVO-Löschung: markiert Daten als deleted und entfernt personenbezogene Felder, wo möglich löscht sie hart.
/**
 * Reine Handler-Funktion mit injizierbarer Firestore-Instanz – siehe
 * exportUserDataHandler. Der onCall-Wrapper darunter bleibt unverändert.
 */
export async function deleteUserDataHandler(
  data: { uid?: string; hardDelete?: boolean } | undefined,
  context: functions.https.CallableContext,
  firestore?: admin.firestore.Firestore
) {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  }

  const targetUid: string = data?.uid ?? context.auth.uid;
  const companyId: string | undefined = (context.auth.token as { companyId?: string })?.companyId;
  const hardDelete: boolean = !!data?.hardDelete;
  if (!companyId) {
    throw new functions.https.HttpsError('permission-denied', 'Missing company context');
  }

  const db = firestore ?? admin.firestore();
  const batch = db.batch();

  // users (hard delete)
  const userRef = db.collection('users').doc(targetUid);
  const userSnap = await userRef.get();
  if (userSnap.exists && userSnap.get('companyId') === companyId) {
    if (hardDelete) {
      batch.delete(userRef);
    } else {
      batch.update(userRef, {
        deleted: true,
        email: admin.firestore.FieldValue.delete(),
        displayName: admin.firestore.FieldValue.delete(),
        phone: admin.firestore.FieldValue.delete(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  }

  // Helper zum markieren/löschen einer Sammlung nach Feld userId
  async function processCollection(name: string, field: string) {
    const q = db.collection(name)
      .where('companyId', '==', companyId)
      .where(field, '==', targetUid);
    const snap = await q.get();
    snap.forEach((doc) => {
      if (hardDelete) {
        batch.delete(doc.ref);
      } else {
        batch.update(doc.ref, { deleted: true, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      }
    });
  }

  await Promise.all([
    processCollection('assignments', 'userId'),
    processCollection('timesheets', 'userId'),
    processCollection('documents', 'userId'),
    processCollection('notifications', 'userId'),
    processCollection('messages', 'userId'),
  ]);

  await batch.commit();

  // Wenn hardDelete aktiviert ist, lösche auch den Firebase Auth User
  if (hardDelete) {
    try {
      await admin.auth().deleteUser(targetUid);
      console.log(`Firebase Auth user deleted: ${targetUid}`);
    } catch (authError: any) {
      // Wenn der User nicht in Auth existiert, ist das OK
      if (authError?.code === 'auth/user-not-found') {
        console.log(`Firebase Auth user not found (may have been already deleted): ${targetUid}`);
      } else {
        console.error(`Failed to delete Firebase Auth user ${targetUid}:`, authError);
        // Wir werfen den Fehler nicht, da Firestore-Daten bereits gelöscht wurden
        // Der Aufrufer sollte informiert werden, dass Auth-Löschung fehlgeschlagen ist
      }
    }
  }

  return { uid: targetUid, companyId, hardDelete, deletedAt: new Date().toISOString() };
}

export const deleteUserData = functions.https.onCall(async (data, context) =>
  deleteUserDataHandler(data, context)
);


