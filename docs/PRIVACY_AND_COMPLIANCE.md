# Datenschutz & Compliance

**Stand:** 10.07.2026 · Schichtklar

> **Kein Rechtsrat.** Dieses Dokument beschreibt den technischen Ist-Zustand und markiert Punkte, die **von einem Fachanwalt / Datenschutzbeauftragten** geprüft werden müssen (⚖️).

## 1. Verarbeitete personenbezogene Daten

Mitarbeiter-Stammdaten (Name, Kontakt, Adresse, Bankverbindung, Qualifikationen, Notfallkontakt), Arbeitszeiten/Einsätze, hochgeladene Dokumente, digitale Unterschriften (Mitarbeiter + verantwortliche Person vor Ort). Besonderer Schutzbedarf: Bankdaten, Unterschriften, ggf. Gesundheitsbezug (Krankheitszeiten `type='sick'`).

## 2. Technische Maßnahmen (Ist)

| Prinzip | Umsetzung |
|---|---|
| **Zugriffskontrolle** | Firestore Security Rules (rollenbasiert, Besitzer/Admin), serverseitige API-Rollenprüfung, Storage-Rules (Besitzer/Admin) |
| **Rollen-Isolation** | Mitarbeiter sehen nur eigene Daten; Rollen-Eskalation über eigenes User-Dokument technisch unterbunden (Rules-Guard + Test) |
| **Datenexport (Auskunft, Art. 15/20)** | `/api/user/data-export` (eigene Daten) und `/api/admin/user/[userId]/data-export` (Admin) → JSON-Download |
| **Löschung (Art. 17)** | `/api/user/data-deletion`, `/api/admin/user/[userId]/data-deletion`; Cloud Function `deleteUserData` |
| **Unveränderlichkeit/GoBD** | `auditLogs` nur via Cloud Functions beschreibbar; approved/submitted Timesheets schreibgeschützt |
| **Transport/Speicherung** | HTTPS erzwungen (HSTS), CSP (ohne `unsafe-eval` in Prod), Region `europe-west1` (EU) |
| **Verschlüsselung** | `crypto-js` für sensible Felder (clientseitig); Firestore/Storage serverseitig verschlüsselt (Google) |

## 3. Zu prüfen / festzulegen (⚖️ Fachanwalt/DSB)

- ⚖️ **AV-Vertrag mit Google Cloud** abschließen; Verarbeitungsverzeichnis (Art. 30) erstellen.
- ⚖️ **Rechtsgrundlagen** je Datenkategorie (Art. 6; Beschäftigtendaten § 26 BDSG) dokumentieren.
- ⚖️ **Aufbewahrungsfristen** definieren (steuer-/arbeitsrechtlich, z. B. GoBD 10 Jahre) und technische Löschroutinen darauf abstimmen.
- ⚖️ **Datenschutzerklärung & Impressum** mit echten Anbieterdaten füllen (aktuell neutrale Platzhalter; Build-Guard erzwingt Ersetzung). Seiten vorhanden: `/recht/datenschutz`, `/recht/impressum`.
- ⚖️ **Einwilligungen**: Cookie-Banner (`components/legal/CookieBanner`) und ggf. Google Tag Manager (in CSP erlaubt) auf tatsächliche Nutzung/Erforderlichkeit prüfen; nicht-essentielle Tags nur nach Einwilligung laden.
- ⚖️ **Signaturen der verantwortlichen Person vor Ort** (ohne eigenes Konto): Rechtsgrundlage und Informationspflicht gegenüber dieser Person klären.
- ⚖️ **AV-Verträge mit Unterauftragnehmern** (SMTP-Anbieter, Sentry, OpenRouteService) abschließen; Datenflüsse in EU/USA prüfen.
- ⚖️ **TOMs** (Art. 32) formal dokumentieren.

## 4. Vor Verkauf zu anonymisieren/entfernen (Status)

| Punkt | Status |
|---|---|
| Reale Personennamen / Entwicklerpfade | ✅ entfernt (Phase 2) |
| Hartcodierte API-Keys / Verkäufer-Projektbezug in Seeds | ✅ entfernt (Phase 2) |
| Test-Logins mit Markenbezug | ✅ auf `@schichtklar.test` (fiktiv) umgestellt |
| Reale Kundendaten in Seeds | ✅ nur fiktive Beispieldaten (`praxis@dr-mueller.de` etc.) |
| Produktive Echtdaten / DB-Backups im Repo | ✅ keine vorhanden |
| Finale Firmendaten (Impressum) | ⏳ vom Käufer zu setzen (Platzhalter aktiv) |

## 5. Betroffenenrechte – technische Abdeckung

Auskunft ✅ · Datenübertragbarkeit ✅ (JSON-Export) · Löschung ✅ · Berichtigung ✅ (Bearbeitung im Profil/Admin) · Einschränkung/Widerspruch ⚖️ organisatorisch zu regeln.
