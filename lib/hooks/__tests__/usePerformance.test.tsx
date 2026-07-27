import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/**
 * Performance-Hilfshooks: Debounce/Throttle (Suchfelder), optimierte Suche
 * über die Mitarbeiterliste und virtuelles Scrollen langer Dienstpläne.
 */

import {
  useDebouncedCallback,
  useThrottledCallback,
  useOptimizedSearch,
  useVirtualScrolling,
} from '../usePerformance';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useDebouncedCallback', () => {
  it('bündelt schnelle Aufrufe zu einem einzigen', () => {
    const fn = vi.fn();
    const { result } = renderHook(() => useDebouncedCallback(fn, 300));

    act(() => {
      result.current('a');
      result.current('b');
      result.current('c');
    });
    expect(fn).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('c');
  });

  it('startet die Wartezeit bei jedem Aufruf neu', () => {
    const fn = vi.fn();
    const { result } = renderHook(() => useDebouncedCallback(fn, 300));

    act(() => {
      result.current('a');
      vi.advanceTimersByTime(200);
      result.current('b');
      vi.advanceTimersByTime(200);
    });
    expect(fn).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('useThrottledCallback', () => {
  it('führt den ersten Aufruf sofort aus und drosselt weitere', () => {
    const fn = vi.fn();
    const { result } = renderHook(() => useThrottledCallback(fn, 100));

    act(() => {
      result.current('a');
      result.current('b');
      result.current('c');
    });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('a');

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(fn).toHaveBeenCalledTimes(2); // nachlaufender Aufruf
  });
});

describe('useOptimizedSearch', () => {
  const mitarbeiter = [
    { name: 'Anna Muster', stunden: 32 },
    { name: 'Bea Beispiel', stunden: 40 },
    { name: 'Carla Test', stunden: 20 },
  ];

  it('liefert ohne Suchbegriff alle Einträge', async () => {
    const { result } = renderHook(() =>
      useOptimizedSearch(mitarbeiter, '', ['name'], 0)
    );
    act(() => {
      vi.advanceTimersByTime(10);
    });
    expect(result.current.filteredData).toHaveLength(3);
  });

  it('filtert nach Textfeldern ohne Beachtung der Groß-/Kleinschreibung', async () => {
    const { result, rerender } = renderHook(
      ({ term }: { term: string }) => useOptimizedSearch(mitarbeiter, term, ['name'], 0),
      { initialProps: { term: '' } }
    );
    rerender({ term: 'anna' });
    act(() => {
      vi.advanceTimersByTime(10);
    });
    expect(result.current.filteredData).toHaveLength(1);
    expect(result.current.filteredData[0].name).toBe('Anna Muster');
  });

  it('durchsucht auch Zahlenfelder', async () => {
    const { result, rerender } = renderHook(
      ({ term }: { term: string }) => useOptimizedSearch(mitarbeiter, term, ['stunden'], 0),
      { initialProps: { term: '' } }
    );
    rerender({ term: '40' });
    act(() => {
      vi.advanceTimersByTime(10);
    });
    expect(result.current.filteredData).toHaveLength(1);
    expect(result.current.filteredData[0].name).toBe('Bea Beispiel');
  });

  it('liefert eine leere Liste ohne Treffer', async () => {
    const { result, rerender } = renderHook(
      ({ term }: { term: string }) => useOptimizedSearch(mitarbeiter, term, ['name'], 0),
      { initialProps: { term: '' } }
    );
    rerender({ term: 'xyz-unbekannt' });
    act(() => {
      vi.advanceTimersByTime(10);
    });
    expect(result.current.filteredData).toHaveLength(0);
  });
});

describe('useVirtualScrolling', () => {
  const daten = Array.from({ length: 100 }, (_, i) => `Zeile ${i}`);

  it('zeigt nur die sichtbaren Zeilen', () => {
    const { result } = renderHook(() => useVirtualScrolling(40, 400, daten));
    // 400 / 40 = 10 sichtbar + 1 Puffer
    expect(result.current.visibleItems.length).toBeLessThanOrEqual(11);
    expect(result.current.visibleItems[0]).toBe('Zeile 0');
    expect(result.current.totalHeight).toBe(4000);
    expect(result.current.offsetY).toBe(0);
  });

  it('kommt mit einer leeren Liste zurecht', () => {
    const { result } = renderHook(() => useVirtualScrolling(40, 400, []));
    expect(result.current.visibleItems).toEqual([]);
    expect(result.current.totalHeight).toBe(0);
  });

  it('verschiebt den Ausschnitt beim Scrollen', () => {
    const { result } = renderHook(() => useVirtualScrolling(40, 400, daten));
    const container = document.createElement('div');
    document.body.append(container);

    act(() => {
      result.current.setContainerRef(container);
    });
    act(() => {
      Object.defineProperty(container, 'scrollTop', { value: 800, configurable: true });
      container.dispatchEvent(new Event('scroll'));
      vi.advanceTimersByTime(20);
    });

    expect(result.current.offsetY).toBe(800);
    expect(result.current.visibleItems[0]).toBe('Zeile 20');
    container.remove();
  });
});
