# Repository-Audit (Phase 1 – Marktreife)

**Stand:** 10.07.2026 · Commit `e2de861` (main) · Branch `chore/market-ready`
**Methode:** Vollständige Inventur aller 832 getrackten Dateien, Referenz-/Importprüfung, Secret- und PII-Scans, Konfigurationsanalyse. Kein Befund wurde ungeprüft aus vorhandener Doku übernommen.

---

## 1. Projektstruktur (Ist-Zustand, verifiziert)

| Verzeichnis | Dateien | Zweck | Status |
|---|---|---|---|
| `lib/` | 228 | Services (Firestore-Zugriffe), Hooks, Utils, Typen, Fehlerbehandlung | produktiv |
| `components/` | 120 | React-Komponenten (MUI-basiert) | produktiv |
| `app/` | 116 | Next.js App Router: Seiten (DE-Routen), API-Routen, Layouts | produktiv |
| `src/` | 57 | **Hexagonale Architektur-Schicht** (domain/application/infrastructure/plugins). AKTIV: importiert von `app/(employee)/employee/zeiten`, `zeiterfassung`, `lib/hooks/useAssignments|useDashboard|useDomainAssignments`, `components/PluginInit` | produktiv |
| `docs/` | 59 | Dokumentation, teils veraltet/widersprüchlich | gemischt |
| `scripts/` | 57 | Setup-, Deploy-, Migrations-, Seed-Skripte | gemischt |
| `functions/` | 50 | Cloud Functions (Einsatz-Zuweisung, E-Mail, Audit-Log, Dokumentenablauf, KPI) | produktiv |
| `functions-scheduled/` | 9 | Geplante Functions (Formular-Erinnerungen, KPI-Aggregation) | produktiv |
| `public/` | 25 | Icons, Favicons, Logo, Service Worker, Manifest, Offline-Seite | produktiv |
| `tests/` + `e2e/` + `lib/services/__tests__/` | 24+15+8 | Vitest-Unit-Tests, Playwright-E2E, Firestore-Rules-Tests | produktiv |
| `.cursor/` + `.cursorrules` | 25 | Cursor-IDE-Regeln, **enthält persönliche Entwicklerpfade** | Entwicklungswerkzeug |
| `pages/api/` | 1 | Legacy-Route `create-assignment.ts` (Pages Router) | prüfen (Ph. 3) |
| `contexts/`, `messages/`, `.storybook/` | 5+1+3 | React-Contexts, i18n (de.json), Storybook | produktiv/Werkzeug |

**Wichtige Einzeldateien:** `proxy.ts` (Root) ist eine für **Next 16 vorbereitete** Middleware (Redirects, Security-Header, Routen-Schutz) – unter Next 15.5 **inaktiv** (Konvention heißt dort `middleware.ts`). Security-Header kommen derzeit aus `next.config.js`; Routen-Schutz ist client-seitig (`AuthGuard`) + serverseitig in API-Routen.

## 2. Frameworks & Versionen (verifiziert aus package.json)

Next.js 15.5.12 (App Router), React 18.3, TypeScript 5.9 (strict), **MUI 7** (+ Emotion) als primäres UI-System, Tailwind 4 (Rest-Nutzung, per Cursor-Regeln unerwünscht), react-hook-form + zod, TanStack Query 5, Firebase JS SDK 12, firebase-admin 12, Sentry 8, Vitest 2, Playwright 1.51, Storybook 8, ESLint 9 (Flat Config).

> **Abweichung zur Produktbeschreibung:** Die Beschreibung nennt Tailwind + Radix UI und Region `europe-west3`. Tatsächlich ist **MUI** das UI-System (Radix ist nicht installiert), und `firebase.json` konfiguriert **`europe-west1`** als Hosting-Backend-Region. Cloud-Functions-Codebases: `default` + `scheduled`, Node 20.

## 3. Build & Deployment

- `npm run build` = `next build` + `scripts/ensure-export-marker.js`; ESLint im Build bewusst deaktiviert (läuft separat), Produktions-Wächter verlangt Impressums-ENV.
- Deploy: Firebase Hosting mit `frameworksBackend` (Next.js auf Cloud Functions, `europe-west1`) via `firebase deploy`; CI-Workflow `firebase-hosting.yml` deployt bei Push.
- **CI/CD-Risiko:** GitHub Actions ist seit 31.05.2026 repo-weit inaktiv (0 Runs; Settings/Billing prüfen). `ci.yml` und `ci-cd.yml` sind redundant (beide: install → lint:ci → typecheck:ci → build) → Konsolidierungskandidat.

