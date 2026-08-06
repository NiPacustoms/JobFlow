import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

import { useRealtimeUpdates } from '../useRealtimeUpdates';

const invalidateQueries = vi.fn();

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: (...args: unknown[]) => invalidateQueries(...args),
  }),
}));

const loggerDebug = vi.fn();
const loggerWarn = vi.fn();
const loggerError = vi.fn();

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    debug: (...args: unknown[]) => loggerDebug(...args),
    warn: (...args: unknown[]) => loggerWarn(...args),
    error: (...args: unknown[]) => loggerError(...args),
  },
}));

let currentUser: { id: string; companyId?: string } | null = null;

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: currentUser }),
}));

const onSnapshotMock = vi.fn();

vi.mock('firebase/firestore', () => {
  const collection = vi.fn();
  const query = vi.fn();
  const where = vi.fn();

  return {
    collection,
    query,
    where,
    onSnapshot: (...args: unknown[]) => onSnapshotMock(...args),
  };
});

vi.mock('@/lib/firebase', () => ({
  db: {}, // als „initialisiert“ behandeln
}));

describe('useRealtimeUpdates', () => {
  beforeEach(() => {
    invalidateQueries.mockReset();
    loggerDebug.mockReset();
    loggerWarn.mockReset();
    loggerError.mockReset();
    onSnapshotMock.mockReset();
    currentUser = null;
  });

  it('registriert keine Listener, wenn kein User vorhanden ist', async () => {
    currentUser = null;

    const { result } = renderHook(() => useRealtimeUpdates());

    await waitFor(() => {
      expect(result.current.isConnected).toBe(false);
    });

    expect(onSnapshotMock).not.toHaveBeenCalled();
    expect(invalidateQueries).not.toHaveBeenCalled();
  });

  it('setzt Listener für Assignments und Notifications und invalidiert Queries bei Updates', async () => {
    currentUser = { id: 'user-1', companyId: 'company-1' };

    // Mit companyId wired der Hook 4 Listener: shifts, timesheets, assignments, notifications
    const unsubs = [vi.fn(), vi.fn(), vi.fn(), vi.fn()];
    let call = 0;
    onSnapshotMock.mockImplementation((_q, onNext) => {
      const idx = call++;
      onNext({ size: idx + 1 });
      return unsubs[idx];
    });

    const { result, unmount } = renderHook(() => useRealtimeUpdates());

    await waitFor(() => {
      expect(result.current.isConnected).toBe(true);
    });

    // Shifts-Listener invalidiert 'shifts' und 'admin'
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['shifts'] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['admin'] });

    // Assignments-Listener invalidiert 'assignments' und 'dashboard'
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['assignments'] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['dashboard'] });

    // Notifications-Listener invalidiert 'notifications'
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['notifications'] });

    // Beim Unmount werden alle Listener korrekt bereinigt
    unmount();

    for (const unsub of unsubs) {
      expect(unsub).toHaveBeenCalledTimes(1);
    }
  });

  it('registriert ohne companyId nur die nutzerbezogenen Listener', async () => {
    currentUser = { id: 'user-1' };
    const unsubs = [vi.fn(), vi.fn()];
    let call = 0;
    onSnapshotMock.mockImplementation((_q, onNext) => {
      const idx = call++;
      onNext({ size: 0 });
      return unsubs[idx];
    });

    const { unmount } = renderHook(() => useRealtimeUpdates());
    await waitFor(() => expect(onSnapshotMock).toHaveBeenCalledTimes(2));

    // Ohne companyId dürfen Schichten und Nachweise nicht abonniert werden
    expect(invalidateQueries).not.toHaveBeenCalledWith({ queryKey: ['shifts'] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['assignments'] });
    unmount();
  });

  it('schweigt bei erwarteten Berechtigungsfehlern der Listener', async () => {
    currentUser = { id: 'user-1', companyId: 'company-1' };
    onSnapshotMock.mockImplementation((_q, _onNext, onError) => {
      onError({ code: 'permission-denied', message: 'Missing permission' });
      return vi.fn();
    });

    renderHook(() => useRealtimeUpdates());
    await waitFor(() => expect(onSnapshotMock).toHaveBeenCalled());
    expect(loggerError).not.toHaveBeenCalled();
  });

  it('protokolliert unerwartete Listener-Fehler', async () => {
    currentUser = { id: 'user-1', companyId: 'company-1' };
    onSnapshotMock.mockImplementation((_q, _onNext, onError) => {
      onError({ code: 'unavailable', message: 'Netzwerk weg' });
      return vi.fn();
    });

    renderHook(() => useRealtimeUpdates());
    await waitFor(() => expect(loggerError).toHaveBeenCalled());
  });

  it('übersteht Fehler beim Einrichten eines Listeners', async () => {
    currentUser = { id: 'user-1', companyId: 'company-1' };
    let call = 0;
    onSnapshotMock.mockImplementation((_q, onNext) => {
      call += 1;
      // Der erste Listener (Schichten) scheitert beim Aufsetzen
      if (call === 1) throw new Error('Query ungültig');
      onNext({ size: 1 });
      return vi.fn();
    });

    renderHook(() => useRealtimeUpdates());
    // Die übrigen Listener kommen trotzdem zustande
    await waitFor(() => expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['assignments'] }));
  });

  it('unterdrückt harmlose Verbindungsfehler beim Aufräumen', async () => {
    currentUser = { id: 'user-1', companyId: 'company-1' };
    onSnapshotMock.mockImplementation((_q, onNext) => {
      onNext({ size: 1 });
      return () => {
        throw new Error('400 Bad Request: WebChannel terminate');
      };
    });

    const { unmount } = renderHook(() => useRealtimeUpdates());
    await waitFor(() => expect(onSnapshotMock).toHaveBeenCalled());

    unmount();
    expect(loggerWarn).not.toHaveBeenCalled();
  });

  it('meldet unerwartete Fehler beim Aufräumen', async () => {
    currentUser = { id: 'user-1', companyId: 'company-1' };
    onSnapshotMock.mockImplementation((_q, onNext) => {
      onNext({ size: 1 });
      return () => {
        throw new Error('unerwartetes Problem');
      };
    });

    const { unmount } = renderHook(() => useRealtimeUpdates());
    await waitFor(() => expect(onSnapshotMock).toHaveBeenCalled());

    unmount();
    expect(loggerWarn).toHaveBeenCalled();
  });
});
