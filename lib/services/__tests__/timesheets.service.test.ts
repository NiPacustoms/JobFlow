import { beforeEach, describe, expect, it, vi } from 'vitest';
import { timesheetService, type Timesheet } from '../timesheets';

vi.mock('@/lib/firebase', () => ({
  db: {},
  getDb: vi.fn(() => ({})),
  auth: {
    currentUser: {
      uid: 'current-user',
      getIdTokenResult: vi.fn().mockResolvedValue({ claims: { role: 'admin', companyId: 'company-1' } }),
    },
  },
}));

vi.mock('@/lib/utils/companyId', () => ({
  getCompanyIdFromAuth: vi.fn().mockResolvedValue('company-1'),
}));

vi.mock('@/lib/errors', () => {
  class ValidationError extends Error {
    code: string;
    metadata?: any;
    constructor(code: string, message: string, _context?: any, _meta?: any) {
      super(message);
      this.code = code;
    }
  }

  return {
    ValidationError,
    ErrorCode: {
      VALIDATION_INVALID_FORMAT: 'VALIDATION_INVALID_FORMAT',
      VALIDATION_OUT_OF_RANGE: 'VALIDATION_OUT_OF_RANGE',
      TIMESHEET_INVALID: 'TIMESHEET_INVALID',
      INTERNAL_ERROR: 'INTERNAL_ERROR',
    },
    createAppError: (error: unknown, code: string) => {
      const err = new Error((error as any)?.message || String(error)) as any;
      err.code = code;
      err.metadata = {};
      return err;
    },
  };
});

vi.mock('@/lib/logging', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('./offlineQueue', () => ({
  offlineQueueService: {
    addToQueue: vi.fn().mockResolvedValue('offline-id'),
  },
}));

vi.mock('firebase/firestore', () => {
  const collection = vi.fn();
  const doc = vi.fn();
  const addDoc = vi.fn();
  const updateDoc = vi.fn();
  const deleteDoc = vi.fn();
  const getDoc = vi.fn();
  const getDocs = vi.fn();
  const query = vi.fn();
  const where = vi.fn();
  const orderBy = vi.fn();
  const limit = vi.fn();
  const serverTimestamp = vi.fn(() => new Date());

  return {
    collection,
    doc,
    addDoc,
    updateDoc,
    deleteDoc,
    getDoc,
    getDocs,
    query,
    where,
    orderBy,
    limit,
    serverTimestamp,
  };
});

describe('timesheetService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('aggregateTimesheetsByUser', () => {
    it('aggregiert Stunden pro Nutzer korrekt und rundet auf zwei Nachkommastellen', async () => {
      const sheets: Timesheet[] = [
        {
          id: '1',
          userId: 'u1',
          companyId: 'c1',
          date: new Date(),
          startDate: new Date(),
          endDate: new Date(),
          startTime: '08:00',
          endTime: '16:00',
          breakMinutes: 30,
          totalHours: 7.5,
          nightHours: 2,
          weekendHours: 0,
          holidayHours: 0,
          overtimeHours: 1.25,
          regularHours: 6.25,
          status: 'approved',
          breaks: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: '2',
          userId: 'u1',
          companyId: 'c1',
          date: new Date(),
          startDate: new Date(),
          endDate: new Date(),
          startTime: '08:00',
          endTime: '12:00',
          breakMinutes: 0,
          totalHours: 4,
          nightHours: 0,
          weekendHours: 1,
          holidayHours: 0,
          overtimeHours: 0,
          regularHours: 4,
          status: 'draft',
          breaks: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const { aggregateTimesheetsByUser } = await import('../timesheets');

      const result = aggregateTimesheetsByUser(sheets);

      expect(result).toHaveLength(1);
      const agg = result[0];
      expect(agg.userId).toBe('u1');
      expect(agg.totalHours).toBeCloseTo(11.5, 2);
      expect(agg.approvedHours).toBeCloseTo(7.5, 2);
      expect(agg.overtimeHours).toBeCloseTo(1.25, 2);
      expect(agg.nightHours).toBeCloseTo(2, 2);
      expect(agg.weekendHours).toBeCloseTo(1, 2);
    });
  });

  describe('getByDateRange', () => {
    it('wirft ValidationError bei ungültigem Startdatum', async () => {
      // @ts-expect-error absichtlich ungültig
      const invalidStart = 'not-a-date';
      const end = new Date();

      await expect(
        // @ts-expect-error Test ungültiger Parameter
        timesheetService.getByDateRange('u1', invalidStart, end),
      ).rejects.toMatchObject({ code: 'VALIDATION_INVALID_FORMAT' });
    });

    it('wirft ValidationError, wenn Startdatum nach Enddatum liegt', async () => {
      const start = new Date('2025-02-02');
      const end = new Date('2025-02-01');

      await expect(
        timesheetService.getByDateRange('u1', start, end),
      ).rejects.toMatchObject({ code: 'VALIDATION_OUT_OF_RANGE' });
    });

    it('wirft ValidationError bei überlappenden Zeiterfassungen', async () => {
      const { getDocs } = await import('firebase/firestore');

      const now = new Date();
      const later = new Date(now.getTime() + 2 * 60 * 60 * 1000);

      const docs = [
        {
          id: 't1',
          data: () =>
            ({
              userId: 'u1',
              date: { toDate: () => now },
              startDate: { toDate: () => now },
              endDate: { toDate: () => later },
              startTime: '08:00',
              endTime: '10:00',
              totalHours: 2,
              status: 'approved',
            }) satisfies any,
        },
        {
          id: 't2',
          data: () =>
            ({
              userId: 'u1',
              date: { toDate: () => now },
              startDate: { toDate: () => new Date(now.getTime() + 60 * 60 * 1000) },
              endDate: { toDate: () => later },
              startTime: '09:00',
              endTime: '11:00',
              totalHours: 2,
              status: 'approved',
            }) satisfies any,
        },
      ];

      vi.mocked(getDocs).mockResolvedValue({
        docs,
      } as any);

      const start = new Date(now);
      const end = new Date(later);

      await expect(
        timesheetService.getByDateRange('u1', start, end, true),
      ).rejects.toMatchObject({ code: 'TIMESHEET_INVALID' });
    });
  });
});

