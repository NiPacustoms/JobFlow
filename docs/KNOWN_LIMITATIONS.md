# Bekannte Einschränkungen & offene Punkte

**Stand:** 10.07.2026 · Schichtklar

Ehrliche Auflistung aller bekannten Einschränkungen, offenen Entscheidungen und bewusst zurückgestellten Arbeiten. Priorisiert nach Dringlichkeit für einen Käufer.

## A. Vor Produktivbetrieb zwingend

| # | Thema | Details |
|---|---|---|
| A1 | ~~Impressums-/Legal-Daten setzen~~ **ENTSCHIEDEN: Rechtstexte liefert die Hauptseite** | Eigentümer-Entscheidung (21.07.2026): Die App wird in eine bestehende Seite eingebunden, die Impressum/AGB/Datenschutz bereits führt. Der Build-Blocker `validateLegalConfig()` ist zu einer Warnung entschärft. Optional: `NEXT_PUBLIC_IMPRESSUM_URL` / `NEXT_PUBLIC_DATENSCHUTZ_URL` / `NEXT_PUBLIC_AGB_URL` auf die Hauptseite zeigen lassen (sonst interne Platzhalter-Seiten) und `NEXT_PUBLIC_COMPANY_*` für Dokument-Briefköpfe setzen. |
| A2 | ~~Finale Markenassets~~ **ERLEDIGT (verifiziert 21.07.2026)** | Logos sind final und korrekt verdrahtet: Die App nutzt das Schichtklar-Logo (`public/logo-default.png` + Dark-Variante, `logo.svg`, Favicons/PWA-Icons), die generierten Dokumente nutzen bevorzugt das AufAbruf-Firmenlogo (`public/company-logo.png`, Fallback Schichtklar) über `brandedPdf.loadLogoDataUrl()`. |
| A3 | **Produktions-Domain & CORS** | Domain + Support-E-Mail festlegen; `scripts/storage-cors.json` (Platzhalter `your-production-domain.example`) auf echte Origin setzen und via `npm run storage:cors` anwenden. |
| A4 | **AVV mit Google Cloud** | Auftragsverarbeitungsvertrag abschließen; Region `europe-west1` ist bereits gesetzt. |
| A5 | ~~GitHub Actions reaktivieren~~ **ENTSCHIEDEN: keine GitHub Actions** | Eigentümer-Entscheidung (21.07.2026): Es werden keine GitHub Actions genutzt; die toten Workflow-Dateien wurden entfernt. Qualitätssicherung läuft lokal: `npm run validate` (Lint + Typecheck) bzw. `npm run ci:verify` vor jedem Deploy; `npm run deploy` baut ohnehin frisch. |
| A6 | ~~Blaze-Plan für Storage & Functions~~ **ERLEDIGT** | Blaze aktiviert (10.07.2026). Storage-Bucket (`europe-west1`) provisioniert, Storage-Rules deployt, alle **37 Cloud Functions** inkl. Scheduler-Jobs live. Vollständiger Stand: `INFRASTRUCTURE_RENAMING.md` §1a. |

## B. Vor Produktivbetrieb empfohlen

| # | Thema | Details |
|---|---|---|
| B1 | ~~Legacy-Unit-Test-Suite sanieren~~ **ERLEDIGT** | Suite saniert (jsdom-Umgebung, `@testing-library/react`, Mock-/API-Drift behoben) und Produktlücke F1 (Mitarbeiter-Berichte) geschlossen: `npm run test:unit` grün (**65 passed, 0 skipped, 0 failed**). In CI aufgenommen (`quality.yml`). |
| B2 | **`next` patchen** | Auf `>=15.5.13` heben (schließt Rewrite-Request-Smuggling-Advisory). Siehe `DEPENDENCY_AUDIT.md`. |
| B3 | **`firebase-admin` aktualisieren** | Schließt transitive `@grpc/grpc-js`/`node-forge`-Advisories (serverseitig). |
| B4 | **Server-Routen-Gate aktivieren** | `proxy.ts` ist für Next 16 vorbereitet, unter Next 15 inaktiv. Datenzugriff ist bereits durch Firestore-Rules + API-Rollenprüfung geschützt; ein zusätzliches Middleware-Gate wäre Defense-in-Depth (Vorsicht: CSP-Header-Überschneidung mit `next.config.js`). |
| B5 | **`deleteAllAssignments` absichern/entfernen** | Destruktive Wartungs-Cloud-Function (admin-only, korrekt autorisiert). Vor Kundenauslieferung entfernen oder hinter zusätzliches Bestätigungs-Flag stellen. |
| B6 | **Rate-Limiting vereinheitlichen** | `ensure-admin-role` (ENV-gegatet) und `invitations` haben kein Rate-Limit; andere Auth-Routen schon. |

