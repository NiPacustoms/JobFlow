/**
 * Stunden-Breakdown einer Schicht: Nacht-, Samstags-, Sonntags- und
 * Feiertagsstunden.
 *
 * Definitionen (dokumentiert in docs/QA_REPORT.md):
 * - Nachtstunden: Arbeit zwischen 23:00 und 06:00 (§2 Abs. 3 ArbZG)
 * - Wochenendstunden: Arbeit an Samstagen und Sonntagen (Reporting-Bucket)
 * - Feiertagsstunden: Arbeit an bundesweiten gesetzlichen Feiertagen
 * - Überstunden: Netto-Arbeitszeit über 8 h/Tag (§3 ArbZG Regelarbeitszeit)
 * Pausen werden proportional über die Schichtdauer verteilt abgezogen.
 * Reine Funktion – keine Firebase-Abhängigkeiten (separat testbar).
 */

export interface WorkHoursBreakdown {
  totalHours: number;
  nightHours: number;
  saturdayHours: number;
  sundayHours: number;
  /** Samstag + Sonntag (Reporting-Feld `weekendHours`) */
  weekendHours: number;
  holidayHours: number;
  overtimeHours: number;
}

/** Gauß'sche Osterformel (Ostersonntag, lokale Zeit) */
function calculateEaster(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month, day);
}

function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const holidayCache = new Map<number, Set<string>>();

/** Bundesweite gesetzliche Feiertage (Date-Keys, lokale Zeit) */
export function getNationalHolidayKeys(year: number): Set<string> {
  const cached = holidayCache.get(year);
  if (cached) return cached;
  const easter = calculateEaster(year);
  const addDays = (d: Date, n: number) => {
    const r = new Date(d);
    r.setDate(r.getDate() + n);
    return r;
  };
  const keys = new Set<string>(
    [
      new Date(year, 0, 1), // Neujahr
      addDays(easter, -2), // Karfreitag
      addDays(easter, 1), // Ostermontag
      new Date(year, 4, 1), // Tag der Arbeit
      addDays(easter, 39), // Christi Himmelfahrt
      addDays(easter, 50), // Pfingstmontag (Ostersonntag + 50)
      new Date(year, 9, 3), // Tag der Deutschen Einheit
      new Date(year, 11, 25), // 1. Weihnachtsfeiertag
      new Date(year, 11, 26), // 2. Weihnachtsfeiertag
    ].map(dateKey)
  );
  holidayCache.set(year, keys);
  return keys;
}

/** Überlappung zweier Zeitfenster in Minuten */
function overlapMinutes(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): number {
  const start = Math.max(aStart.getTime(), bStart.getTime());
  const end = Math.min(aEnd.getTime(), bEnd.getTime());
  return Math.max(0, (end - start) / 60000);
}

/**
 * Zerlegt eine Schicht (Start → normalisiertes Ende, ggf. über Mitternacht)
 * in Stunden-Buckets.
 *
 * @param start       Schichtbeginn (lokale Zeit)
 * @param end         Schichtende, bereits normalisiert (end > start)
 * @param breakMinutes Pausenminuten (proportional abgezogen)
 */
export function computeWorkHoursBreakdown(
  start: Date,
  end: Date,
  breakMinutes: number
): WorkHoursBreakdown {
  const grossMinutes = (end.getTime() - start.getTime()) / 60000;
  if (!(grossMinutes > 0)) {
    return {
      totalHours: 0,
      nightHours: 0,
      saturdayHours: 0,
      sundayHours: 0,
      weekendHours: 0,
      holidayHours: 0,
      overtimeHours: 0,
    };
  }
  const breakM = Math.min(Math.max(breakMinutes || 0, 0), grossMinutes);
  const netFactor = (grossMinutes - breakM) / grossMinutes; // Pause proportional

  let nightM = 0;
  let saturdayM = 0;
  let sundayM = 0;
  let holidayM = 0;

  // Tageweise durch das Intervall gehen (max. 2 Kalendertage bei Nachtschicht)
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  while (cursor < end) {
    const dayStart = new Date(cursor);
    const dayEnd = new Date(cursor);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const dayMinutes = overlapMinutes(start, end, dayStart, dayEnd);
    if (dayMinutes > 0) {
      const dow = dayStart.getDay();
      const isHoliday = getNationalHolidayKeys(dayStart.getFullYear()).has(dateKey(dayStart));
      if (isHoliday) holidayM += dayMinutes;
      if (dow === 6) saturdayM += dayMinutes;
      if (dow === 0) {
        sundayM += dayMinutes;
      }

      // Nachtfenster dieses Kalendertags: 00:00–06:00 und 23:00–24:00
      const night1End = new Date(dayStart);
      night1End.setHours(6, 0, 0, 0);
      const night2Start = new Date(dayStart);
      night2Start.setHours(23, 0, 0, 0);
      nightM += overlapMinutes(start, end, dayStart, night1End);
      nightM += overlapMinutes(start, end, night2Start, dayEnd);
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  const toH = (m: number) => Math.round(((m * netFactor) / 60) * 100) / 100;
  const totalHours = Math.round(((grossMinutes - breakM) / 60) * 100) / 100;
  const nightHours = toH(nightM);
  const saturdayHours = toH(saturdayM);
  const sundayHours = toH(sundayM);
  const holidayHours = toH(holidayM);
  const overtimeHours = Math.max(0, Math.round((totalHours - 8) * 100) / 100);

  return {
    totalHours,
    nightHours,
    saturdayHours,
    sundayHours,
    weekendHours: Math.round((saturdayHours + sundayHours) * 100) / 100,
    holidayHours,
    overtimeHours,
  };
}
