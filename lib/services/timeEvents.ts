/**
 * Stempel-Ereignisse der Zeiterfassung: append-only Audit-Trail.
 *
 * Jede Aktion (Einstempeln, Pause, Ausstempeln, manuelle Korrektur) wird als
 * unveränderliches Ereignis unter timesheets/{id}/events protokolliert.
 * Die Firestore-Rules verbieten Update/Delete – der Verlauf ist damit
 * revisionssicher (GoBD-Logik). Die abgeleiteten Felder am Timesheet
 * (startTime, endTime, breakMinutes) bleiben wie bisher; die Ereignisse
 * sind die Beweisschicht darüber.
 */
import { db, getDb } from '@/lib/firebase';
import {
  Unsubscribe,
  addDoc,
  collection,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from 'firebase/firestore';
import { logger } from '@/lib/logging';

export type TimeEventType = 'clockIn' | 'pauseStart' | 'pauseEnd' | 'clockOut' | 'correction';

export interface TimeEventCorrection {
  field: 'startTime' | 'endTime' | 'breakMinutes' | 'notes';
  from: string | number;
  to: string | number;
}

export interface TimeEvent {
  id: string;
  type: TimeEventType;
  /** Uhrzeit des Stempels (HH:mm, lokale Zeit des Geräts) */
  at: string;
  /** Wer gestempelt hat (uid) */
  by: string;
  note?: string;
  corrections?: TimeEventCorrection[];
  createdAt: Date;
}

const EVENT_LABELS: Record<TimeEventType, string> = {
  clockIn: 'Eingestempelt',
  pauseStart: 'Pause gestartet',
  pauseEnd: 'Pause beendet',
  clockOut: 'Ausgestempelt',
  correction: 'Korrektur',
};

export function timeEventLabel(type: TimeEventType): string {
  return EVENT_LABELS[type] || type;
}

/**
 * Ereignis protokollieren. Best-effort: Fehler werden geloggt, aber nicht
 * geworfen – der Haupt-Workflow (Zeiterfassung) darf daran nie scheitern.
 */
export async function recordTimeEvent(
  timesheetId: string,
  input: {
    type: TimeEventType;
    by: string;
    at?: string;
    note?: string;
    corrections?: TimeEventCorrection[];
  }
): Promise<void> {
  if (!db) return;
  // Offline-Queue-IDs ('offline_…') sind keine echten Firestore-Dokumente –
  // Events darunter würden beim Sync an den Rules scheitern und verloren gehen.
  if (!timesheetId || timesheetId.startsWith('offline_')) return;
  try {
    await addDoc(collection(getDb(), 'timesheets', timesheetId, 'events'), {
      type: input.type,
      at: input.at || new Date().toTimeString().slice(0, 5),
      by: input.by,
      ...(input.note ? { note: input.note } : {}),
      ...(input.corrections && input.corrections.length > 0 ? { corrections: input.corrections } : {}),
      createdAt: serverTimestamp(),
    });
  } catch (e) {
    logger.warn('timeEvents: Ereignis konnte nicht protokolliert werden', {}, {
      timesheetId,
      type: input.type,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/** Verlauf eines Timesheets in Echtzeit (chronologisch). */
export function listenToTimeEvents(
  timesheetId: string,
  callback: (events: TimeEvent[]) => void
): Unsubscribe {
  const q = query(
    collection(getDb(), 'timesheets', timesheetId, 'events'),
    orderBy('createdAt', 'asc')
  );
  return onSnapshot(
    q,
    snapshot => {
      const events: TimeEvent[] = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        events.push({
          id: doc.id,
          type: data.type,
          at: data.at || '',
          by: data.by,
          note: data.note,
          corrections: data.corrections,
          createdAt: data.createdAt?.toDate() || new Date(),
        });
      });
      callback(events);
    },
    err => {
      logger.warn('timeEvents: Verlauf konnte nicht geladen werden', {}, { timesheetId, error: err.message });
      callback([]);
    }
  );
}

/** Diff zweier Timesheet-Stände als Korrektur-Einträge (für das Formular). */
export function buildCorrections(
  before: { startTime?: string; endTime?: string; breakMinutes?: number },
  after: { startTime?: string; endTime?: string; breakMinutes?: number }
): TimeEventCorrection[] {
  const corrections: TimeEventCorrection[] = [];
  if (before.startTime !== after.startTime && after.startTime !== undefined) {
    corrections.push({ field: 'startTime', from: before.startTime ?? '–', to: after.startTime });
  }
  if (before.endTime !== after.endTime && after.endTime !== undefined) {
    corrections.push({ field: 'endTime', from: before.endTime ?? '–', to: after.endTime });
  }
  if ((before.breakMinutes ?? 0) !== (after.breakMinutes ?? 0) && after.breakMinutes !== undefined) {
    corrections.push({ field: 'breakMinutes', from: before.breakMinutes ?? 0, to: after.breakMinutes });
  }
  return corrections;
}