## C. Fachliche Entscheidungen (Eigentümer)

| # | Thema | Details |
|---|---|---|
| C1 | **Regel „1 Einsatz pro Kalendertag"** | Aktuell als **Zeit-Überlappung** implementiert (`createWithMatching.ts`), nicht als „ein Einsatz pro Kalendertag". Zwei nicht-überlappende Einsätze am selben Tag wären möglich. Wenn die harte Kalendertag-Regel gilt, muss der Konflikt-Check umgestellt werden (schließt Split-Shifts aus → Freigabe nötig). Siehe `QA_REPORT.md`. |
| C2 | ~~Regel „Signaturblock max. 7 Tage"~~ **ERLEDIGT (11.07.2026)** | `calculateSignatureSchedule` garantiert die 7-Tage-Blöcke jetzt konstruktiv (Sonntage + Einsatzende, Termin nie nach Einsatzende); zusätzlich prüfbar via `validateSignatureScheduleMaxBlock()`. Dabei behobene Bugs: UTC-Off-by-one der Datums-Keys (Signaturtermine an Sonntagen verfehlten den Abgleich), Signaturtermin lag bei kurzen Einsätzen ohne Sonntag NACH dem Einsatzende (dadurch öffnete sich der Einrichtungs-Signatur-Dialog praktisch nie), Duplikat wenn Einsatzende = Sonntag. 10 neue Unit-Tests. |

## D. Architektur-Hinweise (kein Mangel, dokumentiert)

| # | Thema | Details |
|---|---|---|
| D1 | **Single-Tenant-Modell** | 1 Kunde = 1 Firebase-Projekt (`SINGLE_COMPANY_ID`). Mandanten-Helper in `firestore.rules` sind bewusst Stubs (`return true`). Für Multi-Tenant müssten `belongsToSameCompany` echt implementiert und alle List-Queries mit `companyId`-Filter versehen werden. Durch `tests/rules/` als bewusste Entscheidung gepinnt. |
| D2 | **UI-System = MUI** | Trotz vorhandener Tailwind-Restkonfiguration ist MUI das führende Design-System (Radix ist nicht installiert). |
| D3 | **Firebase-Projekt migriert** | Neues Projekt `schichtklar` angelegt, alle Deploy-Referenzen umgestellt (Frischstart). Erforderlicher GitHub-Schritt: Secret `FIREBASE_SERVICE_ACCOUNT_SCHICHTKLAR` mit Service-Account des neuen Projekts anlegen. Details: `INFRASTRUCTURE_RENAMING.md`. |

## F. Produktlücke: Mitarbeiter-Berichte teils Stub

| # | Thema | Details |
|---|---|---|
| F1 | ~~`useEmployeeReports` Aggregation/Export~~ **ERLEDIGT** | Echte Aggregation implementiert: `workTimeReport` (Gesamt-/Regel-/Überstunden, Arbeitstage, Ø pro Tag/Woche, `hoursByDay`-Chartdaten, §3-ArbZG-10h-Check), `surchargesReport` (Gesamtzuschlag + anteilige Aufteilung nach Nacht/Wochenende/Feiertag/Überstunden) und `exportWorkTimeReport` (ruft `reportService`-PDF/Excel-Export). Die 3 zuvor übersprungenen Tests sind reaktiviert und grün. |

## E. Optionale Ausbaustufen (Marktrecherche)

PDL-Freigabe per Magic-Link (Remote-Bestätigung ohne Account), §82c-Satzdeckel-Monitor, Equal-Pay-/Höchstüberlassungs-Countdown, DATEV-Export-Vertiefung. Kein Blocker – Differenzierungsmerkmale.
