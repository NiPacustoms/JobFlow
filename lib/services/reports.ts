import { getDb } from '@/lib/firebase';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  orderBy,
} from 'firebase/firestore';
import { firebaseStorageService } from './firebaseStorage';
import { documentGenerationService } from './documentGeneration';
import { settingsService } from './settingsService';
import { timesheetService, userService, assignmentService } from './index';
import { facilityService } from './facilities';
import { shiftService } from './shifts';
import { logger } from '@/lib/logging';
import { getCompanyIdFromAuth } from '@/lib/utils/companyId';
import { createAppError, ErrorCode, ErrorUtils } from '@/lib/errors';

const COLLECTION_NAME = 'reports';
const serviceErrorHandler = ErrorUtils.createServiceHandler('reportsService');

export interface Report {
  id: string;
  userId: string;
  companyId: string; // Mandantenzugehörigkeit
  type: 'timesheet' | 'shifts' | 'summary';
  title: string;
  description: string;
  period: string;
  format: 'pdf' | 'excel' | 'csv';
  status: 'generating' | 'completed' | 'failed';
  createdAt: Date;
  completedAt?: Date;
  fileUrl?: string;
  fileSize?: number;
  metadata?: Record<string, unknown>;
}

// Admin Report Interfaces
export interface TimeAccountReport {
  totalHours: number;
  regularHours: number;
  overtimeHours: number;
  nightHours: number;
  weekendHours: number;
  holidayHours: number;
  averageHoursPerDay: number;
  averageHoursPerWeek: number;
  workingDays: number;
  trend: 'up' | 'down' | 'flat';
  hoursByDay: Array<{
    day: string;
    totalHours: number;
    regularHours: number;
    overtimeHours: number;
  }>;
  employees: Array<{
    userId: string;
    userName: string;
    totalHours: number;
    regularHours: number;
    overtimeHours: number;
  }>;
}

export interface EmployeeStatistics {
  totalEmployees: number;
  activeEmployees: number;
  averageShiftsPerEmployee: number;
  averageHoursPerEmployee: number;
  topPerformers: number;
  employeeTrend: 'up' | 'down' | 'flat';
  employeesByFacility: Array<{
    facility: string;
    count: number;
  }>;
}

