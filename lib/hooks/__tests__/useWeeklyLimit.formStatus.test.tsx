import React, { type ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Hooks rund um das Wochenstunden-Limit und den Status der Einsatzmitteilung.
 */

const readWeeklyLimit = vi.fn();
const writeWeeklyLimit = vi.fn();
vi.mock('@/lib/services/employees/readWeeklyLimit', () => ({
  readWeeklyLimit: (...a: unknown[]) => readWeeklyLimit(...a),
}));
vi.mock('@/lib/services/employees/writeWeeklyLimit', () => ({
  writeWeeklyLimit: (...a: unknown[]) => writeWeeklyLimit(...a),
}));

const notifyAdminsAboutFormStatus = vi.fn();
vi.mock('@/lib/services/assignments', () => ({
  assignmentService: {
    notifyAdminsAboutFormStatus: (...a: unknown[]) => notifyAdminsAboutFormStatus(...a),
  },
}));

const toastError = vi.fn();
const toastInfo = vi.fn();
const toastSuccess = vi.fn();
vi.mock('@/lib/utils/toast', () => ({
  toast: {
    error: (...a: unknown[]) => toastError(...a),
    info: (...a: unknown[]) => toastInfo(...a),
    success: (...a: unknown[]) => toastSuccess(...a),
  },
}));

import { useWeeklyLimit } from '../useWeeklyLimit';
import { useFormStatus } from '../useFormStatus';

const wrapper = ({ children }: { children: ReactNode }) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return React.createElement(QueryClientProvider, { client }, children);
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useWeeklyLimit', () => {
  it('lädt das Limit eines Mitarbeiters', async () => {
    readWeeklyLimit.mockResolvedValue({
      mitarbeiterId: 'u1',
      wochenstundenLimit: 40,
      aktuelleWochenstunden: 32,
      limitStatus: 'normal',
    });
    const { result } = renderHook(() => useWeeklyLimit('u1'), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toMatchObject({ wochenstundenLimit: 40, aktuelleWochenstunden: 32 });
    expect(readWeeklyLimit).toHaveBeenCalledWith('u1');
  });

  it('fragt ohne Mitarbeiter-ID nicht ab', async () => {
    const { result } = renderHook(() => useWeeklyLimit(undefined), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(readWeeklyLimit).not.toHaveBeenCalled();
  });

  it('meldet einen Ladefehler', async () => {
    readWeeklyLimit.mockRejectedValue(new Error('kein Zugriff'));
    const { result } = renderHook(() => useWeeklyLimit('u1'), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('speichert ein neues Limit', async () => {
    readWeeklyLimit.mockResolvedValue(null);
    writeWeeklyLimit.mockResolvedValue(undefined);
    const { result } = renderHook(() => useWeeklyLimit('u1'), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.setLimit({ mitarbeiterId: 'u1', limit: 35 });
    });
    expect(writeWeeklyLimit).toHaveBeenCalledWith('u1', 35);
  });
});

describe('useFormStatus', () => {
  const einsatz = (daten: Record<string, unknown> = {}) =>
    ({ id: 'a1', userId: 'u1', shiftId: 's1', status: 'accepted', ...daten }) as never;

  it('meldet keinen Handlungsbedarf ohne Einsatz', () => {
    const { result } = renderHook(() => useFormStatus(null));
    expect(result.current.needsAttention).toBe(false);
    expect(result.current.reason).toBeNull();
  });

  it('meldet eine abgelehnte Einsatzmitteilung', () => {
    const { result } = renderHook(() => useFormStatus(einsatz({ formStatus: 'declined' })));
    expect(result.current.reason).toBe('declined');
    expect(result.current.needsAttention).toBe(true);
  });

  it('meldet eine ausstehende Unterschrift', () => {
    const { result } = renderHook(() =>
      useFormStatus(einsatz({ formStatus: 'acknowledged', formSignedAt: undefined }))
    );
    expect(result.current.reason).toBe('not-signed');
  });

  it('meldet keinen Handlungsbedarf bei unterschriebener Mitteilung', () => {
    const { result } = renderHook(() =>
      useFormStatus(einsatz({ formStatus: 'acknowledged', formSignedAt: new Date() }))
    );
    expect(result.current.reason).toBeNull();
  });

  it('meldet keinen Handlungsbedarf ohne jede Formularangabe', () => {
    const { result } = renderHook(() => useFormStatus(einsatz()));
    expect(result.current.reason).toBeNull();
  });

  it('informiert die Verwaltung über den Handlungsbedarf', async () => {
    notifyAdminsAboutFormStatus.mockResolvedValue(undefined);
    const { result } = renderHook(() => useFormStatus(einsatz({ formStatus: 'declined' })));
    await act(async () => {
      await result.current.notifyAdmins();
    });
    expect(notifyAdminsAboutFormStatus).toHaveBeenCalledWith('a1', 'declined');
  });

  it('meldet ohne Einsatz einen Fehler statt zu senden', async () => {
    const { result } = renderHook(() => useFormStatus(null));
    await act(async () => {
      await result.current.notifyAdmins();
    });
    expect(notifyAdminsAboutFormStatus).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalled();
  });

  it('sendet nichts, wenn kein Handlungsbedarf besteht', async () => {
    const { result } = renderHook(() => useFormStatus(einsatz()));
    await act(async () => {
      await result.current.notifyAdmins();
    });
    expect(notifyAdminsAboutFormStatus).not.toHaveBeenCalled();
    expect(toastInfo).toHaveBeenCalled();
  });
});
