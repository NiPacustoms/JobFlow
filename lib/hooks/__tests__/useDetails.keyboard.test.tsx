import React, { type ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, render, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Detailseiten-Hooks (Einrichtung, Mitarbeiter) und Tastaturnavigation
 * (Barrierefreiheit).
 */

const mockUser = { id: 'admin1', companyId: 'firmaA', role: 'admin' };
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));

const getFacilityById = vi.fn();
vi.mock('@/lib/services/facilities', () => ({
  facilityService: {
    getById: (...a: unknown[]) => getFacilityById(...a),
    update: vi.fn(async () => undefined),
  },
}));

const getShiftsByFacility = vi.fn();
vi.mock('@/lib/services/shifts', () => ({
  shiftService: {
    getAll: (...a: unknown[]) => getShiftsByFacility(...a),
    getByFacility: (...a: unknown[]) => getShiftsByFacility(...a),
    getById: vi.fn(async () => null),
  },
}));

const getAssignmentsByShift = vi.fn();
const getAssignmentsByUser = vi.fn();
vi.mock('@/lib/services/assignments', () => ({
  assignmentService: {
    getByShiftId: (...a: unknown[]) => getAssignmentsByShift(...a),
    getByUserId: (...a: unknown[]) => getAssignmentsByUser(...a),
  },
}));

const getUserById = vi.fn();
vi.mock('@/lib/services/users', () => ({
  userService: {
    getById: (...a: unknown[]) => getUserById(...a),
    update: vi.fn(async () => undefined),
  },
}));

const getTimesheetsByUser = vi.fn();
vi.mock('@/lib/services/timesheets', () => ({
  timesheetService: { getByUserId: (...a: unknown[]) => getTimesheetsByUser(...a) },
}));

const getDocumentsByUser = vi.fn();
vi.mock('@/lib/services/documents', () => ({
  documentService: { getByUserId: (...a: unknown[]) => getDocumentsByUser(...a) },
}));

vi.mock('@/lib/utils/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { useFacilityDetails } from '../useFacilityDetails';
import { useEmployeeDetails } from '../useEmployeeDetails';
import { useKeyboardNavigation, useFocusManagement } from '../useKeyboardNavigation';

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) =>
  React.createElement(QueryClientProvider, { client }, children);

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  getFacilityById.mockResolvedValue({ id: 'f1', name: 'Haus Sonnenschein', companyId: 'firmaA' });
  getShiftsByFacility.mockResolvedValue([]);
  getAssignmentsByShift.mockResolvedValue([]);
  getAssignmentsByUser.mockResolvedValue([]);
  getUserById.mockResolvedValue({ id: 'u1', displayName: 'Anna Muster', role: 'nurse', active: true });
  getTimesheetsByUser.mockResolvedValue([]);
  getDocumentsByUser.mockResolvedValue([]);
});

describe('useFacilityDetails', () => {
  it('lädt Einrichtung und Schichten', async () => {
    getShiftsByFacility.mockResolvedValue([
      { id: 's1', facilityId: 'f1', date: '2026-07-20', startTime: '06:00', endTime: '14:00', status: 'open' },
    ]);
    const { result } = renderHook(() => useFacilityDetails('f1'), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.facility).toMatchObject({ id: 'f1', name: 'Haus Sonnenschein' });
    expect(result.current.shifts).toHaveLength(1);
  });

  it('lädt ohne ID nichts', async () => {
    renderHook(() => useFacilityDetails(undefined as never), { wrapper });
    await new Promise(r => setTimeout(r, 50));
    expect(getFacilityById).not.toHaveBeenCalled();
  });

  it('liefert bei einem Ladefehler null statt zu werfen', async () => {
    getFacilityById.mockRejectedValue(new Error('kein Zugriff'));
    const { result } = renderHook(() => useFacilityDetails('f1'), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.facility).toBeNull();
  });
});

describe('useEmployeeDetails', () => {
  it('lädt Mitarbeiter, Nachweise, Einsätze und Dokumente', async () => {
    getTimesheetsByUser.mockResolvedValue([{ id: 't1', userId: 'u1', totalHours: 8 }]);
    getDocumentsByUser.mockResolvedValue([{ id: 'd1', userId: 'u1', name: 'Führungszeugnis' }]);
    const { result } = renderHook(() => useEmployeeDetails('u1'), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.employee).toMatchObject({ id: 'u1', displayName: 'Anna Muster' });
    expect(result.current.timesheets).toHaveLength(1);
    expect(result.current.documents).toHaveLength(1);
  });

  it('meldet einen Ladefehler', async () => {
    getUserById.mockRejectedValue(new Error('kein Zugriff'));
    const { result } = renderHook(() => useEmployeeDetails('u1'), { wrapper });
    await waitFor(() => expect(result.current.error).toBeTruthy());
  });
});

