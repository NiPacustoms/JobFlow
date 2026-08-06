import { Buffer } from 'node:buffer';
import * as admin from 'firebase-admin';

type ServiceAccountJSON = {
  project_id?: string;
  private_key?: string;
  client_email?: string;
};

function parseJson<T = ServiceAccountJSON>(raw: string | undefined | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function normalizePrivateKey(key: string | undefined) {
  if (!key) return undefined;
  return key.replace(/\\n/g, '\n');
}

function getServiceAccountFromEnv(): admin.ServiceAccount | null {
  const base64 =
    process.env.FIREBASE_ADMIN_CREDENTIALS_BASE64 ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  const rawJson =
    process.env.FIREBASE_ADMIN_CREDENTIALS ||
    (base64 ? Buffer.from(base64, 'base64').toString('utf8') : undefined);

  const parsed = parseJson<ServiceAccountJSON>(rawJson);
  if (!parsed?.client_email || !parsed.private_key) {
    return null;
  }

  return {
    projectId: parsed.project_id,
    clientEmail: parsed.client_email,
    privateKey: normalizePrivateKey(parsed.private_key),
  };
}

const projectIdFromEnv =
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
  process.env.GCLOUD_PROJECT ||
  process.env.GOOGLE_CLOUD_PROJECT;

// Initialize once per process
if (!admin.apps.length) {
  const serviceAccount = getServiceAccountFromEnv();

  try {
    if (serviceAccount) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.projectId || projectIdFromEnv,
      });
    } else {
      // Prefer application default credentials if available
      const credential = admin.credential.applicationDefault();
      admin.initializeApp({ credential, projectId: projectIdFromEnv });
    }
  } catch {
    try {
      // Fallback: initialize without explicit options (may still work if env is configured)
      admin.initializeApp();
    } catch {
      // Avoid crash in build environments; API routes should fail gracefully if missing
    }
  }
}

export const adminAuth = admin.apps.length ? admin.auth() : null;

function createAdminDb(): admin.firestore.Firestore | null {
  if (!admin.apps.length) return null;
  const firestore = admin.firestore();
  try {
    // Analog zum Client-SDK (lib/firebase.ts): optionale Felder mit Wert
    // `undefined` dürfen einen Write nicht abbrechen. Ohne diese Einstellung
    // wirft z. B. der Einrichtungs-Import bei leerem Feld "Typ" für JEDE Zeile.
    firestore.settings({ ignoreUndefinedProperties: true });
  } catch {
    // settings() darf nur vor dem ersten Zugriff aufgerufen werden – bei
    // Hot-Reload/mehrfachem Import ist der Wert bereits gesetzt.
  }
  return firestore;
}

export const adminDb = createAdminDb();

/**
 * Extended Firebase Auth Token with Custom Claims
 * Custom Claims können direkt auf dem Token oder in customClaims sein
 */
export interface FirebaseAuthToken {
  uid: string;
  email?: string;
  role?: 'admin' | 'mitarbeiter';
  companyId?: string;
  customClaims?: {
    role?: 'admin' | 'mitarbeiter';
    companyId?: string;
  };
  [key: string]: unknown; // Für andere Firebase Token Properties
}

/**
 * Helper-Funktion zum Extrahieren der Role aus einem Firebase Auth Token
 */
export function getRoleFromToken(token: admin.auth.DecodedIdToken | null): 'admin' | 'mitarbeiter' | null {
  if (!token) return null;
  const raw = (token as FirebaseAuthToken).role ?? (token as FirebaseAuthToken).customClaims?.role;
  if (raw === 'admin' || raw === 'mitarbeiter') return raw;
  return null;
}

/**
 * Helper-Funktion zum Extrahieren der CompanyId aus einem Firebase Auth Token.
 * Liest den echten `companyId`-Custom-Claim (Multi-Tenant). Gibt null zurück,
 * wenn der Claim fehlt – Aufrufer müssen diesen Fall behandeln (kein stilles
 * Zurückfallen auf einen einzelnen Mandanten mehr).
 */
export function getCompanyIdFromToken(token: admin.auth.DecodedIdToken | null): string | null {
  if (!token) return null;
  const raw =
    (token as FirebaseAuthToken).companyId ?? (token as FirebaseAuthToken).customClaims?.companyId;
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

/**
 * Ermittelt die companyId robust: erst aus dem Custom-Claim, sonst aus dem
 * User-Dokument (Claim noch nicht gesynct). Gibt null zurück, wenn beides fehlt –
 * Aufrufer dürfen NIEMALS auf '' zurückfallen, sonst greifen Queries wie
 * `where('companyId','==','')` ins Leere bzw. auf fremde Legacy-Daten.
 */
export async function resolveCompanyId(
  token: admin.auth.DecodedIdToken | null
): Promise<string | null> {
  const fromToken = getCompanyIdFromToken(token);
  if (fromToken) return fromToken;
  if (!token || !adminDb) return null;
  try {
    const snap = await adminDb.collection('users').doc(token.uid).get();
    const raw = snap.data()?.companyId;
    return typeof raw === 'string' && raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

export async function verifyIdToken(authorizationHeader?: string) {
  if (!adminAuth) return null;
  if (!authorizationHeader) return null;
  const token = authorizationHeader.replace(/^Bearer\s+/i, '');
  try {
    return await adminAuth.verifyIdToken(token, true);
  } catch {
    return null;
  }
}


