# Plan: App zu 100 % nutzbar machen

**Stand:** 27.07.2026 · Ziel: Die AufAbruf GmbH kann die App im Tagesbetrieb
einsetzen, ohne auf ein Bedienelement zu treffen, das nichts oder Falsches tut.

Grundlage sind verifizierte Befunde (Code gelesen, Pfade nachgeprüft) – nicht
der Stand der älteren Doku. Wo `KNOWN_LIMITATIONS.md` etwas als erledigt
führt, das nachweislich nicht funktioniert, ist das hier vermerkt.

---

## Phase 0 – Blocker im Nutzerpfad (zwingend)

Drei Bedienelemente sind für den Nutzer erreichbar und täuschen ihn. Das sind
die einzigen verifizierten Fälle dieser Art; alle übrigen Platzhalter im Code
sind aus der Oberfläche **nicht** erreichbar (siehe Phase 3).

### P0-1 · Mitarbeiter → Zeiten → „Export PDF" lädt eine leere Datei

**Befund:** `timesService.exportTimes()` (`lib/services/times.ts:684`) gibt den
Pfad `/times-export.pdf` zurück. Diese Datei existiert nicht (`public/` geprüft).
`useTimes` (`lib/hooks/useTimes.ts:158-170`) hängt den Pfad an ein
`<a download>` und meldet anschließend „Zeiten erfolgreich exportiert". Der
Mitarbeiter lädt eine 404-Antwort herunter und glaubt, seinen Nachweis zu haben.

**Lösung:** `exportTimes` auf die vorhandene, getestete Erzeugung umstellen:
- PDF → `documentGenerationService.generateDocument({ type: 'timesheet-report', userId, dateRange })`
  liefert ein gebrandetes PDF mit echter Storage-URL.
- CSV/Excel → `ExportService.exportToCSV` / `exportToExcel` mit den geladenen
  Zeiteinträgen (seit dem HTML-Escaping-Fix sicher).

**Aufwand:** ~0,5 Tag inkl. Tests. Beide Zielbausteine sind bereits abgedeckt.

### P0-2 · Mitarbeiter → Berichte → Export schlägt immer fehl

**Befund:** `useEmployeeReports.exportWorkTimeReport()`
(`lib/hooks/useEmployeeReports.ts:222-232`) ruft
`reportService.exportTimeAccountReportPDF({ reportId: 'employee-worktime' })`.
`reportService.exportReport()` liest zuerst `reports/employee-worktime` aus
Firestore – ein Dokument mit dieser ID wird nirgends angelegt (Repo-weit
geprüft). Ergebnis: `Report not found` → die Seite zeigt „Export
fehlgeschlagen". `KNOWN_LIMITATIONS.md` F1 führt diesen Export als erledigt.

**Lösung:** Den Umweg über die Berichtsverwaltung streichen und direkt
`documentGenerationService.generateDocument({ type: 'timesheet-report' | 'monthly-report' })`
verwenden – dieselbe Erzeugung wie beim Stundennachweis, ohne Bericht-Dokument.

**Aufwand:** ~0,5 Tag inkl. Tests.

### P0-3 · Admin → Einstellungen → „Backup erstellen" erzeugt kein Backup

