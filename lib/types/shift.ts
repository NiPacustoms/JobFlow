/**
 * Shift Types
 */

export interface Shift {
  id: string;
  facilityId: string;
  stationId: string;
  date: Date;
  /** Enddatum (Folgetag) bei Overnight-Schichten */
  endDate?: Date;
  startTime: string;
  endTime: string;
  type: 'Frühdienst' | 'Spätdienst' | 'Nachtdienst' | 'On-call';
  requiredQualifications: string[];
  maxStaff: number;
  status: 'open' | 'filled' | 'cancelled';
  createdAt: Date;
  updatedAt: Date;
  capacity: number;
  assignedCount: number;
  tz: string;
  notes?: string;
  createdBy: string;
  companyId?: string;
  color?: string;
}

export interface ShiftFilters {
  facilityId?: string;
  stationId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  type?: Shift['type'];
  status?: Shift['status'];
}

export interface ShiftCreateForm {
  facilityId: string;
  stationId: string;
  date: Date;
  startTime: string;
  endTime: string;
  type: Shift['type'];
  capacity: number;
  requiredQualifications: string[];
  notes?: string;
  tz?: string;
}

export interface ShiftStatusChange {
  shiftId: string;
  oldStatus: Shift['status'];
  newStatus: Shift['status'];
  reason?: string;
  changedBy: string;
  changedAt: Date;
}

export interface CapacityIndicator {
  shiftId: string;
  assigned: number;
  capacity: number;
  percentage: number;
  color: 'success' | 'warning' | 'error';
}
