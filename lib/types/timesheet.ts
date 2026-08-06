/**
 * Timesheet & TimeEntry Types
 */

export interface TimeEntry {
  id: string;
  userId: string;
  type: 'work' | 'break' | 'sick';
  date: Date;
  startDate?: Date;
  endDate?: Date;
  startTime?: string;
  endTime?: string;
  breakMinutes?: number;
  totalHours?: number;
  assignmentId?: string;
  status?: 'draft' | 'submitted' | 'approved' | 'rejected';
  notes?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface Timesheet {
  id: string;
  userId: string;
  companyId?: string;
  date: Date;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  totalHours: number;
  startDate: Date;
  endDate: Date;
  nightHours?: number;
  weekendHours?: number;
  holidayHours?: number;
  notes?: string;
  facilityId?: string;
  station?: string;
  status: 'draft' | 'submitted' | 'approved' | 'rejected';
  submittedAt?: Date;
  approvedAt?: Date;
  approvedBy?: string;
  rejectionReason?: string;
  createdAt: Date;
  updatedAt: Date;
  employeeSignatureUrl?: string;
  employeeSignedAt?: Date;
  facilitySignatureUrl?: string;
  facilitySignedAt?: Date;
  facilitySignedBy?: string;
  facilityConfirmationStatus?: 'performed' | 'aborted' | 'no-show';
  facilitySignerName?: string;
  /** Anmerkung der Einrichtung zur Tagesbestätigung. */
  facilityNotes?: string;
}

export interface TimesheetForm {
  date: Date;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  notes?: string;
  facilityId?: string;
  station?: string;
  location?: {
    latitude: number;
    longitude: number;
    address?: string;
  };
}
