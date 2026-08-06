import type { Shift } from './types';
import { safeToDate, safeDateToISOString } from './types';

type DocData = Record<string, unknown>;

const VALID_STATUSES: Shift['status'][] = ['open', 'filled', 'cancelled'];

/** Normalisiert Status aus Firestore: 'assigned' (alte CF) → 'filled', sonst nur open|filled|cancelled. */
function normalizeShiftStatus(value: unknown): Shift['status'] {
  const s = typeof value === 'string' ? value.toLowerCase() : '';
  if (s === 'assigned') return 'filled';
  if (VALID_STATUSES.includes(s as Shift['status'])) return s as Shift['status'];
  return 'open';
}

export function mapDocToShift(id: string, data: DocData): Shift {
  return {
    id,
    title: (data.title as string) || `${String(data.type)} - ${String(data.startTime)}`,
    facilityId: data.facilityId as string,
    stationId: data.stationId as string | undefined,
    companyId: data.companyId as string | undefined,
    date: safeDateToISOString(data.date),
    endDate: data.endDate ? safeDateToISOString(data.endDate) : undefined,
    startTime: data.startTime as string,
    endTime: data.endTime as string,
    type: data.type as string | undefined,
    requiredQualifications: (data.requiredQualifications as string[]) || [],
    capacity: (data.capacity as number) ?? 1,
    maxStaff: (data.maxStaff as number) ?? 1,
    assignedCount: (data.assignedCount as number) ?? 0,
    status: normalizeShiftStatus(data.status),
    assignedTo: (data.assignedTo as string[]) || [],
    notes: data.notes as string | undefined,
    timezone: (data.timezone as string) || 'Europe/Berlin',
    color: data.color as string | undefined,
    shiftGroupId: data.shiftGroupId as string | undefined,
    createdBy: data.createdBy as string | undefined,
    createdAt: safeToDate(data.createdAt),
    updatedAt: safeToDate(data.updatedAt),
  };
}
