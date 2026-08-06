import React, { type ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Minimal Auth- und Service-Mocks – nur Infrastruktur, keine Fake-DB
const mockUser = { id: 'user-1' };

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: mockUser }),
}));

const getByUserIdTimesheets = vi.fn();
const getByUserIdTimes = vi.fn();

vi.mock('@/lib/services/timesheets', () => ({
  timesheetService: {
    getByUserId: (...args: unknown[]) => getByUserIdTimesheets(...args),
  },
}));

vi.mock('@/lib/services/times', () => ({
  timesService: {
    getByUserId: (...args: unknown[]) => getByUserIdTimes(...args),
  },
}));

const generateTimeAccountReport = vi.fn();
const exportTimeAccountReportPDF = vi.fn();
const exportTimeAccountReportExcel = vi.fn();

vi.mock('@/lib/services/reports', () => ({
  reportService: {
    generateTimeAccountReport: (...args: unknown[]) => generateTimeAccountReport(...args),
    exportTimeAccountReportPDF: (...args: unknown[]) => exportTimeAccountReportPDF(...args),
    exportTimeAccountReportExcel: (...args: unknown[]) => exportTimeAccountReportExcel(...args),
  },
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
const toastInfo = vi.fn();

vi.mock('@/lib/utils/toast', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
    info: (...args: unknown[]) => toastInfo(...args),
  },
}));

const loggerError = vi.fn();

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    error: (...args: unknown[]) => loggerError(...args),
  },
}));

import { useEmployeeReports } from '../useEmployeeReports';

function createWrapper() {
  const queryClient = new QueryClient();

  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe('useEmployeeReports', () => {
  beforeEach(() => {
    getByUserIdTimesheets.mockReset();
    getByUserIdTimes.mockReset();
    generateTimeAccountReport.mockReset();
    exportTimeAccountReportPDF.mockReset();
    exportTimeAccountReportExcel.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
    toastInfo.mockReset();
    loggerError.mockReset();
  });

  it('aggregiert Arbeitszeiten korrekt in workTimeReport', async () => {
    getByUserIdTimesheets.mockResolvedValue([
      {
        id: 'ts-1',
        userId: mockUser.id,
        totalHours: 8,
        overtimeHours: 2,
        date: new Date('2025-01-01'),
      },
      {
        id: 'ts-2',
        userId: mockUser.id,
        totalHours: 6,
        overtimeHours: 0,
        date: new Date('2025-01-02'),
      },
    ]);

    getByUserIdTimes.mockResolvedValue([]);

    const { result } = renderHook(() => useEmployeeReports(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const report = result.current.workTimeReport;

    expect(report.totalHours).toBeCloseTo(14);
    expect(report.overtimeHours).toBeCloseTo(2);
    expect(report.regularHours).toBeCloseTo(12);
    expect(report.workingDays).toBe(2);
    expect(report.arbzgCompliance.isCompliant).toBe(true);
  });

  it('exportiert den Arbeitszeit-Report als PDF direkt über die Dokumenterzeugung', async () => {
    getByUserIdTimesheets.mockResolvedValue([
      {
        id: 'ts-1',
        userId: mockUser.id,
        totalHours: 8,
        overtimeHours: 0,
        date: new Date('2025-01-01'),
      },
    ]);
    getByUserIdTimes.mockResolvedValue([]);

    const generateDocument = vi.fn(async () => ({
      url: 'https://storage.example/bericht.pdf',
      fileName: 'Zeiterfassungsbericht.pdf',
      fileSize: 1234,
      createdAt: new Date(),
    }));
    vi.doMock('@/lib/services/documentGeneration', () => ({
      documentGenerationService: { generateDocument },
    }));
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);

    const { result } = renderHook(
      () =>
        // Filters leer lassen – Hook soll selbst sinnvolle Defaults bestimmen
        useEmployeeReports(),
      {
        wrapper: createWrapper(),
      },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const url = await result.current.exportWorkTimeReport('pdf');

    expect(url).toBe('https://storage.example/bericht.pdf');
    expect(generateDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'timesheet-report',
        userId: mockUser.id,
        dateRange: expect.objectContaining({
          start: expect.any(Date),
          end: expect.any(Date),
        }),
      }),
    );
    expect(openSpy).toHaveBeenCalledWith('https://storage.example/bericht.pdf', '_blank', 'noopener');
    // Der frühere Umweg über die Berichtsverwaltung entfällt
    expect(exportTimeAccountReportPDF).not.toHaveBeenCalled();

    openSpy.mockRestore();
    vi.doUnmock('@/lib/services/documentGeneration');
  });

  it('exportiert die Nachweise als Excel über den ExportService', async () => {
    getByUserIdTimesheets.mockResolvedValue([
      {
        id: 'ts-1',
        userId: mockUser.id,
        totalHours: 8,
        breakMinutes: 30,
        startTime: '06:00',
        endTime: '14:30',
        status: 'approved',
        date: new Date('2025-01-01'),
      },
    ]);
    getByUserIdTimes.mockResolvedValue([]);

    const exportToExcel = vi.fn(async (_zeilen: unknown, o: { filename: string }) => o.filename);
    vi.doMock('@/lib/services/exportService', () => ({
      ExportService: { exportToExcel, exportToCSV: vi.fn() },
    }));

    const { result } = renderHook(() => useEmployeeReports(), { wrapper: createWrapper() });
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const datei = await result.current.exportWorkTimeReport('excel');
    expect(String(datei)).toMatch(/^arbeitszeit-bericht-\d{4}-\d{2}-\d{2}\.xls$/);
    expect(exportToExcel).toHaveBeenCalledWith(
      [expect.objectContaining({ Stunden: 8, Status: 'approved' })],
      expect.anything(),
    );
    vi.doUnmock('@/lib/services/exportService');
  });
});

