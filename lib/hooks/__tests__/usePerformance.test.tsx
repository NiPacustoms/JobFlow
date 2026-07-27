import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

/**
 * Performance-Hilfshooks: Debounce/Throttle (Suchfelder), optimierte Suche
 * über die Mitarbeiterliste und virtuelles Scrollen langer Dienstpläne.
 */

import {
  useDebouncedCallback,
  useThrottledCallback,
  useOptimizedSearch,
  useVirtualScrolling,
  useImageOptimization,
  useMemoryUsage,
  useCacheOptimization,
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

describe('useImageOptimization', () => {
  it('meldet den Ladezustand und gibt die Quelle frei', () => {
    const { result } = renderHook(() => useImageOptimization('/logo.png', { width: 200 }));
    expect(result.current.isLoading).toBe(true);

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.optimizedSrc).toBe('/logo.png');
    expect(result.current.error).toBeNull();
  });

  it('tut ohne Quelle nichts', () => {
    const { result } = renderHook(() => useImageOptimization('', {}));
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current.isLoading).toBe(true);
  });
});

describe('useMemoryUsage', () => {
  it('liefert null, wenn der Browser keine Speicherdaten meldet', () => {
    const { result } = renderHook(() => useMemoryUsage());
    expect(result.current).toBeNull();
  });

  it('berechnet die Auslastung aus den Heap-Werten', () => {
    Object.defineProperty(performance, 'memory', {
      value: { usedJSHeapSize: 25_000_000, totalJSHeapSize: 100_000_000 },
      configurable: true,
    });

    const { result, unmount } = renderHook(() => useMemoryUsage());
    expect(result.current).toEqual({
      used: 25_000_000,
      total: 100_000_000,
      percentage: 25,
    });

    // Aktualisiert sich im Intervall
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current?.percentage).toBe(25);

    unmount();
    // @ts-expect-error – Aufräumen des Stubs
    delete (performance as { memory?: unknown }).memory;
  });
});

describe('useCacheOptimization', () => {
  it('lädt die Daten und liefert sie beim zweiten Aufruf aus dem Cache', async () => {
    vi.useRealTimers();
    const laden = vi.fn(async () => ({ stunden: 8 }));
    const { result } = renderHook(() => useCacheOptimization('stunden-u1', laden));

    await waitFor(() => expect(result.current.data).toEqual({ stunden: 8 }));
    expect(result.current.isLoading).toBe(false);

    await act(async () => {
      await result.current.refetch();
    });
    // innerhalb der Frischezeit kein erneuter Abruf
    expect(laden).toHaveBeenCalledTimes(1);
    vi.useFakeTimers();
  });

  it('meldet einen Ladefehler verständlich', async () => {
    vi.useRealTimers();
    const laden = vi.fn(async () => {
      throw new Error('kein Zugriff');
    });
    const { result } = renderHook(() => useCacheOptimization('fehler', laden));

    await waitFor(() => expect(result.current.error).toBe('kein Zugriff'));
    expect(result.current.data).toBeNull();
    expect(result.current.isLoading).toBe(false);
    vi.useFakeTimers();
  });

  it('lädt nach Ablauf der Frischezeit erneut', async () => {
    vi.useRealTimers();
    const laden = vi.fn(async () => ({ stunden: 8 }));
    const { result } = renderHook(() =>
      useCacheOptimization('kurzlebig', laden, { staleTime: 0 })
    );

    await waitFor(() => expect(result.current.data).toBeTruthy());
    await act(async () => {
      await result.current.refetch();
    });
    expect(laden).toHaveBeenCalledTimes(2);
    vi.useFakeTimers();
  });
});
