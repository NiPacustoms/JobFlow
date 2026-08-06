// Export all services
export { authService } from './authService';
export { assignmentService } from './assignments';
export {
  buildAssignmentCollectionPdf,
  downloadCollectionPdf,
  type AssignmentForCollection,
  type CollectionPdfOptions,
} from './assignmentCollectionPdf';
export { cloudFunctions } from './cloudFunctions';
export { documentTypeService } from './documentTypes';
export { documentService } from './documents';
export { facilityService } from './facilities';
export { facilityHoursService } from './facilityHours';
export { notificationService } from './notifications';
export { reportService } from './reports';
export { shiftService } from './shifts';
export { timesheetService, aggregateTimesheetsByUser } from './timesheets';
export { userService } from './users';
export { timesService } from './times';
export { employeeFacilitiesService } from './employeeFacilities';
export { adminSettingsService } from './adminSettings';
export { templateService } from './templateService';

// Re-export types for convenience
export type {
  Assignment,
  AssignmentFilters,
  Document,
  DocumentFilters,
  DocumentUploadForm,
  Facility,
  PaginatedResponse,
  Shift,
  ShiftFilters,
  Timesheet,
  TimesheetForm,
  User,
  UserUpdateForm,
} from '../types';