**Befund:** `adminSettingsService.backupData()`
(`lib/services/adminSettings.ts:404`) liefert eine JSON-Datei mit vier
Metadatenzeilen – inklusive **hartkodierter** Größe `'2.5 MB'`. Es werden keine
Daten exportiert. `restoreData()` prüft nur `timestamp`/`version` und tut sonst
nichts. Die Oberfläche (`app/(admin)/admin/einstellungen/page.tsx`, Tab
„Backup & Restore") wirbt dabei mit „Erstellen Sie regelmäßig Backups Ihrer
Daten, um Datenverluste zu vermeiden."

Das ist der gefährlichste Befund: Er erzeugt ein falsches Sicherheitsgefühl,
obwohl ein **echter** Mechanismus existiert
(`functions-scheduled/src/firestoreBackup.ts`, täglicher Firestore-Export in
`gs://<projekt>-backups`).

**Lösung (empfohlen):** Tab zu „Sicherungsstatus" umbauen:
1. Die Scheduled Function schreibt nach jedem Lauf ein Statusdokument
   (Zeitpunkt, Zielpfad, Ergebnis).
2. Die Oberfläche zeigt „Letzte Sicherung: <Zeitpunkt> · <Ergebnis>" und
   verweist für die Wiederherstellung auf `DISASTER_RECOVERY.md` (RTO ≤ 2 h).
3. „Backup erstellen" entweder entfernen oder als Callable auf die echte
   Function legen (manuelles Auslösen).
4. Restore-Upload entfernen – eine Firestore-Wiederherstellung ist ein
   Admin-Vorgang über `gcloud`, nichts für einen Browser-Upload.

**Aufwand:** ~1 Tag (Statusdokument + Oberfläche + Tests).

---

## Phase 1 – Inbetriebnahme (Konfiguration & Erst-Einrichtung)

Code-seitig fertig; hier fehlen Werte und Zugänge. Ohne diese Punkte startet
die App, aber Mails, Push, Anfahrten und Rechtslinks bleiben unvollständig.

| # | Punkt | Wer | Ohne das passiert |
|---|-------|-----|-------------------|
| 1 | Produktions-Domain festlegen; `NEXT_PUBLIC_APP_URL` setzen; `scripts/storage-cors.json` von `your-production-domain.example` auf die echte Origin ändern und `npm run storage:cors` ausführen | Eigentümer | Datei-Uploads/-Downloads scheitern per CORS |
| 2 | `RESEND_API_KEY` + `RESEND_FROM` (oder SMTP-Variablen) | Eigentümer | Einladungen und Stundennachweis-Mails werden nur protokolliert, nicht versandt |
| 3 | `NEXT_PUBLIC_FIREBASE_VAPID_KEY` | Eigentümer | Keine Push-Hinweise auf neue Einsätze |
| 4 | `ORS_API_KEY` (OpenRouteService) | Eigentümer | Anfahrtsberechnung liefert nichts |
| 5 | `BACKUP_BUCKET` + Bucket anlegen | Eigentümer | Tägliche Sicherung läuft ins Leere (siehe P0-3) |
| 6 | `NEXT_PUBLIC_IMPRESSUM_URL`, `NEXT_PUBLIC_DATENSCHUTZ_URL`, `NEXT_PUBLIC_AGB_URL` auf die Hauptseite zeigen lassen | Eigentümer | Fallback auf interne Seiten, die wörtlich `[Platzhalter]` enthalten – bei gewerblicher Nutzung mit Beschäftigtendaten ein rechtliches Risiko. Zusätzlich verlinkt `app/page.tsx:529` fest auf die AVV-Platzhalterseite; dieser Link muss mitgezogen oder entfernt werden (Code-Änderung, ~15 min) |
| 7 | Sentry-DSN (optional) | Eigentümer | Keine Fehlermeldungen aus dem Produktivbetrieb |
| 8 | Deploy: `npm run ci:verify`, dann Firestore-Rules, Indexes, Functions, Hosting | ich | – |
| 9 | Ersten Admin anlegen: `ENABLE_ADMIN_BOOTSTRAP=true` + `ADMIN_BOOTSTRAP_EMAIL`, `/fix-admin-role` aufrufen, **danach beide Variablen wieder entfernen** | gemeinsam | Kein Zugang zum Admin-Bereich |
| 10 | Stammdaten erfassen: Einrichtungen mit Stationen, Dokumenttypen, Rollen | Eigentümer | Schichten lassen sich nicht anlegen |
| 11 | Mitarbeitende einladen und eine Einladung echt durchspielen | gemeinsam | Onboarding unbestätigt |

---

## Phase 2 – Abnahme mit echten Konten

Automatisierte Tests deckten zuletzt 1645 Unit-Tests, die Firestore-Rules und
34 + 108 E2E-Tests ab. Für „100 % nutzbar" fehlt der Durchlauf der
Kernprozesse auf der Produktionsumgebung – einmal von Hand, nach Drehbuch:

1. Admin legt Einrichtung + Station an.
2. Admin legt eine Schicht an (inkl. Nachtschicht über Mitternacht).
3. Admin weist eine Pflegekraft zu → Mitarbeiter erhält Push + Mail.
4. Mitarbeiter nimmt an → Einsatzmitteilung (§ 11 AÜG) wird erzeugt.
5. Mitarbeiter lehnt einen zweiten Einsatz mit Unterschrift ab.
6. Mitarbeiter stempelt ein, macht Pause, stempelt aus.
7. Prüfen: Wochenlimit-Warnung bei Annäherung, Sperre bei Überschreitung.
8. Prüfen: ArbZG-Verstoß (> 10 h) wird beim Einreichen serverseitig abgewiesen.
9. Mitarbeiter unterschreibt den Stundennachweis → PDF geht sofort an
   Mitarbeiter, Admins, Einrichtung und `info@aufabruf.eu`.
10. Einrichtung bestätigt per Signatur (Sammelbestätigung über den Zeitraum).
11. Mitarbeiter exportiert seine Zeiten (setzt P0-1 und P0-2 voraus).
12. Offline-Fall: Flugmodus, Zeit erfassen, wieder online – Eintrag wird
    genau einmal übernommen.
13. DSGVO: Datenauskunft und Löschung für ein Testkonto auslösen.

**Ergebnis:** abgezeichnetes Protokoll; jeder Fehlschlag wird als Befund
aufgenommen und behoben, bevor echte Mitarbeitende auf das System gehen.

**Aufwand:** ~1 Tag gemeinsam.

---

## Phase 3 – Toten Code entfernen (kein Nutzerimpact, aber Wartungslast)

Diese Platzhalter sind aus der Oberfläche **nicht** erreichbar (in `app/`
nachgeprüft: keine Treffer). Sie sind kein Blocker, aber sie täuschen jeden,
der später am Code arbeitet:

| Stelle | Befund | Vorschlag |
|--------|--------|-----------|
| `lib/hooks/useStaffGroups.ts` | Enthält eigene Stubs, die Fehler werfen – obwohl `lib/services/staffGroups.ts` real existiert und vollständig getestet ist | Hook auf den echten Service umstellen (dann ist das Feature nutzbar, falls eine Gruppen-Oberfläche gewünscht ist) oder Hook löschen |
| `adminSettingsService.getSystemInfo()` | Liefert hartkodiert „99.9 % Uptime", „512 MB", „15 % CPU" | Entfernen oder an echte Messwerte hängen |
| `useNurseSchedule.checkConflicts/checkBreakRule` | Geben immer `[]` bzw. `true` zurück – die 11-Stunden-Ruhezeit wird hier nicht geprüft (die echte Prüfung sitzt serverseitig in der ArbZG-Validierung) | Entfernen, damit niemand sie für eine echte Prüfung hält |
| `useSchedule.checkConflicts/getAssignmentsForDateRange` | Kommentiert als „would need to be enhanced" | Entfernen oder implementieren |
| `useAdminDashboard.getTopPerformers/getTopFacilities` | Leere Listen | Entfernen |
| `employeeReports.generateReportData` | Liefert Nullstrukturen | Entfernen (Berichte laufen über `useEmployeeReports`) |
| `employeeFacilities.exportFacilities`, `employeeReports.exportReport/bulkExport` | Liefern nur Pfade auf nicht existierende Dateien | Entfernen oder wie P0-1 auf echte Erzeugung umstellen |

**Aufwand:** ~1 Tag.

---

## Phase 4 – Offene fachliche Entscheidungen (nur Eigentümer)

Diese Punkte kann ich nicht selbst entscheiden, weil sie den Arbeitsablauf
festlegen:

1. **„Ein Einsatz pro Kalendertag" oder Zeitüberlappung?** Aktuell gilt
   Überlappung – zwei nicht überlappende Einsätze am selben Tag sind erlaubt
   (Split-Shift). Die harte Kalendertagsregel würde Split-Shifts ausschließen.
2. **Mehrfachzuweisung bei Kapazität > 1** (bisher zurückgestellt): soll die
   Kapazität proportional aufgeteilt werden?
3. **Bestätigungsmail – Ablauf:** wer bekommt sie zu welchem Zeitpunkt?
4. **Logik bei der Zeiterfassung:** offene Notiz aus dem handschriftlichen
   Feedback – bitte konkretisieren.

---

## Reihenfolge und Aufwand

| Phase | Inhalt | Aufwand (ich) | Blockiert Nutzung? |
|-------|--------|---------------|--------------------|
| 0 | Drei defekte Bedienelemente | ~2 Tage | **Ja** |
| 1 | Konfiguration, Deploy, erster Admin | ~0,5 Tag + Zulieferung | **Ja** |
| 2 | Abnahme nach Drehbuch | ~1 Tag gemeinsam | **Ja** |
| 3 | Toten Code entfernen | ~1 Tag | Nein |
| 4 | Fachliche Entscheidungen | nach Antwort | Teilweise |

**Kürzester Weg in den Tagesbetrieb:** Phase 0 → Phase 1 → Phase 2.
Phase 3 und 4 können parallel oder danach laufen.
