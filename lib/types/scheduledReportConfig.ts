/**
 * Typen für Geplante Berichte (Scheduled Report Configs)
 * Entspricht der Cloud Function scheduledReports.ts
 */

export type ScheduledReportType = 'timesheet' | 'shifts' | 'summary';
export type ScheduledReportPeriod = 'current-month' | 'last-month' | 'current-quarter' | 'current-year';
export type ScheduledReportFormat = 'pdf' | 'excel' | 'csv';
export type ScheduledReportSchedule = 'daily' | 'monthly';

export interface ScheduledReportConfig {
  id: string;
  companyId: string;
  type: ScheduledReportType;
  period: ScheduledReportPeriod;
  format: ScheduledReportFormat;
  recipientEmails: string[];
  schedule: ScheduledReportSchedule;
  lastRunAt?: { toDate: () => Date } | null;
  createdAt: { toDate: () => Date };
  createdBy: string;
}

export interface ScheduledReportConfigCreate {
  companyId: string;
  type: ScheduledReportType;
  period: ScheduledReportPeriod;
  format: ScheduledReportFormat;
  recipientEmails: string[];
  schedule: ScheduledReportSchedule;
}

export interface ScheduledReportConfigUpdate {
  type?: ScheduledReportType;
  period?: ScheduledReportPeriod;
  format?: ScheduledReportFormat;
  recipientEmails?: string[];
  schedule?: ScheduledReportSchedule;
}