## 4. Firebase-Struktur

- **Auth:** Firebase Authentication (E-Mail/Passwort; OIDC-Provider optional via `NEXT_PUBLIC_OIDC_PROVIDER_ID`). Rollen über Custom Claims (`role`), Fallback auf `users/{uid}.role` (Henne-Ei beim ersten Login). Admin-Bootstrap über `/api/auth/ensure-admin-role` (ENV-gegatet), reguläre Wege: `register-admin` + Einladungs-Flow (`accept-invite`).
- **Rollen:** `admin`, `nurse` (= Mitarbeiter); zusätzlich `dispatcher` in E2E-Tests/Whitelist erwähnt → tatsächliche Nutzung in Phase 5 verifizieren.
- **Firestore-Collections** (aus `firestore.rules`): `users`, `facilities`, `shifts`, `documents`, `assignments`, `reports`, `employeeReports`, `adminAnnouncements`, `activities`, `timesheets`, `limitIncreaseRequests`, `times`, `alerts`, `notifications`, `settings`, `config`, `systemSettings`, `adminSettings`, `adminRoles`, `adminDocumentTypes`, `documentTypes`, `auditLogs`, `route_cache`. Default-Deny am Ende. **Single-Tenant-Modell** (`SINGLE_COMPANY_ID`, Mandanten-Helper bewusst Stubs – dokumentiert, durch `tests/rules/` gepinnt).
- **Storage:** `logos/**` (öffentlich lesbar; **Schreiben: jeder authentifizierte User** → Befund Ph. 4), `documents/{userId}/...` (Besitzer/Admin, 10 MB, image/pdf). Kein Pfad für Signaturen definiert → prüfen, wo Unterschriften gespeichert werden (Ph. 4/5).
- **Cloud Functions (default):** `assignShift`, `declineAssignment`, `findCandidates`, `deleteAllAssignments` (⚠ destruktiv – Absicherung prüfen), Auth-Helpers (`getUserRole`, `getUsersWithRoles`), Audit-Log-Trigger, Dokumentenablauf-Checks, Versand-/Benachrichtigungs-Functions, ArbZG-Validierung (`validateTimesheetArbZG`), Chat, API-Monitoring. **(scheduled):** Formular-Erinnerungen, KPI-Aggregation.
- **API-Routen (App Router, 30):** admin (Import, Scheduled Reports, Shifts, DSGVO-Export/-Löschung), assignment, auth (Session, Claims-Sync, Registrierung, Einladung), templates, invitations, user (Export/Löschung), users, forms/reminders, health, cf (Cloud-Function-Proxy), proxy-create, debug (3, prod-gegatet). **Plus Legacy:** `pages/api/create-assignment.ts`.

## 5. Environment-Variablen (aus Code extrahiert)

- **Client (`NEXT_PUBLIC_`):** Firebase-Config (6), App-URL, Impressum (`COMPANY_*`, `LEGAL_FORM`, `REGISTER_*`, `RESPONSIBLE_*`, `VAT_ID`), `VAPID_KEY`, `OIDC_PROVIDER_ID`, Emulator-Flags, `DEBUG_PERMISSIONS`, `ENABLE_ADMIN_BOOTSTRAP`, `SECURITY_WEBHOOK_URL` (⚠ als NEXT_PUBLIC fragwürdig → Ph. 4).
- **Server:** `FIREBASE_ADMIN_CREDENTIALS(_BASE64)`, SMTP_* (6), `INVITATION_EMAIL_SECRET`, `ENABLE_ADMIN_BOOTSTRAP`/`ADMIN_BOOTSTRAP_EMAIL`, `ORS_API_KEY` (OpenRouteService), `SECURITY_WEBHOOK_URL`, `GCLOUD_PROJECT`.
- `.env.example`, `.env.production.example`, `.env.staging.example` vorhanden; Vollständigkeit wird in Phase 10 gegen diese Liste abgeglichen.

## 6. Externe Dienste

Firebase (Auth/Firestore/Storage/Functions/Hosting/FCM), Sentry, SMTP-Anbieter (E-Mail), OpenRouteService (Routen/Karten), Google Fonts (CSP), Google Tag Manager (CSP erlaubt; tatsächliche Nutzung prüfen → Ph. 6 Datenschutz).

## 7. Tests & Qualität

