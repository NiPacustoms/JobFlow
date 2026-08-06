# Käufer-Übergabe (Buyer Handover)

**Stand:** 10.07.2026 · Schichtklar

Praktische Checkliste für die technische Übergabe an einen Käufer. Ziel: der Käufer kann Betrieb, Deployment und Wartung eigenständig übernehmen.

## 1. Konten – übertragen vs. neu anlegen

| Asset | Empfehlung |
|---|---|
| **Firebase-/Google-Cloud-Projekt** (`schichtklar`) | Entweder Projekt-Ownership übertragen (IAM: neuen Owner hinzufügen, alten entfernen) **oder** neues Käufer-Projekt anlegen + Daten migrieren (siehe `INFRASTRUCTURE_RENAMING.md`). Empfehlung: **neues Projekt** für saubere Trennung. |
| **GitHub-Repository** | Repo-Transfer an Käufer-Org **oder** Fresh-Clone in neues Repo. Danach GitHub-Secrets neu setzen. |
| **Domain** | Beim Registrar auf Käufer übertragen; DNS auf Firebase Hosting zeigen lassen. |
| **E-Mail-Dienst** (SMTP) | Neues Käufer-Postfach; SMTP-Zugang neu erzeugen. |
| **Sentry** | Neues Käufer-Projekt; DSN in ENV tauschen. |
| **OpenRouteService** | Neuen API-Key des Käufers eintragen. |

## 2. Secret-/Key-Rotation (zwingend bei Übergabe)

Alle Zugangsdaten neu erzeugen und alte widerrufen:
- Firebase Service-Account (neu erstellen, altes Key-File löschen) → GitHub-Secret `FIREBASE_SERVICE_ACCOUNT_*` neu setzen.
- Firebase Web-API-Config (bei neuem Projekt automatisch neu).
- SMTP-Zugang, `INVITATION_EMAIL_SECRET`, `ORS_API_KEY`, `SECURITY_WEBHOOK_URL`.
- Firebase Auth: bestehende Sessions invalidieren (bei Projektwechsel ohnehin).

> Es liegen **keine** Secret-Werte im Repository (nur `.env*.example`-Platzhalter).

## 3. Eigentümerwechsel / erstes Setup

1. Firebase-Projekt anlegen/übernehmen (Region `europe-west1`), Auth (E-Mail/Passwort), Firestore, Storage aktivieren.
2. `.env.local` / Hosting-ENV aus `.env.production.example` befüllen (inkl. echter Impressumsdaten – sonst Build-Guard).
3. `firebase deploy --only firestore:rules,firestore:indexes,storage` (Rules & Indizes).
4. Cloud Functions deployen (`functions`, `functions-scheduled`).
5. App bauen & deployen (`npm run build && firebase deploy`).
6. **Admin-Konto anlegen:** über `/admin-registrieren` **oder** einmalig Bootstrap (`ENABLE_ADMIN_BOOTSTRAP=true` + `ADMIN_BOOTSTRAP_EMAIL`, danach wieder deaktivieren). Custom Claims via `scripts/sync-user-claims.js` synchronisieren.
7. Mitarbeiter per Einladungs-Flow (`/api/invitations`) anlegen.

## 4. Datenmigration / Backup / Recovery

- **Migration** (nur bei Projektwechsel): Firestore/Storage per Managed Export/Import; Auth via `firebase auth:export`/`auth:import`. Details: `INFRASTRUCTURE_RENAMING.md`.
- **Backup:** regelmäßige Firestore-Exporte (Skripte `scripts/firestore-backup.sh`, `scripts/storage-backup.sh`) einrichten; Aufbewahrung nach Compliance-Vorgaben.
- **Recovery:** Import der Exporte in ein sauberes Projekt; Rules/Indizes/Functions neu deployen.

## 5. Test- & Admin-Konten

- Dev-Seed-Logins verwenden die fiktive Domain `@schichtklar.test` (`scripts/seed-firestore.js`) – **nicht** in Produktion nutzen.
- Vor Go-Live Demo-/Testdaten entfernen (`npm run cleanup:demo`).

## 6. Logging & Monitoring

- Sentry (Client/Server/Edge) – DSN setzen.
- Optional `SECURITY_WEBHOOK_URL` (serverseitig) für Security-Events.
- Firebase-Konsole: Functions-Logs, Firestore-Nutzung, Auth-Events.

## 7. Externe Dienste & laufende Kosten (Größenordnung)

- **Firebase/GCP:** verbrauchsabhängig (Firestore-Reads/Writes, Storage, Functions-Invocations, Hosting-Bandbreite). Für kleine Teams i. d. R. gering; skaliert mit Nutzung.
- **SMTP-Anbieter:** E-Mail-Kontingent (Einladungen/Benachrichtigungen).
- **Sentry:** Free/Team-Tier je nach Event-Volumen.
- **OpenRouteService:** Free-Tier mit Limits; kommerziell ggf. kostenpflichtig.

## 8. Lizenz- & Rechtshinweise

- Alle Laufzeit-Abhängigkeiten permissiv lizenziert (`THIRD_PARTY_LICENSES.md`) → Weiterverkauf zulässig.
- Vor Produktivbetrieb: AV-Verträge, Datenschutzerklärung, Impressum (siehe `PRIVACY_AND_COMPLIANCE.md`).

## 9. Offene technische Risiken & Wartung

Siehe `docs/KNOWN_LIMITATIONS.md` (A–E) und `docs/DEPENDENCY_AUDIT.md`. Empfohlenes Wartungsintervall: monatliches Dependency-Update-Fenster + CI-`npm audit`-Gate.
