export interface Shift {
  id: string;
  title: string;
  description?: string;
  startTime: string;
  endTime: string;
  date: string;
  /** Enddatum (Folgetag) bei Overnight-Schichten, ISO yyyy-MM-dd */
  endDate?: string;
  facilityId: string;
  stationId?: string;
  companyId?: string;
  type?: string;
  requiredQualifications: string[];
  capacity: number;
  maxStaff: number;
  assignedCount?: number;
  status: 'open' | 'filled' | 'cancelled';
  assignedTo?: string[];
  notes?: string;
  timezone?: string;
  color?: string;
  shiftGroupId?: string;
  createdBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ShiftFilters {
  facilityId?: string;
  stationId?: string;
  status?: string;
  type?: string;
  startDate?: Date;
  endDate?: Date;
  dateFrom?: Date;
  dateTo?: Date;
  qualifications?: string[];
  companyId?: string;
}

export const COLLECTION_NAME = 'shifts';

export function safeToDate(value: unknown): Date {
  if (!value) return new Date();
  if (value instanceof Date) return value;
  if (typeof value === 'string') return new Date(value);
  if (typeof value === 'object' && 'toDate' in value && typeof (value as { toDate: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate();
  }
  return new Date();
}

export function safeDateToISOString(value: unknown): string {
  return safeToDate(value).toISOString().split('T')[0];
}