Vitest-Unit-Tests (`lib/services/__tests__`: 8 Service-Tests, `tests/`), Playwright-E2E (`e2e/`: anmelden, critical-flows, RBAC, Impressum/Datenschutz, admin/dispatcher/employee), Firestore-Rules-Tests (`tests/rules/`, 9/9 grün). Typecheck grün, ESLint 9 grün (0 Warnungen), Produktions-Build grün (10.07.2026). **Testlauf-Status Unit/E2E: in Phase 8 zu verifizieren.**

## 8. Gefundene Altlasten & Befunde

### 8.1 Sicherheits-/Verkaufsrelevante Funde

| # | Fund | Ort | Bewertung |
|---|---|---|---|
| S1 | Hartcodierter Firebase-API-Key als Fallback | `scripts/seed-firestore.js:42` | Web-API-Keys sind by design öffentlich, aber Verkäufer-Projektbezug → **entfernen (Fallback löschen)** |
| S2 | Persönlicher Entwicklerpfad inkl. Key-Pfad `/Users/<name>/.keys/schichtklar-admin.json` | `scripts/sync-custom-claims.js:30` | **anonymisieren** (Pfad durch ENV/Arg ersetzen) |
| S3 | Persönliche Pfade/Name des Entwicklers | `.cursor/**`, `.npmrc` (Kommentar) | `.cursor/` = IDE-Werkzeug → **entfernen oder anonymisieren** |
| S4 | Verkäufer-Firebase-Projekt-ID `schichtklar` | `.firebaserc`, mehrere docs, Skripte | **vor Übergabe ersetzen** (Käufer-Projekt); dokumentieren in BUYER_HANDOVER |
| S5 | Branding `aufabruf` / `info@aufabruf.eu` | `.env*.example`, `firestore.rules` (`getRequesterCompanyId` → `'aufabruf'`), `lib/constants/company.ts`, `lib/services/documentGeneration.ts`, 1 Employee-Page, docs | Phase 11: **konfigurierbar machen / neutralisieren** |
| S6 | Storage: `logos/**` von **jedem** authentifizierten User beschreibbar | `storage.rules` | Phase 4: auf Admin einschränken |
| S7 | `deleteAllAssignments` Cloud Function (destruktiv) | `functions/src` | Phase 4: Autorisierung verifizieren |
| S8 | `NEXT_PUBLIC_SECURITY_WEBHOOK_URL` client-exponiert | Code | Phase 4 prüfen |
| S9 | Test-Logins `admin@schichtklar.de` etc. | `scripts/verified-emails-whitelist.txt`, Seeds, e2e | fiktive Domain, aber vor Übergabe dokumentieren/rotieren |

### 8.2 Tote/fragwürdige Dateien (Löschkandidaten – **noch nichts gelöscht**)

