/**
 * Assignment Types
 */

export interface Assignment {
  id: string;
  userId: string;
  shiftId: string;
  status:
    | 'requested'
    | 'accepted'
    | 'declined'
    | 'assigned'
    | 'completed'
    | 'pending-signature'
    | 'pending'
    | 'done'
    | 'published';
  assignedAt: Date;
  acceptedAt?: Date;
  declinedAt?: Date;
  completedAt?: Date;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
  decidedAt?: Date;
  declineReason?: string;
  requiresSignature?: boolean;
  signedBy?: string;
  signedAt?: Date;
  penaltyFlag?: boolean;
  employeeSignatureUrl?: string;
  employeeSignedAt?: Date;
  adminSignatureUrl?: string;
  adminSignedAt?: Date;
  adminSignerName?: string;
  relievingSignatures?: Array<{
    date: string;
    signerName: string;
    signerRole?: string;
    signatureUrl: string;
    signedAt: Date;
    timesheetId?: string;
    verifiedTimes?: {
      startTime: string;
      endTime: string;
      breakMinutes: number;
      totalHours: number;
    };
  }>;
  signatureSchedule?: {
    requiredDates: Date[];
    collectedDates: string[];
    nextRequiredDate?: Date;
  };
  pdfGenerated?: boolean;
  pdfGeneratedAt?: Date;
  pdfUrl?: string;
  /**
   * Einsatzmitteilung (§ 11 AÜG) aus dem Mitarbeiter-Formular. BEWUSST getrennt
   * von pdfUrl/pdfGenerated: Diese Felder steuern den Stundennachweis-Lauf
   * (Signatur-PDF + Mailversand) und dürfen vom Formular nicht belegt werden.
   */
  formPdfUrl?: string;
  formPdfGeneratedAt?: Date;
  pdfSentTo?: {
    employee: boolean;
    admin: boolean;
    facility: boolean;
  };
  companyId?: string;
}

export interface AssignmentFilters {
  userId?: string;
  shiftId?: string;
  status?: Assignment['status'];
  dateFrom?: Date;
  dateTo?: Date;
}

export interface AssignmentCandidate {
  userId: string;
  displayName: string;
  qualifications: string[];
  hasConflict: boolean;
  conflictDetails?: string;
  score: number;
  stationExperience?: number;
}

export interface TimeConflict {
  assignmentId: string;
  shiftId: string;
  conflictStart: Date;
  conflictEnd: Date;
  facilityName: string;
  stationName: string;
}

export interface AssignmentResult {
  success: boolean;
  assignmentId?: string;
  message: string;
  conflicts?: TimeConflict[];
  missingQualifications?: string[];
}

export interface DeclineAssignmentData {
  assignmentId: string;
  declineType: 'nurse-initiated' | 'admin-initiated';
  declineReason?: string;
  adminSignature?: string;
}
