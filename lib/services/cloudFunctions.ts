import { logger } from '@/lib/logging';

import { functions } from '@/lib/firebase';
import { AssignmentCandidate, AssignmentResult, DeclineAssignmentData } from '@/lib/types';
import { httpsCallable } from 'firebase/functions';

/**
 * Client-Wrapper für Cloud Functions der Schichtverwaltung
 * Bietet typisierte, benutzerfreundliche Schnittstelle zu den CFs
 */

// Helper function to get functions or throw
function getFunctionsOrThrow() {
  if (!functions) {
    throw new Error('Firebase Functions ist nicht initialisiert. Bitte überprüfe deine Firebase-Konfiguration.');
  }
  return functions;
}

// Cloud Function References - lazy initialization
const getAssignShiftCF = () => httpsCallable(getFunctionsOrThrow(), 'assignShift');
const getUnassignShiftCF = () => httpsCallable(getFunctionsOrThrow(), 'unassignShift');
const getDeclineAssignmentCF = () => httpsCallable(getFunctionsOrThrow(), 'declineAssignment');
const getRequestShiftCF = () => httpsCallable(getFunctionsOrThrow(), 'requestShift');
const getFindCandidatesCF = () => httpsCallable(getFunctionsOrThrow(), 'findCandidates');

export const cloudFunctions = {
  /**
   * Schicht einem User zuweisen
   * @param shiftId Schicht-ID
   * @param userId User-ID
   * @param isRequest Als Anfrage senden (true) oder direkt zuweisen (false)
   * @param adminOverride Admin-Override für Qualifikations-/Konfliktprüfung
   * @returns AssignmentResult
   */
  async assignShiftToUser(
    shiftId: string,
    userId: string,
    isRequest: boolean = false,
    adminOverride: boolean = false
  ): Promise<AssignmentResult> {
    try {
      const result = await getAssignShiftCF()({ shiftId, userId, isRequest, adminOverride });
      return result.data as AssignmentResult;
    } catch (error: unknown) {

      // Benutzerfreundliche Fehlermeldungen
      if ((error as { code?: string; message?: string }).code === 'functions/failed-precondition') {
        const msg = (error as { message?: string }).message || '';
        if (msg.includes('Missing qualifications')) {
          throw new Error('Der Mitarbeiter erfüllt nicht alle erforderlichen Qualifikationen');
        }
        if (msg.includes('Time conflicts')) {
          throw new Error('Zeitkonflikt: Der Mitarbeiter hat bereits eine Schicht zu dieser Zeit');
        }
        if (msg.includes('Shift is already full')) {
          throw new Error('Die Schicht ist bereits voll besetzt');
        }
      }

      if ((error as { code?: string }).code === 'functions/permission-denied') {
        throw new Error('Keine Berechtigung für diese Aktion');
      }

      if ((error as { code?: string }).code === 'functions/not-found') {
        throw new Error('Schicht oder User nicht gefunden');
      }

      if ((error as { code?: string }).code === 'functions/internal') {
        // Log the full error for debugging
        logger.error('Internal error in assignShift:', error);
        throw new Error('Ein interner Fehler ist aufgetreten. Bitte versuchen Sie es später erneut oder kontaktieren Sie den Support.');
      }

      throw new Error((error as { message?: string }).message || 'Fehler bei der Schichtzuweisung');
    }
  },

  /**
   * Schichtzuweisung zurücknehmen
   * @param assignmentId Assignment-ID
   * @param reason Grund für Rücknahme
   * @returns Erfolgsmeldung
   */
  async unassignUser(
    assignmentId: string,
    reason?: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      const result = await getUnassignShiftCF()({ assignmentId, reason });
      return result.data as { success: boolean; message: string };
    } catch (error: unknown) {

      if ((error as { code?: string }).code === 'functions/permission-denied') {
        throw new Error('Keine Berechtigung für diese Aktion');
      }

      if ((error as { code?: string }).code === 'functions/not-found') {
        throw new Error('Zuweisung nicht gefunden');
      }

      throw new Error((error as { message?: string }).message || 'Fehler beim Rücknehmen der Zuweisung');
    }
  },

  /**
   * Assignment ablehnen (mit Unterschrifts-Workflow)
   * @param data DeclineAssignmentData
   * @returns Ergebnis mit Unterschrifts-Status
   */
  async declineAssignment(data: DeclineAssignmentData): Promise<{
    success: boolean;
    message: string;
    requiresSignature: boolean;
    newStatus: string;
  }> {
    try {
      const result = await getDeclineAssignmentCF()(data);
      return result.data as {
        success: boolean; message: string; requiresSignature: boolean; newStatus: string
      };
    } catch (error: unknown) {

      if ((error as { code?: string }).code === 'functions/permission-denied') {
        throw new Error('Keine Berechtigung für diese Aktion');
      }

      if ((error as { code?: string }).code === 'functions/failed-precondition') {
        throw new Error('Assignment kann im aktuellen Status nicht abgelehnt werden');
      }

      throw new Error((error as { message?: string }).message || 'Fehler beim Ablehnen der Schicht');
    }
  },

  /**
   * Schichtanfrage senden
   * @param shiftId Schicht-ID
   * @param message Optionale Nachricht
   * @returns Ergebnis mit Warnungen
   */
  async requestShiftAssignment(
    shiftId: string,
    message?: string
  ): Promise<{
    success: boolean;
    assignmentId: string;
    message: string;
    missingQualifications?: string[];
    warning?: string;
  }> {
    try {
      const result = await getRequestShiftCF()({ shiftId, message });
      return result.data as {
        success: boolean; assignmentId: string; message: string; missingQualifications?: string[]; warning?: string
      };
    } catch (error: unknown) {

      if ((error as { code?: string; message?: string }).code === 'functions/failed-precondition') {
        const msg = (error as { message?: string }).message || '';
        if (msg.includes('already requested')) {
          throw new Error('Du hast bereits eine Anfrage für diese Schicht gesendet');
        }
        if (msg.includes('no longer available')) {
          throw new Error('Die Schicht ist nicht mehr verfügbar');
        }
      }

      throw new Error((error as { message?: string }).message || 'Fehler beim Senden der Schichtanfrage');
    }
  },

  /**
   * Verfügbare Kandidaten für eine Schicht suchen
   * @param shiftId Schicht-ID
   * @param filters Suchfilter
   * @returns Liste von Kandidaten
   */
  async findAvailableCandidates(
    shiftId: string,
    filters: {
      name?: string;
      onlyAvailable?: boolean;
      onlyQualified?: boolean;
      minScore?: number;
      limit?: number;
    } = {}
  ): Promise<{
    success: boolean;
    candidates: AssignmentCandidate[];
    totalFound: number;
    shiftInfo: { id: string; title?: string } | undefined;
  }> {
    try {
      const result = await getFindCandidatesCF()({ shiftId, filters });
      return result.data as {
        success: boolean; candidates: AssignmentCandidate[]; totalFound: number; shiftInfo: { id: string; title?: string } | undefined
      };
    } catch (error: unknown) {

      if ((error as { code?: string }).code === 'functions/permission-denied') {
        throw new Error('Keine Berechtigung für diese Aktion');
      }

      if ((error as { code?: string }).code === 'functions/not-found') {
        throw new Error('Schicht nicht gefunden');
      }

      throw new Error((error as { message?: string }).message || 'Fehler bei der Kandidatensuche');
    }
  },

  async runScheduledReportsNow(): Promise<{ success: boolean }> {
    const fn = httpsCallable(getFunctionsOrThrow(), 'runScheduledReportsNow');
    const result = await fn({});
    return result.data as { success: boolean };
  },

  async getAvailableEmployeeIdsForSlot(
    params: Record<string, unknown> & { companyId?: string; startDate?: string; startTime?: string; endTime?: string; qualification?: string },
    idToken?: string
  ): Promise<{ availableUserIds: string[] }> {
    const fn = httpsCallable<unknown, { availableUserIds?: string[]; employeeIds?: string[] }>(getFunctionsOrThrow(), 'getAvailableEmployeeIdsForSlot');
    const result = await fn(idToken ? { ...params, idToken } : params);
    const ids = result.data?.availableUserIds ?? result.data?.employeeIds ?? [];
    return { availableUserIds: ids };
  },

  async notifyFacilityForAssignment(payload: { assignmentId: string; employeeName: string; contact?: string }): Promise<{ success: boolean }> {
    const fn = httpsCallable(getFunctionsOrThrow(), 'notifyFacilityForAssignment');
    const result = await fn(payload);
    return result.data as { success: boolean };
  },

  async declineAssignmentWithSignature(payload: { assignmentId: string; reason: string; signatureDataUrl: string }): Promise<{ success: boolean }> {
    const fn = httpsCallable(getFunctionsOrThrow(), 'declineAssignmentWithSignature');
    const result = await fn(payload);
    return result.data as { success: boolean };
  },

  async createAssignmentWithMatching(
    payload: Record<string, unknown> & { facilityId: string; companyId: string; startDate: string; startTime: string; endTime: string },
    idToken: string
  ): Promise<{ assignmentId?: string }> {
    const fn = httpsCallable(getFunctionsOrThrow(), 'createAssignmentWithMatching');
    const result = await fn({ ...payload, idToken });
    return result.data as { assignmentId?: string };
  },
};