| Kandidat | Nachweis | Empfehlung |
|---|---|---|
| `.cursor/rules/prompt-optimization.mdc 2` | macOS-Duplikat („ 2“-Suffix), byteweise Kopie prüfen | sicher löschbar |
| `.cursor/` gesamt + `.cursorrules` | IDE-spezifisch, persönliche Pfade; für Käufer ohne Cursor nutzlos | entfernen (oder anonymisiert behalten, Entscheidung Ph. 11) |
| `pages/api/create-assignment.ts` | Legacy Pages-Router-Route; App-Router-Pendant `app/api/assignment/create` existiert | Referenzen prüfen (wer ruft `/api/create-assignment`?) → dann entfernen oder dokumentieren |
| `proxy.ts` | Unter Next 15 inaktiv (keine Middleware-Konvention) | behalten + dokumentieren (Next-16-Vorbereitung) ODER zu `middleware.ts` aktivieren (Ph. 4 entscheidet) |
| `ci.yml` vs. `ci-cd.yml` | redundante Pipelines | konsolidieren |
| Veraltete/widersprüchliche Doku (`MARKTREIFE_ANALYSE.md`, `build-errors`-Referenzen, `ARCHITECTURE-HEALTH.md` vs. Realität, `docs/release/*`-Audits, `APP_ZUSAMMENFASSUNG*` doppelt) | Widersprüche nachgewiesen (siehe PR #4) | in Phase 10 konsolidieren; historische Audits nach `docs/archive-vor-verkauf/` oder löschen |
| `scripts/fix-typescript-errors.sh`, `modernize-dialogs.js`, `code-cleanup.sh`, `replace-console-logs*` | Einmal-Werkzeuge vergangener Aufräumaktionen | prüfen + entfernen (Ph. 2) |
| `scripts/migrate-times-to-timesheets.js`, `migrate-to-production.sh` | Alt-Migrationen; Zweck dokumentieren oder entfernen | prüfen (Ph. 2) |
| `docs/"RECHTSKONFORMITÄT..."` | Umlaut-Dateiname mit Escaping-Problemen | umbenennen (ASCII) |

### 8.3 Positiv (keine Altlasten)

- Kein `.DS_Store`, keine `.log`/`.bak`/`.zip` im Repo, keine Build-Artefakte (seit PR #4).
- Keine Private Keys, keine `sk_live`-Secrets, keine echten Kundendaten gefunden (Seed-Daten sind fiktiv: `praxis@dr-mueller.de` u. ä.).
- Nur 2 TODO/FIXME, nur 5 `console.log` im Produktivcode.
- `src/`-Schicht ist KEINE Altlast (aktiv importiert).

## 9. Dateiklassifizierung (Zusammenfassung)

1. **Zwingend erforderlich:** `app/`, `lib/`, `components/`, `src/`, `contexts/`, `public/`, `functions*/`, Firebase-Configs, `next.config.js`, `package.json`, `tsconfig.json`, `eslint.config.mjs`
2. **Produktiv relevant:** `messages/`, `proxy.ts` (Next-16-Pfad), Sentry-Configs, `firestore.indexes.json`
3. **Entwicklungswerkzeug:** `.storybook/`, `e2e/`, `tests/`, `vitest.config.ts`, `playwright.config.ts`, Dev-Skripte, `.cursor/` (persönlich!), `.hintrc`, `.prettierrc`
4. **Dokumentation:** `docs/` (59, konsolidierungsbedürftig), Root-MDs
5. **Vermutlich unbenutzt:** `pages/api/create-assignment.ts`, Einmal-Skripte (8.2)
6. **Sicher löschbar:** `.cursor/rules/prompt-optimization.mdc 2`
7. **Sicherheitskritisch:** `firestore.rules`, `storage.rules`, `app/api/**`, `functions/src/**`, `lib/server/**`, Auth-Flows
8. **Vor Verkauf zu anonymisieren:** S1–S5, S9 (siehe 8.1), `.npmrc`-Kommentar

## 10. Technische Risiken & Verkaufsrisiken (priorisiert)

1. **CI tot** (keine Actions-Runs seit 31.05.) → kein automatisches Sicherheitsnetz. *(extern zu beheben: Settings/Billing)*
2. **Storage-Rule `logos/**` zu weit** (jeder authentifizierte User darf schreiben).
3. **Client-seitiger Routen-Schutz** (`proxy.ts` inaktiv): Admin-Seiten liefern Shell an Nicht-Admins; Datenzugriff ist durch Rules/API geschützt, aber Server-Gate fehlt → Ph. 4.
4. **Doku widerspricht Realität** (Stack-Beschreibung Tailwind/Radix vs. MUI; Region west3 vs. west1; alte Audits) → Verkaufsrisiko „Due-Diligence-Vertrauen“ → Ph. 10.
5. **Verkäufer-Bindung** (Projekt-ID, Branding, persönliche Pfade) → Ph. 11.
6. **Single-Tenant-Architektur** – kein Mangel, muss aber im Verkaufsdossier klar als „1 Kunde = 1 Firebase-Projekt“ positioniert sein.
7. **Doppelte CI-Workflows**, Legacy-Route, ungeprüfte `dispatcher`-Rolle → Konsistenz.

## 11. Vorgeschlagene Arbeitsreihenfolge

1. ✔ Phase 1: dieses Audit
2. Phase 2: bestätigte Altlasten entfernen (`REMOVED_FILES.md`)
3. Phase 4 (vorgezogen vor 3, Priorität Datensicherheit): Security-Audit + Fixes (Storage-Rule, Routen-Schutz, `deleteAllAssignments`, Functions/API-Prüfung, Secrets)
4. Phase 3: Codequalität (gezielt, keine Umbauten)
5. Phase 5: Geschäftsregeln + Tests
6. Phase 6: Datenschutz (`PRIVACY_AND_COMPLIANCE.md`)
7. Phase 7: Dependencies/Lizenzen
8. Phase 8: QA-Lauf gesamt (`QA_REPORT.md`)
9. Phase 9: Performance
10. Phase 10: Käufer-Doku (README, ARCHITECTURE, DATABASE_SCHEMA, …)
11. Phase 11: White-Label/Anonymisierung
12. Phase 12: Abschlusscheck + `MARKET_READY_REPORT.md`
