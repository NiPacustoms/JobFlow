/**
 * Berechnet Netto-Wochenstunden (Mo–So) eines Mitarbeiters aus Timesheets.
 * Verwendet für Wochenstunden-Limit-Compliance.
 */

import { timesheetService } from '@/lib/services/timesheets';
import { logger } from '@/lib/logging';

/** Montag 00:00:00 der Woche, in der date liegt (ISO-Woche Mo–So) */
export function getStartOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  // Sonntag = 0 → Mo = 1, Sa = 6. Montag = Tag 1, also diff = day - 1 (Mo=0), Sonntag = -1
  const diff = day === 0 ? -6 : day - 1;
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Sonntag 23:59:59 derselben Woche */
export function getEndOfWeek(date: Date): Date {
  const start = getStartOfWeek(date);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
}

export interface WeeklyHoursResult {
  wochenstunden: number;
  startOfWeek: Date;
  endOfWeek: Date;
}

/**
 * Summiert totalHours aller Timesheets (Mo–So) für den Mitarbeiter.
 * approvedOnly: false, damit auch submitted/draft für aktuelle Anzeige zählen.
 * ABGELEHNTE (rejected) Nachweise zählen NICHT – sonst blockieren zurückgewiesene
 * Stunden das Wochenstunden-Limit, obwohl sie nie geleistet/anerkannt wurden.
 */
export async function calculateWeeklyHours(
  mitarbeiterId: string,
  startOfWeek: Date
): Promise<WeeklyHoursResult> {
  const endOfWeek = getEndOfWeek(startOfWeek);
  try {
    const { timesheets } = await timesheetService.getByDateRange(
      mitarbeiterId,
      startOfWeek,
      endOfWeek,
      false
    );
    const relevant = timesheets.filter(
      t => t.userId === mitarbeiterId && t.status !== 'rejected'
    );
    const sum = relevant.reduce((acc, t) => acc + (Number(t.totalHours) || 0), 0);
    const wochenstunden = Math.round(sum * 100) / 100;
    return {
      wochenstunden,
      startOfWeek,
      endOfWeek,
    };
  } catch (error) {
    logger.error('calculateWeeklyHours failed', error instanceof Error ? error : new Error(String(error)), {
      mitarbeiterId,
      startOfWeek: startOfWeek.toISOString(),
    });
    return {
      wochenstunden: 0,
      startOfWeek,
      endOfWeek,
    };
  }
}