export const reportService = {
  // Get all reports for current user
  async getAll(userId?: string): Promise<Report[]> {
    try {
      const companyId = await getCompanyIdFromAuth();
      if (!companyId) {
        logger.warn('No companyId found, returning empty array');
        return [];
      }

      const reportUserId = userId || 'current-user-id'; // Use provided userId or fallback
      
      const q = query(
        collection(getDb(), COLLECTION_NAME),
        where('companyId', '==', companyId),
        where('userId', '==', reportUserId),
        orderBy('createdAt', 'desc')
      );

      const snapshot = await getDocs(q);
      const reports: Report[] = [];

      snapshot.forEach(doc => {
        const data = doc.data();
        reports.push({
          id: doc.id,
          userId: data.userId,
          companyId: data.companyId || '',
          type: data.type,
          title: data.title,
          description: data.description,
          period: data.period,
          format: data.format,
          status: data.status,
          createdAt: data.createdAt?.toDate() || new Date(),
          completedAt: data.completedAt?.toDate(),
          fileUrl: data.fileUrl,
          fileSize: data.fileSize,
          metadata: data.metadata,
        });
      });

      return reports;
    } catch (error) {
      throw error;
    }
  },

  // Generate new report
  async generateReport(data: {
    type: 'timesheet' | 'shifts' | 'summary';
    period: 'current-month' | 'last-month' | 'current-quarter' | 'current-year' | 'custom';
    format: 'pdf' | 'excel' | 'csv';
    userId?: string; // Optional userId parameter
  }): Promise<string> {
    try {
      const userId = data.userId || 'current-user-id'; // Use provided userId or fallback
      
      // Hole companyId aus dem User oder Auth
      let companyId: string | null = null;
      if (userId) {
        const userDoc = await getDoc(doc(getDb(), 'users', userId));
        if (userDoc.exists()) {
          companyId = userDoc.data().companyId || null;
        }
      }
      if (!companyId) {
        companyId = await getCompanyIdFromAuth();
      }
      if (!companyId) {
        throw createAppError(
          new Error('No companyId found for report'),
          ErrorCode.VALIDATION_REQUIRED_FIELD,
          { component: 'reportsService', action: 'generateReport' }
        );
      }
      
      const reportData = {
        type: data.type,
        title: this.getReportTitle(data.type, data.period),
        description: this.getReportDescription(data.type, data.period),
        period: data.period,
        format: data.format,
        status: 'generating',
        userId,
        companyId: companyId,
        createdAt: serverTimestamp(),
        metadata: {
          generatedBy: userId,
          parameters: data,
        },
      };

      const docRef = await addDoc(collection(getDb(), COLLECTION_NAME), reportData);
      
      // Simulate report generation
      setTimeout(async () => {
        try {
          const reportRef = doc(getDb(), COLLECTION_NAME, docRef.id);
          await updateDoc(reportRef, {
            status: 'completed',
            completedAt: serverTimestamp(),
            fileUrl: `/reports/${docRef.id}.${data.format}`,
            // fileSize wird beim tatsächlichen Upload gesetzt
          });
        } catch (error) {
          logger.error('Error updating report status', error instanceof Error ? error : new Error(String(error)));
        }
      }, 2000);

      return docRef.id;
    } catch (error) {
      const appError = serviceErrorHandler.handleFirebaseError(error, { action: 'generateReport' });
      logger.error('Error generating report', appError, { request: data });
      throw appError;
    }
  },

  // Export report
  async exportReport(reportId: string, format: 'pdf' | 'excel' | 'csv'): Promise<string> {
    try {
      const companyId = await getCompanyIdFromAuth();
      if (!companyId) {
        throw createAppError(
          new Error('No companyId found'),
          ErrorCode.AUTH_REQUIRED,
          { component: 'reportsService', action: 'exportReport' }
        );
      }

      const reportDoc = await getDoc(doc(getDb(), COLLECTION_NAME, reportId));
      if (!reportDoc.exists()) {
        throw createAppError(
          new Error('Report not found'),
          ErrorCode.FIREBASE_NOT_FOUND,
          { component: 'reportsService', action: 'exportReport', route: 'reports' }
        );
      }

      const reportData = reportDoc.data();
      // Prüfe, ob das Report zur gleichen Company gehört
      if (reportData.companyId !== companyId) {
        throw createAppError(
          new Error('Report belongs to different company'),
          ErrorCode.AUTH_INSUFFICIENT_PERMISSIONS,
          { component: 'reportsService', action: 'exportReport', companyId }
        );
      }

      let url: string;

      if (format === 'pdf') {
        // High-End-PDF mit Firmenlogo (vom Admin in Einstellungen gepflegt)
        const settings = await settingsService.getSettings();
        const reportTitle = this.getReportTitle(reportData.type, reportData.period);
        const result = await documentGenerationService.generateDocument({
          type: 'admin-report',
          adminReportData: {
            reportTitle,
            period: reportData.period,
            reportType: reportData.type,
            branding: {
              companyName: settings.companyName,
              companyLogo: settings.companyLogo,
            },
          },
        });
        url = result.url;
      } else {
        // Excel/CSV: Datei generieren und hochladen
        const content = `Report ${reportId} (${format}) generated at ${new Date().toISOString()}`;
        const file = new File([content], `report-${reportId}.${format}`, {
          type:
            format === 'excel'
              ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
              : 'text/csv',
        });
        url = await firebaseStorageService.uploadExport(
          file,
          'report',
          reportData.userId,
          {
            reportId,
            reportType: reportData.type,
            period: reportData.period,
            format,
          }
        ).then(res => res.url);
      }

      await updateDoc(doc(getDb(), COLLECTION_NAME, reportId), {
        fileUrl: url,
        status: 'completed',
        completedAt: serverTimestamp(),
      });

      return url;
    } catch (error) {
      const appError = serviceErrorHandler.handleFirebaseError(error, { action: 'exportReport', reportId, format });
      logger.error('Error exporting report', appError, { reportId, format });
      throw appError;
    }
  },

  // Delete report
  async delete(reportId: string): Promise<void> {
    try {
      const companyId = await getCompanyIdFromAuth();
      if (!companyId) {
        throw createAppError(
          new Error('No companyId found'),
          ErrorCode.AUTH_REQUIRED,
          { component: 'reportsService', action: 'delete' }
        );
      }

      const reportDoc = await getDoc(doc(getDb(), COLLECTION_NAME, reportId));
      if (!reportDoc.exists()) {
        throw createAppError(
          new Error('Report not found'),
          ErrorCode.FIREBASE_NOT_FOUND,
          { component: 'reportsService', action: 'delete', route: 'reports' }
        );
      }

      const reportData = reportDoc.data();
      // Prüfe, ob das Report zur gleichen Company gehört
      if (reportData.companyId !== companyId) {
        throw createAppError(
          new Error('Report belongs to different company'),
          ErrorCode.AUTH_INSUFFICIENT_PERMISSIONS,
          { component: 'reportsService', action: 'delete', companyId }
        );
      }

      await deleteDoc(doc(getDb(), COLLECTION_NAME, reportId));
    } catch (error) {
      const appError = serviceErrorHandler.handleFirebaseError(error, { action: 'delete', reportId });
      logger.error('Error deleting report', appError, { reportId });
      throw appError;
    }
  },

  // Get report by ID
  async getById(reportId: string): Promise<Report | null> {
    try {
      const companyId = await getCompanyIdFromAuth();
      if (!companyId) {
        logger.warn('No companyId found, returning null');
        return null;
      }

      const reportDoc = await getDoc(doc(getDb(), COLLECTION_NAME, reportId));
      if (!reportDoc.exists()) {
        return null;
      }

      const data = reportDoc.data();
      // Prüfe, ob das Report zur gleichen Company gehört
      if (data.companyId !== companyId) {
        logger.warn('Report belongs to different company, returning null');
        return null;
      }

      return {
        id: reportDoc.id,
        userId: data.userId,
        companyId: data.companyId || '',
        type: data.type,
        title: data.title,
        description: data.description,
        period: data.period,
        format: data.format,
        status: data.status,
        createdAt: data.createdAt?.toDate() || new Date(),
        completedAt: data.completedAt?.toDate(),
        fileUrl: data.fileUrl,
        fileSize: data.fileSize,
        metadata: data.metadata,
      };
    } catch (error) {
      throw error;
    }
  },

  // Get report statistics
  async getStats(): Promise<{
    total: number;
    completed: number;
    generating: number;
    failed: number;
  }> {
    try {
      const userId = 'current-user-id'; // This should come from auth context
      
      const companyId = await getCompanyIdFromAuth();
      if (!companyId) {
        return {
          total: 0,
          completed: 0,
          generating: 0,
          failed: 0,
        };
      }

      const totalQuery = query(
        collection(getDb(), COLLECTION_NAME),
        where('companyId', '==', companyId),
        where('userId', '==', userId)
      );
      const totalSnapshot = await getDocs(totalQuery);

      const completedQuery = query(
        collection(getDb(), COLLECTION_NAME),
        where('companyId', '==', companyId),
        where('userId', '==', userId),
        where('status', '==', 'completed')
      );
      const completedSnapshot = await getDocs(completedQuery);

      const generatingQuery = query(
        collection(getDb(), COLLECTION_NAME),
        where('companyId', '==', companyId),
        where('userId', '==', userId),
        where('status', '==', 'generating')
      );
      const generatingSnapshot = await getDocs(generatingQuery);

      const failedQuery = query(
        collection(getDb(), COLLECTION_NAME),
        where('companyId', '==', companyId),
        where('userId', '==', userId),
        where('status', '==', 'failed')
      );
      const failedSnapshot = await getDocs(failedQuery);

      return {
        total: totalSnapshot.size,
        completed: completedSnapshot.size,
        generating: generatingSnapshot.size,
        failed: failedSnapshot.size,
      };
    } catch (error) {
      throw error;
    }
  },

  // Helper methods
  getReportTitle(type: string, period: string): string {
    const typeNames = {
      timesheet: 'Arbeitszeit-Bericht',
      shifts: 'Schichten-Bericht',
      summary: 'Zusammenfassung',
    };

    const periodNames = {
      'current-month': 'Aktueller Monat',
      'last-month': 'Letzter Monat',
      'current-quarter': 'Aktuelles Quartal',
      'current-year': 'Aktuelles Jahr',
      'custom': 'Benutzerdefiniert',
    };

    return `${typeNames[type as keyof typeof typeNames]} - ${periodNames[period as keyof typeof periodNames]}`;
  },

  getReportDescription(type: string, _period: string): string {
    const descriptions = {
      timesheet: 'Detaillierte Übersicht über Arbeitszeiten, Pausen und Überstunden',
      shifts: 'Vollständige Liste aller abgeschlossenen Schichten mit Bewertungen',
      summary: 'Umfassende Zusammenfassung aller Arbeitsdaten und Statistiken',
    };

    return descriptions[type as keyof typeof descriptions] || 'Bericht generiert';
  },

  // Get available report types
  getAvailableTypes(): Array<{
    value: string;
    label: string;
    description: string;
  }> {
    return [
      {
        value: 'timesheet',
        label: 'Arbeitszeit',
        description: 'Detaillierte Arbeitszeit-Übersicht',
      },
      {
        value: 'shifts',
        label: 'Schichten',
        description: 'Abgeschlossene Schichten und Bewertungen',
      },
      {
        value: 'summary',
        label: 'Zusammenfassung',
        description: 'Umfassende Übersicht aller Daten',
      },
    ];
  },

  // Get available periods
  getAvailablePeriods(): Array<{
    value: string;
    label: string;
    description: string;
  }> {
    return [
      {
        value: 'current-month',
        label: 'Aktueller Monat',
        description: 'Daten für den aktuellen Monat',
      },
      {
        value: 'last-month',
        label: 'Letzter Monat',
        description: 'Daten für den vergangenen Monat',
      },
      {
        value: 'current-quarter',
        label: 'Aktuelles Quartal',
        description: 'Daten für das aktuelle Quartal',
      },
      {
        value: 'current-year',
        label: 'Aktuelles Jahr',
        description: 'Daten für das aktuelle Jahr',
      },
      {
        value: 'custom',
        label: 'Benutzerdefiniert',
        description: 'Individueller Zeitraum',
      },
    ];
  },

  // Get available formats
  getAvailableFormats(): Array<{
    value: string;
    label: string;
    description: string;
    icon: string;
  }> {
    return [
      {
        value: 'pdf',
        label: 'PDF',
        description: 'Portable Document Format',
        icon: '📄',
      },
      {
        value: 'excel',
        label: 'Excel',
        description: 'Microsoft Excel Format',
        icon: '📊',
      },
      {
        value: 'csv',
        label: 'CSV',
        description: 'Comma Separated Values',
        icon: '📈',
      },
    ];
  },

  // Admin Report Methods
  async generateTimeAccountReport(filters: { period?: string; userId?: string; startDate?: Date; endDate?: Date }): Promise<TimeAccountReport[]> {
    try {
      // Daten aus echten Timesheets laden - keine Mock-Daten mehr
      const endDate = filters.endDate || new Date();
      const startDate = filters.startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      
      // Get real timesheet data
      const timesheets = await timesheetService.getTimesheetsByDateRange(startDate, endDate, filters.userId);
      
      // Calculate totals from real data
      const totalHours = timesheets.reduce((sum, ts) => sum + ts.totalHours, 0);
      const regularHours = timesheets.reduce((sum, ts) => sum + (ts.regularHours || 0), 0);
      const overtimeHours = timesheets.reduce((sum, ts) => sum + (ts.overtimeHours || 0), 0);
      const nightHours = timesheets.reduce((sum, ts) => sum + (ts.nightHours || 0), 0);
      const weekendHours = timesheets.reduce((sum, ts) => sum + (ts.weekendHours || 0), 0);
      const holidayHours = timesheets.reduce((sum, ts) => sum + (ts.holidayHours || 0), 0);
      
      const hoursByDay = timesheets.map(timesheet => ({
        day: timesheet.date instanceof Date ? timesheet.date.toISOString().slice(0, 10) : new Date(timesheet.date).toISOString().slice(0, 10),
        totalHours: timesheet.totalHours,
        regularHours: timesheet.regularHours || 0,
        overtimeHours: timesheet.overtimeHours || 0,
      }));

      // Pro Mitarbeiter aggregieren (echte Daten, auch ohne userId-Filter)
      const perUser = new Map<string, { totalHours: number; regularHours: number; overtimeHours: number }>();
      for (const ts of timesheets) {
        const entry = perUser.get(ts.userId) || { totalHours: 0, regularHours: 0, overtimeHours: 0 };
        entry.totalHours += ts.totalHours || 0;
        entry.regularHours += ts.regularHours || 0;
        entry.overtimeHours += ts.overtimeHours || 0;
        perUser.set(ts.userId, entry);
      }
      const employees = await Promise.all(
        Array.from(perUser.entries()).map(async ([userId, sums]) => {
          let userName = '';
          try {
            userName = (await userService.getById(userId))?.displayName ?? '';
          } catch {
            // Name nicht auflösbar → leer lassen
          }
          return { userId, userName: userName || 'Unbekannt', ...sums };
        })
      );
      employees.sort((a, b) => b.totalHours - a.totalHours);

      return [{
        totalHours,
        regularHours,
        overtimeHours,
        nightHours,
        weekendHours,
        holidayHours,
        averageHoursPerDay: totalHours / daysDiff,
        averageHoursPerWeek: totalHours / (daysDiff / 7),
        workingDays: daysDiff,
        trend: 'flat' as const,
        hoursByDay,
        employees,
      }];
    } catch (error) {
      logger.error('Error generating time account report', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  },

  async generateEmployeeStatistics(filters: { period?: string; startDate?: Date; endDate?: Date }): Promise<EmployeeStatistics[]> {
    try {
      const endDate = filters.endDate || new Date();
      const startDate = filters.startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      
      // Get real data from services
      const users = await userService.getAll(1, 1000);
      const assignments = await assignmentService.getAll();
      const timesheets = await timesheetService.getTimesheetsByDateRange(startDate, endDate);
      
      // Calculate statistics from real data
      const totalEmployees = users.data.length;
      const activeEmployees = users.data.filter(u => u.active).length;
      
      // Calculate average shifts per employee
      const shiftsByEmployee = new Map<string, number>();
      (assignments.data || []).forEach(assignment => {
        const count = shiftsByEmployee.get(assignment.userId) || 0;
        shiftsByEmployee.set(assignment.userId, count + 1);
      });
      const averageShiftsPerEmployee = shiftsByEmployee.size > 0 
        ? Array.from(shiftsByEmployee.values()).reduce((sum, count) => sum + count, 0) / shiftsByEmployee.size
        : 0;
      
      // Calculate average hours per employee
      const hoursByEmployee = new Map<string, number>();
      timesheets.forEach(timesheet => {
        const hours = hoursByEmployee.get(timesheet.userId) || 0;
        hoursByEmployee.set(timesheet.userId, hours + timesheet.totalHours);
      });
      const averageHoursPerEmployee = hoursByEmployee.size > 0
        ? Array.from(hoursByEmployee.values()).reduce((sum, hours) => sum + hours, 0) / hoursByEmployee.size
        : 0;
      
      // Calculate top performers (top 20% by hours)
      const sortedByHours = Array.from(hoursByEmployee.entries())
        .sort(([,a], [,b]) => b - a);
      const topPerformers = Math.floor(sortedByHours.length * 0.2);
      
      // Group employees by facility - lade echte Daten aus der Datenbank
      const employeesByFacilityMap = new Map<string, Set<string>>(); // facilityName -> Set<userId>
      
      // Über Assignments -> Shifts -> Facilities die Zuordnung ermitteln
      for (const assignment of (assignments.data || [])) {
        try {
          const shift = await shiftService.getById(assignment.shiftId);
          if (shift && shift.facilityId) {
            const facility = await facilityService.getById(shift.facilityId);
            if (facility) {
              if (!employeesByFacilityMap.has(facility.name)) {
                employeesByFacilityMap.set(facility.name, new Set());
              }
              employeesByFacilityMap.get(facility.name)?.add(assignment.userId);
            }
          }
        } catch (error) {
          logger.warn(`Fehler beim Laden der Facility für Assignment ${assignment.id}`, {}, { error: error instanceof Error ? error.message : String(error) });
        }
      }
      
      // Konvertiere Map zu Array
      const employeesByFacility = Array.from(employeesByFacilityMap.entries())
        .map(([facility, userIds]) => ({
          facility,
          count: userIds.size,
        }))
        .sort((a, b) => b.count - a.count); // Sortiere nach Anzahl (absteigend)
      
      return [{
        totalEmployees,
        activeEmployees,
        averageShiftsPerEmployee: Math.round(averageShiftsPerEmployee),
        averageHoursPerEmployee: Math.round(averageHoursPerEmployee),
        topPerformers,
        employeeTrend: 'up' as const,
        employeesByFacility
      }];
    } catch (error) {
      logger.error('Error generating employee statistics', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  },

  async exportTimeAccountReportPDF(data: { reportId: string }, _filters: unknown): Promise<string> {
    return this.exportReport(data.reportId, 'pdf');
  },

  async exportTimeAccountReportExcel(data: { reportId: string }, _filters: unknown): Promise<string> {
    return this.exportReport(data.reportId, 'excel');
  },

  async exportTimeAccountReport(data: { reportId: string }, _filters: unknown): Promise<string> {
    return this.exportReport(data.reportId, 'csv');
  },

  async exportEmployeeStatistics(data: { reportId: string }, _filters: unknown): Promise<string> {
    return this.exportReport(data.reportId, 'csv');
  },

  async exportAllReportsPDF(data: { reportId: string }, _filters: unknown): Promise<string> {
    return this.exportReport(data.reportId, 'pdf');
  },

  async exportAllReportsExcel(data: { reportId: string }, _filters: unknown): Promise<string> {
    return this.exportReport(data.reportId, 'excel');
  },

  async exportAllReports(data: { reportId: string }, _filters: unknown): Promise<string> {
    return this.exportReport(data.reportId, 'csv');
  },

  // Upload generated report to Firebase Storage
  async uploadReport(reportId: string, file: File): Promise<string> {
    try {
      const reportDoc = await getDoc(doc(getDb(), COLLECTION_NAME, reportId));
      if (!reportDoc.exists()) {
        throw createAppError(
          new Error('Report not found'),
          ErrorCode.FIREBASE_NOT_FOUND,
          { component: 'reportsService', action: 'uploadReport', route: 'reports' }
        );
      }

      const reportData = reportDoc.data();
      
      // Upload to Firebase Storage
      const exportFile = await firebaseStorageService.uploadExport(
        file,
        'report',
        reportData.userId,
        {
          reportId,
          reportType: reportData.type,
          period: reportData.period,
        }
      );

      // Update report with file URL
      await updateDoc(doc(getDb(), COLLECTION_NAME, reportId), {
        fileUrl: exportFile.url,
        status: 'completed',
        completedAt: serverTimestamp(),
      });

      return exportFile.url;
    } catch (error) {
      const appError = serviceErrorHandler.handleFirebaseError(error, { action: 'uploadReport', reportId });
      logger.error('Error uploading report', appError, { reportId });
      
      // Update report status to failed
      try {
        await updateDoc(doc(getDb(), COLLECTION_NAME, reportId), {
          status: 'failed',
          completedAt: serverTimestamp(),
        });
      } catch (updateError) {
        logger.error('Error updating report status', updateError instanceof Error ? updateError : new Error(String(updateError)));
      }
      
      throw appError;
    }
  },
};
