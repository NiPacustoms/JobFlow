import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

/** Bestätigungs-Token, das der Aufrufer explizit mitsenden muss (Schutz vor versehentlichem Aufruf). */
export const DELETE_ALL_ASSIGNMENTS_CONFIRMATION = 'DELETE-ALL-ASSIGNMENTS';

/**
 * Cloud Function zum Löschen aller Assignments
 * WARNUNG: Diese Funktion löscht ALLE Assignments aus der Datenbank!
 */
export const deleteAllAssignments = functions.https.onCall(async (data, context) => {
  // Authentifizierung prüfen
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }

  // Nur Admins dürfen alle Assignments löschen
  const userRole = (context.auth.token as { role?: string }).role;
  if (userRole !== 'admin') {
    throw new functions.https.HttpsError('permission-denied', 'Only admins can delete all assignments');
  }

  // Destruktive Wartungsfunktion: nur mit explizitem Bestätigungs-Token ausführbar
  if ((data as { confirm?: string })?.confirm !== DELETE_ALL_ASSIGNMENTS_CONFIRMATION) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      `Bestätigung erforderlich: confirm muss "${DELETE_ALL_ASSIGNMENTS_CONFIRMATION}" sein.`
    );
  }

  functions.logger.warn('deleteAllAssignments bestätigt aufgerufen', { uid: context.auth.uid });

  try {
    functions.logger.info('Starting deletion of all assignments...');

    let totalDeleted = 0;
    let hasMore = true;

    // Loop für mehr als 500 Dokumente (Firestore Batch-Limit)
    while (hasMore) {
      const snapshot = await db.collection('assignments').limit(500).get();

      if (snapshot.empty) {
        hasMore = false;
        break;
      }

      const batch = db.batch();
      snapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
        totalDeleted++;
      });

      await batch.commit();
      functions.logger.info(`Deleted batch: ${snapshot.size} assignments (Total: ${totalDeleted})`);

      // Wenn weniger als 500 Dokumente, sind wir fertig
      if (snapshot.size < 500) {
        hasMore = false;
      }
    }

    functions.logger.info(`Successfully deleted ${totalDeleted} assignments`);

    return {
      success: true,
      deletedCount: totalDeleted,
      message: `Alle ${totalDeleted} Assignments wurden erfolgreich gelöscht.`,
    };
  } catch (error) {
    functions.logger.error('Error deleting assignments:', error);
    throw new functions.https.HttpsError(
      'internal',
      'Fehler beim Löschen der Assignments',
      error instanceof Error ? error.message : String(error)
    );
  }
});

