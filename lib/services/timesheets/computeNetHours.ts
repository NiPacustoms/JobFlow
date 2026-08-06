/**
 * Netto-Arbeitszeit aus HH:MM-Zeiten.
 *
 * Einzige Quelle der Wahrheit für die Stundenberechnung im Client. Vorher gab es
 * zwei Varianten: eine validierte in lib/services/timesheets/write.ts (die durch
 * die Datei lib/services/timesheets.ts vollständig verschattet und damit tot war)
 * und eine ungeprüfte im Monolithen, die negative oder NaN-Stunden in die
 * Datenbank schreiben konnte.
 */

const TIME_PATTERN = /^([01]?\d|2[0-3]):[0-5]\d$/;

/**
 * Berechnet Netto-Arbeitsstunden (Nachtschicht über Mitternacht wird erkannt)
 * und validiert die Eingaben. Wirft bei unplausiblen Werten.
 */
export function computeNetHours(startTime: string, endTime: string, breakMinutes: number): number {
  if (!TIME_PATTERN.test(startTime) || !TIME_PATTERN.test(endTime)) {
    throw new Error('Ungültiges Zeitformat – erwartet HH:MM (z. B. 06:30).');
  }
  if (!Number.isFinite(breakMinutes) || breakMinutes < 0) {
    throw new Error('Pausenminuten müssen eine Zahl ≥ 0 sein.');
  }
  const start = new Date(`2000-01-01T${startTime}`);
  const end = new Date(`2000-01-01T${endTime}`);
  let totalMinutes = (end.getTime() - start.getTime()) / (1000 * 60);
  if (totalMinutes <= 0) totalMinutes += 24 * 60; // Nachtschicht über Mitternacht
  if (breakMinutes >= totalMinutes) {
    throw new Error(
      `Pause (${breakMinutes} Min) ist länger als die Arbeitszeit (${totalMinutes} Min) – bitte Zeiten prüfen.`
    );
  }
  return Math.round(((totalMinutes - breakMinutes) / 60) * 100) / 100;
}
