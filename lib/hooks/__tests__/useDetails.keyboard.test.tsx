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