describe('useEmployeeDetails – Auswertungen', () => {
  const nachweis = (overrides: Record<string, unknown> = {}) => ({
    id: 't1',
    userId: 'u1',
    startDate: new Date(2026, 6, 20),
    date: new Date(2026, 6, 20),
    totalHours: 8,
    nightHours: 0,
    weekendHours: 0,
    holidayHours: 0,
    status: 'approved',
    ...overrides,
  });

  const einsatz = (overrides: Record<string, unknown> = {}) => ({
    id: 'a1',
    userId: 'u1',
    shiftId: 's1',
    status: 'accepted',
    assignedAt: new Date(2026, 6, 18),
    ...overrides,
  });

  it('liefert Nullwerte ohne Nachweise und Einsätze', async () => {
    const { result } = renderHook(() => useEmployeeDetails('u1'), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.statistics).toMatchObject({
      totalHours: 0,
      totalShifts: 0,
      averageHoursPerShift: 0,
      availabilityRate: 0,
      lastActive: null,
    });
  });

  it('summiert Stunden, Schichten und die Zusagequote', async () => {
    getTimesheetsByUser.mockResolvedValue([
      nachweis({ totalHours: 8, nightHours: 6, overtimeHours: 1 }),
      nachweis({ id: 't2', totalHours: 6, weekendHours: 6, startDate: new Date(2026, 6, 25) }),
    ]);
    getAssignmentsByUser.mockResolvedValue([
      einsatz(),
      einsatz({ id: 'a2', status: 'completed' }),
      einsatz({ id: 'a3', status: 'declined' }),
      einsatz({ id: 'a4', status: 'pending' }),
    ]);

    const { result } = renderHook(() => useEmployeeDetails('u1'), { wrapper });
    await waitFor(() => expect(result.current.timesheets).toHaveLength(2));

    const statistik = result.current.statistics;
    expect(statistik.totalHours).toBe(14);
    // angenommen + abgeschlossen zählen als geleistete Schichten
    expect(statistik.totalShifts).toBe(2);
    expect(statistik.averageHoursPerShift).toBe(7);
    expect(statistik.nightHours).toBe(6);
    expect(statistik.weekendHours).toBe(6);
    expect(statistik.overtimeHours).toBe(1);
    // 1 von 4 Einsätzen angenommen
    expect(statistik.availabilityRate).toBe(25);
    expect(statistik.lastActive).toEqual(new Date(2026, 6, 25));
  });

  it('gruppiert Nachweise nach Monat', async () => {
    getTimesheetsByUser.mockResolvedValue([
      nachweis({ startDate: new Date(2026, 5, 15) }),
      nachweis({ id: 't2', startDate: new Date(2026, 6, 20) }),
      nachweis({ id: 't3', startDate: new Date(2026, 6, 25) }),
    ]);
    const { result } = renderHook(() => useEmployeeDetails('u1'), { wrapper });
    await waitFor(() => expect(result.current.timesheets).toHaveLength(3));

    expect(Object.keys(result.current.timesheetsByMonth).sort()).toEqual(['2026-06', '2026-07']);
    expect(result.current.timesheetsByMonth['2026-07']).toHaveLength(2);
  });

  it('gruppiert Dokumente und Einsätze nach Status', async () => {
    getDocumentsByUser.mockResolvedValue([
      { id: 'd1', userId: 'u1', status: 'valid' },
      { id: 'd2', userId: 'u1', status: 'expiring' },
      { id: 'd3', userId: 'u1', status: 'expired' },
      { id: 'd4', userId: 'u1', status: 'missing' },
    ]);
    getAssignmentsByUser.mockResolvedValue([
      einsatz({ id: 'a1', status: 'pending' }),
      einsatz({ id: 'a2', status: 'accepted' }),
      einsatz({ id: 'a3', status: 'declined' }),
      einsatz({ id: 'a4', status: 'completed' }),
    ]);

    const { result } = renderHook(() => useEmployeeDetails('u1'), { wrapper });
    await waitFor(() => expect(result.current.documents).toHaveLength(4));

    const nachStatus = result.current.documentsByStatus;
    expect(nachStatus.valid).toHaveLength(1);
    expect(nachStatus.expiring).toHaveLength(1);
    expect(nachStatus.expired).toHaveLength(1);
    expect(nachStatus.missing).toHaveLength(1);

    const einsaetze = result.current.assignmentsByStatus;
    expect(einsaetze.pending).toHaveLength(1);
    expect(einsaetze.accepted).toHaveLength(1);
    expect(einsaetze.declined).toHaveLength(1);
    expect(einsaetze.completed).toHaveLength(1);
  });

  it('liefert Farben, Beschriftungen und Formatierungen', async () => {
    const { result } = renderHook(() => useEmployeeDetails('u1'), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.getStatusColor('valid')).toBe('success');
    expect(result.current.getStatusColor('expiring')).toBe('warning');
    expect(result.current.getStatusColor('expired')).toBe('error');
    expect(result.current.getStatusColor('missing')).toBe('default');
    expect(result.current.getStatusColor('completed')).toBe('info');
    expect(result.current.getStatusColor('x')).toBe('default');

    expect(result.current.getStatusLabel('valid')).toBe('Gültig');
    expect(result.current.getStatusLabel('expiring')).toBe('Läuft ab');
    expect(result.current.getStatusLabel('missing')).toBe('Fehlt');
    expect(result.current.getStatusLabel('accepted')).toBe('Angenommen');
    expect(result.current.getStatusLabel('x')).toBe('Unbekannt');

    expect(result.current.formatDate(new Date(2026, 6, 20))).toBe('20.07.2026');
    expect(result.current.formatTime(new Date(2026, 6, 20, 6, 5))).toBe('06:05');
    expect(result.current.formatDateTime(new Date(2026, 6, 20, 6, 5))).toContain('20.07.2026');
  });

  it('meldet die Ladezustände der einzelnen Quellen', async () => {
    const { result } = renderHook(() => useEmployeeDetails('u1'), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isLoadingEmployee).toBe(false);
    expect(result.current.isLoadingTimesheets).toBe(false);
    expect(result.current.isLoadingAssignments).toBe(false);
    expect(result.current.isLoadingDocuments).toBe(false);
  });
});

