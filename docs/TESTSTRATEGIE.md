# Teststrategie Schichtklar

Ziel: Die fachlich und rechtlich kritischen Teile der App sind vollständig
automatisiert abgesichert. Nicht jede Zeile Firestore-Verdrahtung braucht einen
Unit-Test – aber jede Regel, aus der sich Arbeitszeit, Entgeltrelevanz oder ein
unterschriebener Nachweis ergibt, braucht einen.

## Vier Testebenen

| Ebene | Befehl | Umfang |
| --- | --- | --- |
| Unit / Service (Client) | `npm run test:unit` | 1256 Tests, jsdom, Firestore gemockt |
| Unit (Cloud Functions) | `npm run test:functions` | 30 Tests, Node, Admin-SDK gemockt |
| Firestore-Rules | `npm run test:rules` | Mandantenisolation, Rechte-Eskalation, Timesheet-Create |
| End-to-End | `npm run test:e2e` | 34 Playwright-Tests (Mock-Auth) |
| End-to-End (Backend) | `npm run test:e2e:backend` | 108 Tests, braucht befülltes Firebase-Projekt |

`npm run test:all` führt Unit + Functions + Rules nacheinander aus.
`npm run test:unit:coverage` erzeugt zusätzlich den Abdeckungsbericht.

## Verbindliche Abdeckung der Kernlogik

In `vitest.config.ts` sind pro Datei harte Schwellen hinterlegt. Fällt eine
davon unter den Wert, schlägt der Testlauf fehl – die Abdeckung kann also nicht
unbemerkt zurückgehen.

| Modul | Anspruch |
| --- | --- |
| `lib/utils/time.ts` | 100 % – Arbeitszeit, § 4 ArbZG Pausenstaffel |
| `lib/services/arbzgValidation.ts` | 95 %+ – §§ 3, 4, 5 ArbZG |
| `lib/services/timesheets/computeNetHours.ts` | 100 % – Stundenberechnung inkl. Nachtschicht |
| `lib/services/timesheets/calculateWeeklyHours.ts` | 100 % – Wochenstunden (Mo–So) |
| `lib/services/timesheets/checkLimitStatus.ts` | 100 % – Wochenstunden-Limit |
| `lib/utils/signatureSchedule.ts` | 95 %+ – Signaturplanung § 11 AÜG |
| `lib/services/offlineQueue.ts` | 85 %+ – Idempotenz, kein Datenverlust |
| `lib/utils/shiftStatus.ts`, `format.ts`, `authz.ts`, `sanitize.ts`, `dataUrl.ts` | 100 % |
| `lib/validations/**` | 90 %+ – jede Formular-/API-Validierung |

Der globale Wert (aktuell ~72 % Statements, ~69 % Branches) ist bewusst niedriger: Er umfasst
auch reine Firestore-Verdrahtung und React-Hooks, deren Verhalten über die
E2E-Suite und die Rules-Tests geprüft wird. Er ist als Ratsche gesetzt und darf
nur nach oben angepasst werden.

Nicht in die Messung einbezogen (kein ausführbarer Code): `lib/types/**`,
`lib/theme.ts`, `lib/design-tokens.ts`, `lib/constants/**`, `lib/i18n/**`.

## Was die Tests konkret absichern

**Arbeitszeitrecht** – Pausenstaffel (0/30/45 Min), Tages- und Wochenhöchst-
arbeitszeit mit Warn- und Fehlerschwelle, 11-Stunden-Ruhezeit inklusive
Nachtschicht über Mitternacht, ISO-Wochenzuordnung.

**Stundenberechnung** – Nachtschichten, Pause länger als Arbeitszeit, ungültige
Zeitformate, negative Werte. Der Service verweigert solche Eingaben, statt
falsche Stunden zu speichern.

**Nachweiskette** – Signaturplanung, echte Teilmengen-Prüfung der Pflichttage,
Transaktionalität beim Erfassen einer Unterschrift, Trennung von
Einsatzmitteilung (`formPdfUrl`) und Stundennachweis (`pdfUrl`).

**Offline-Betrieb** – Wiederholter Sync erzeugt kein zweites Dokument
(deterministische Dokument-IDs), erschöpfte Versuche löschen keine erfasste
Arbeitszeit, während eines Syncs erfasste Zeiten gehen nicht verloren.

**Mandantentrennung** – Firestore-Rules-Tests prüfen Lese-/Schreibzugriff über
Firmengrenzen, Rechte-Eskalation über das eigene User-Dokument und die Bindung
von Timesheets an die eigene `userId`.

**Kapazität der Schichten** – Freigabe eines Platzes, keine Doppel-Freigabe bei
bereits abgelehnten Einsätzen, abgesagte Schichten bleiben abgesagt.

## Gemeinsames Mock-Gerüst

`lib/services/__tests__/helpers/firestoreHarness.ts` stellt einen konfigurierbaren
Firestore-Mock bereit (Antworten für getDocs/getDoc setzen, Schreibzugriffe und
Query-Constraints auslesen). Neue Service-Tests bauen darauf auf, statt das
Mocking je Datei zu wiederholen:

```ts
vi.mock('firebase/firestore', () => firestoreModuleMock());
harness.setDocs([{ id: 't1', data: { … } }]);
expect(harness.hatWhere('companyId', 'firmaA')).toBe(true);
```

## Regressionstests

Jeder in den Debugging-Durchgängen gefundene Fehler hat einen Test, der ihn
festnagelt – unter anderem: Seite 2 der Mitarbeiterliste, abgelehnte Nachweise
im Wochenlimit, Sonntag in `getStartOfWeek`, Feldkollision `pdfUrl`,
Signaturvollständigkeit per Längenvergleich, Verlust der Offline-Queue.
