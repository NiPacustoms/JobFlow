# Environment-Variablen

**Stand:** 10.07.2026 · Schichtklar

Referenz aller von der Anwendung genutzten Umgebungsvariablen. `NEXT_PUBLIC_*`-Variablen werden ins Client-Bundle eingebettet (öffentlich sichtbar) – dort **niemals** Secrets ablegen. Alle übrigen Variablen sind serverseitig.

> Vorlagen: `.env.example` (Entwicklung), `.env.production.example`, `.env.staging.example`.

## 1. Client (`NEXT_PUBLIC_*`) — öffentlich, keine Secrets

### Firebase (Pflicht)
| Variable | Zweck |
|---|---|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Firebase Web-API-Key (per Design öffentlich) |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Auth-Domain (`<projekt>.firebaseapp.com`) |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Firebase-Projekt-ID |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | Storage-Bucket |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | FCM Sender-ID |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | Firebase-App-ID |
| `NEXT_PUBLIC_FIREBASE_VAPID_KEY` | Web-Push (FCM) |

### Impressum/Legal (Pflicht für Produktion — Build-Guard)
`NEXT_PUBLIC_COMPANY_NAME`, `NEXT_PUBLIC_COMPANY_STREET`, `NEXT_PUBLIC_COMPANY_ZIP`, `NEXT_PUBLIC_COMPANY_CITY`, `NEXT_PUBLIC_COMPANY_EMAIL` (Pflicht); optional `NEXT_PUBLIC_COMPANY_COUNTRY`, `NEXT_PUBLIC_COMPANY_PHONE`, `NEXT_PUBLIC_COMPANY_FAX`, `NEXT_PUBLIC_COMPANY_WEBSITE`, `NEXT_PUBLIC_LEGAL_FORM`, `NEXT_PUBLIC_REGISTER_NUMBER`, `NEXT_PUBLIC_REGISTER_COURT`, `NEXT_PUBLIC_VAT_ID`, `NEXT_PUBLIC_RESPONSIBLE_NAME`, `NEXT_PUBLIC_RESPONSIBLE_POSITION`, `NEXT_PUBLIC_COMPANY_SLUG`.

### Sonstiges (optional)
| Variable | Zweck |
|---|---|
| `NEXT_PUBLIC_APP_URL` | Öffentliche App-URL (Links, Redirects) |
| `NEXT_PUBLIC_OIDC_PROVIDER_ID` | Optionaler OIDC-Login-Provider |
| `NEXT_PUBLIC_ORS_API_KEY` | OpenRouteService (Karten/Routen) — als NEXT_PUBLIC nur, wenn clientseitig genutzt |
| `NEXT_PUBLIC_USE_EMULATOR`, `NEXT_PUBLIC_FIRESTORE_EMULATOR_PORT`, `NEXT_PUBLIC_STORAGE_EMULATOR_PORT` | lokale Emulator-Anbindung |
| `NEXT_PUBLIC_DEBUG_PERMISSIONS` | Debug-Ausgaben für Berechtigungen (nur Dev) |
| `NEXT_PUBLIC_ENABLE_ADMIN_BOOTSTRAP` | Gibt `/fix-admin-role` in Produktion frei (nur Erst-Einrichtung) |
| `NEXT_PUBLIC_E2E_TEST` | E2E-Testmodus-Flag |

## 2. Server — vertraulich, niemals `NEXT_PUBLIC_`

| Variable | Zweck |
|---|---|
| `FIREBASE_ADMIN_CREDENTIALS` **oder** `FIREBASE_ADMIN_CREDENTIALS_BASE64` | Service-Account-JSON (Admin-SDK). Base64 empfohlen. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`, `SMTP_FROM` | E-Mail-Versand per SMTP (in `functions/.env`) |
| `INVITATION_EMAIL_SECRET`, `FIREBASE_INVITATION_EMAIL_URL` | Einladungs-E-Mail-Function (Signatur/Endpoint) |
| `ENABLE_ADMIN_BOOTSTRAP`, `ADMIN_BOOTSTRAP_EMAIL` | Admin-Bootstrap (Erst-Einrichtung; in Prod standardmäßig aus) |
| `ORS_API_KEY` | OpenRouteService (serverseitig) |
| `SECURITY_WEBHOOK_URL` | Ziel für Security-Events (nur serverseitig!) |
| `GCLOUD_PROJECT` / `GOOGLE_CLOUD_PROJECT` | Projekt-ID im Server-/Functions-Kontext |
| `GOOGLE_APPLICATION_CREDENTIALS` | Pfad zur Service-Account-Datei (lokale Skripte) |

## 3. Regeln

- Keine echten Secrets im Repository oder in `NEXT_PUBLIC_*`.
- Produktion: `NEXT_PUBLIC_USE_EMULATOR` **nicht** setzen.
- Der Build bricht in Produktion bewusst ab, wenn die Impressums-Pflichtfelder Platzhalter enthalten (`validateLegalConfig()`).