describe('useKeyboardNavigation', () => {
  /**
   * Der Hook liefert einen Ref und hängt den keydown-Listener im Effekt an das
   * referenzierte Element – daher wird hier eine echte Komponente gerendert,
   * die den Ref an ein DOM-Element bindet.
   */
  const Testfeld = (props: Parameters<typeof useKeyboardNavigation>[0]) => {
    const ref = useKeyboardNavigation(props);
    return React.createElement('div', {
      ref: ref as React.Ref<HTMLDivElement>,
      'data-testid': 'feld',
      tabIndex: 0,
    });
  };

  let aktuelleUnmounts: Array<() => void> = [];
  afterEach(() => {
    aktuelleUnmounts.forEach(u => u());
    aktuelleUnmounts = [];
  });

  const mitElement = (optionen: Parameters<typeof useKeyboardNavigation>[0]) => {
    const { getByTestId, unmount } = render(React.createElement(Testfeld, optionen));
    aktuelleUnmounts.push(unmount);
    return { el: getByTestId('feld'), unmount };
  };

  const druecke = (el: HTMLElement, key: string, extras: KeyboardEventInit = {}) => {
    fireEvent.keyDown(el, { key, ...extras });
  };

  it('ruft die Handler für Enter und Escape auf', () => {
    const onEnter = vi.fn();
    const onEscape = vi.fn();
    const { el } = mitElement({ onEnter, onEscape });

    druecke(el, 'Enter');
    druecke(el, 'Escape');
    expect(onEnter).toHaveBeenCalledTimes(1);
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it('unterscheidet Tab und Shift+Tab', () => {
    const onTab = vi.fn();
    const onShiftTab = vi.fn();
    const { el } = mitElement({ onTab, onShiftTab });

    druecke(el, 'Tab');
    druecke(el, 'Tab', { shiftKey: true });
    expect(onTab).toHaveBeenCalledTimes(1);
    expect(onShiftTab).toHaveBeenCalledTimes(1);
  });

  it('ruft die Pfeiltasten-Handler auf', () => {
    const onArrowUp = vi.fn();
    const onArrowDown = vi.fn();
    const { el } = mitElement({ onArrowUp, onArrowDown });

    druecke(el, 'ArrowUp');
    druecke(el, 'ArrowDown');
    expect(onArrowUp).toHaveBeenCalledTimes(1);
    expect(onArrowDown).toHaveBeenCalledTimes(1);
  });

  it('ignoriert Tasten, wenn deaktiviert', () => {
    const onEnter = vi.fn();
    const { el } = mitElement({ onEnter, disabled: true });
    druecke(el, 'Enter');
    expect(onEnter).not.toHaveBeenCalled();
  });

  it('ignoriert Tastenkombinationen mit Strg/Alt/Meta', () => {
    const onEnter = vi.fn();
    const { el } = mitElement({ onEnter });
    druecke(el, 'Enter', { ctrlKey: true });
    expect(onEnter).not.toHaveBeenCalled();
  });
});

describe('useFocusManagement', () => {
  it('wandert zyklisch durch registrierte Elemente', () => {
    const { result } = renderHook(() => useFocusManagement());
    const el1 = document.createElement('button');
    const el2 = document.createElement('button');
    document.body.append(el1, el2);

    result.current.registerElement(el1);
    result.current.registerElement(el2);

    result.current.focusNext();
    expect(document.activeElement).toBe(el1);
    result.current.focusNext();
    expect(document.activeElement).toBe(el2);
    result.current.focusNext();
    expect(document.activeElement).toBe(el1); // zyklisch

    result.current.focusPrevious();
    expect(document.activeElement).toBe(el2);

    el1.remove();
    el2.remove();
  });

  it('tut ohne registrierte Elemente nichts', () => {
    const { result } = renderHook(() => useFocusManagement());
    expect(() => result.current.focusNext()).not.toThrow();
  });

  it('entfernt Elemente wieder aus der Registrierung', () => {
    const { result } = renderHook(() => useFocusManagement());
    const el = document.createElement('button');
    document.body.append(el);
    result.current.registerElement(el);
    result.current.unregisterElement(el);
    result.current.focusNext();
    expect(document.activeElement).not.toBe(el);
    el.remove();
  });
});
