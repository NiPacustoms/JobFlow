"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.runFirestoreBackup = runFirestoreBackup;
const functions = __importStar(require("firebase-functions/v1"));
const firestore_1 = require("@google-cloud/firestore");
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
const client = new firestore_1.v1.FirestoreAdminClient();
function resolveProjectId() {
    const fromEnv = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
    if (fromEnv)
        return fromEnv;
    try {
        const config = JSON.parse(process.env.FIREBASE_CONFIG || '{}');
        if (config.projectId)
            return config.projectId;
    }
    catch (_a) {
        // FIREBASE_CONFIG nicht gesetzt oder kein JSON – unten Fehler werfen
    }
    throw new Error('Projekt-ID nicht ermittelbar (GCLOUD_PROJECT/FIREBASE_CONFIG fehlen).');
}
async function runFirestoreBackup() {
    const projectId = resolveProjectId();
    const bucket = process.env.BACKUP_BUCKET || `gs://${projectId}-backups`;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    // Gleiches Pfadschema wie scripts/firestore-backup.sh: <bucket>/firestore/<project>/<zeitstempel>
    const outputUriPrefix = `${bucket}/firestore/${projectId}/${timestamp}`;
    const databaseName = client.databasePath(projectId, '(default)');
    functions.logger.info('Starte Firestore-Export', { outputUriPrefix });
    const [operation] = await client.exportDocuments({
        name: databaseName,
        outputUriPrefix,
        // Leer = alle Collections exportieren
        collectionIds: [],
    });
    functions.logger.info('Firestore-Export gestartet', { operation: operation.name, outputUriPrefix });
    return outputUriPrefix;
}
