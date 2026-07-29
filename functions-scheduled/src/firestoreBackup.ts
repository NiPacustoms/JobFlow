import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import { v1 as firestoreAdmin } from '@google-cloud/firestore';

/**
 * Täglicher Firestore-Export in einen GCS-Bucket (Disaster Recovery).
 *
 * Voraussetzungen (einmalig, siehe docs/DISASTER_RECOVERY.md):
 * 1. Bucket anlegen, z. B.: gsutil mb -l europe-west1 gs://<PROJECT_ID>-backups
 * 2. Dem App-Engine-Default-Service-Account (<PROJECT_ID>@appspot.gserviceaccount.com)
 *    die Rollen "Cloud Datastore Import Export Admin" und auf dem Bucket
 *    "Storage Object Admin" geben.
 * 3. Optional: Bucket per ENV BACKUP_BUCKET überschreiben (Format gs://name),
 *    sonst wird gs://<PROJECT_ID>-backups verwendet.
 */

const client = new firestoreAdmin.FirestoreAdminClient();

function resolveProjectId(): string {
  const fromEnv = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
  if (fromEnv) return fromEnv;
  try {
    const config = JSON.parse(process.env.FIREBASE_CONFIG || '{}') as { projectId?: string };
    if (config.projectId) return config.projectId;
  } catch {
    // FIREBASE_CONFIG nicht gesetzt oder kein JSON – unten Fehler werfen
  }
  throw new Error('Projekt-ID nicht ermittelbar (GCLOUD_PROJECT/FIREBASE_CONFIG fehlen).');
}

/**
 * Schreibt den Sicherungsstatus nach systemSettings/backupStatus, damit der
 * Admin-Bereich den echten Stand anzeigen kann (statt – wie früher – eine
 * clientseitige Schein-Sicherung anzubieten).
 */
async function writeBackupStatus(status: {
  lastResult: 'success' | 'error';
  outputUriPrefix?: string;
  bucket?: string;
  lastError?: string;
}): Promise<void> {
  try {
    const db = admin.firestore();
    await db.doc('systemSettings/backupStatus').set(
      {
        ...status,
        lastRunAt: admin.firestore.FieldValue.serverTimestamp(),
        ...(status.lastResult === 'success'
          ? { lastSuccessAt: admin.firestore.FieldValue.serverTimestamp() }
          : {}),
      },
      { merge: true }
    );
  } catch (statusError) {
    // Der Status darf die Sicherung selbst nie zum Scheitern bringen.
    functions.logger.warn('Sicherungsstatus konnte nicht geschrieben werden', {
      error: statusError instanceof Error ? statusError.message : String(statusError),
    });
  }
}

export async function runFirestoreBackup(): Promise<string> {
  const projectId = resolveProjectId();
  const bucket = process.env.BACKUP_BUCKET || `gs://${projectId}-backups`;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  // Gleiches Pfadschema wie scripts/firestore-backup.sh: <bucket>/firestore/<project>/<zeitstempel>
  const outputUriPrefix = `${bucket}/firestore/${projectId}/${timestamp}`;
  const databaseName = client.databasePath(projectId, '(default)');

  functions.logger.info('Starte Firestore-Export', { outputUriPrefix });
  try {
    const [operation] = await client.exportDocuments({
      name: databaseName,
      outputUriPrefix,
      // Leer = alle Collections exportieren
      collectionIds: [],
    });
    functions.logger.info('Firestore-Export gestartet', { operation: operation.name, outputUriPrefix });
    await writeBackupStatus({ lastResult: 'success', outputUriPrefix, bucket });
    return outputUriPrefix;
  } catch (error) {
    await writeBackupStatus({
      lastResult: 'error',
      bucket,
      lastError: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
