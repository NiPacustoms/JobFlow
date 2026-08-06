/**
 * Kapazitätsrechnung einer Schicht beim Freiwerden eines Platzes.
 *
 * Zuvor stand diese Logik doppelt in unassignShift.ts und declineAssignment.ts.
 * Zwei Kopien derselben Regel driften auseinander – gerade hier, wo ein Fehler
 * dazu führt, dass eine Schicht dauerhaft als "besetzt" gilt und nicht mehr neu
 * vergeben werden kann.
 */

/** Status, die tatsächlich einen Platz auf der Schicht belegen. */
export const CAPACITY_CONSUMING_STATUSES = ['assigned', 'accepted', 'pending'] as const;

export type ShiftStatus = 'open' | 'filled' | 'cancelled';

export interface ShiftCapacityInput {
  /** Aktuell belegte Plätze (fehlend = 0). */
  assignedCount?: number;
  /** Plätze insgesamt (fehlend = 1). */
  capacity?: number;
  /** Aktueller Status der Schicht. */
  status?: string;
}

export interface ShiftCapacityResult {
  assignedCount: number;
  status: ShiftStatus;
}

/** true, wenn ein Assignment in diesem Status einen Platz belegt. */
export function consumesCapacity(assignmentStatus: string | undefined): boolean {
  return CAPACITY_CONSUMING_STATUSES.includes(
    assignmentStatus as (typeof CAPACITY_CONSUMING_STATUSES)[number]
  );
}

/**
 * Neuer Zählerstand und Status, wenn ein Assignment die Schicht verlässt.
 *
 * - 'requested' hat nie einen Platz belegt → Zähler bleibt unverändert.
 * - Eine abgesagte Schicht bleibt abgesagt.
 * - Der Zähler wird nie negativ.
 */
export function releaseShiftCapacity(
  shift: ShiftCapacityInput,
  assignmentStatus: string | undefined
): ShiftCapacityResult {
  const capacity = shift.capacity || 1;
  const current = shift.assignedCount || 0;
  const assignedCount = consumesCapacity(assignmentStatus) ? Math.max(0, current - 1) : current;
  const status: ShiftStatus =
    shift.status === 'cancelled' ? 'cancelled' : assignedCount >= capacity ? 'filled' : 'open';
  return { assignedCount, status };
}
