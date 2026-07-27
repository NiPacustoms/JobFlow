import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

/**
 * Render- und Operationsmessung (Entwicklungshilfe): sammelt die letzten
 * Messwerte, warnt bei langsamen Renderings und bleibt im Produktionsbetrieb
 * standardmäßig still.
 */

const loggerWarn = vi.fn();
const loggerInfo = vi.fn();
vi.mock('@/lib/logging', () => ({
  logger: {
    warn: (...a: unknown[]) => loggerWarn(...a),
    info: (...a: unknown[]) => loggerInfo(...a),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { usePerformanceMonitoring, useOperationTimer } from '../usePerformanceMonitoring';

/** performance.now() deterministisch machen: jeder Aufruf springt um `schritt` ms. */
const zeitgeber = (schritt: number, start = 0) => {
  let jetzt = start;
  return vi.spyOn(performance, 'now').mockImplementation(() => {
    const wert = jetzt;
    jetzt += schritt;
    return wert;
  });
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('usePerformanceMonitoring', () => {
  it('sammelt Messwerte und rechnet Durchschnitt und Maximum', async () => {
    zeitgeber(50);
    const { result } = renderHook(() =>
      usePerformanceMonitoring({ componentName: 'Dienstplan', enabled: true })
    );

    await waitFor(() => expect(result.current.metrics.length).toBeGreaterThan(0));
    expect(result.current.metrics[0].componentName).toBe('Dienstplan');
    expect(result.current.averageRenderTime).toBeGreaterThan(0);
    expect(result.current.maxRenderTime).toBeGreaterThanOrEqual(result.current.averageRenderTime);
  });

  it('meldet langsame Renderings, wenn die Protokollierung an ist', async () => {
    zeitgeber(100);
    renderHook(() =>
      usePerformanceMonitoring({
        componentName: 'Dienstplan',
        enabled: true,
        logToConsole: true,
        threshold: 16,
      })
    );

    await waitFor(() => expect(loggerWarn).toHaveBeenCalled());
    expect(String(loggerWarn.mock.calls[0][0])).toContain('Dienstplan');
  });

  it('schweigt bei schnellen Renderings', async () => {
    zeitgeber(1);
    renderHook(() =>
      usePerformanceMonitoring({
        componentName: 'Dienstplan',
        enabled: true,
        logToConsole: true,
        threshold: 100,
      })
    );

    await new Promise(r => setTimeout(r, 20));
    expect(loggerWarn).not.toHaveBeenCalled();
  });

  it('sammelt nichts, wenn die Messung abgeschaltet ist', async () => {
    zeitgeber(100);
    const { result } = renderHook(() =>
      usePerformanceMonitoring({ componentName: 'Dienstplan', enabled: false })
    );

    await new Promise(r => setTimeout(r, 20));
    expect(result.current.metrics).toEqual([]);
    expect(result.current.averageRenderTime).toBe(0);
    expect(result.current.maxRenderTime).toBe(0);
    expect(result.current.isSlowRender).toBe(false);
  });

  it('kennzeichnet dauerhaft langsame Komponenten', async () => {
    zeitgeber(100);
    const { result } = renderHook(() =>
      usePerformanceMonitoring({ componentName: 'Dienstplan', enabled: true, threshold: 16 })
    );

    await waitFor(() => expect(result.current.isSlowRender).toBe(true));
  });

  it('behält höchstens zehn Messwerte', async () => {
    zeitgeber(20);
    const { result, rerender } = renderHook(
      ({ name }: { name: string }) =>
        usePerformanceMonitoring({ componentName: name, enabled: true }),
      { initialProps: { name: 'A0' } }
    );

    for (let i = 1; i <= 14; i++) {
      rerender({ name: `A${i}` });
      // Auf die Verarbeitung des Effekts warten
      await waitFor(() => expect(result.current.metrics.at(-1)?.componentName).toBe(`A${i}`));
    }
    expect(result.current.metrics.length).toBeLessThanOrEqual(10);
  });

  it('leert die Messwerte auf Wunsch', async () => {
    zeitgeber(20);
    const { result } = renderHook(() =>
      usePerformanceMonitoring({ componentName: 'Dienstplan', enabled: true })
    );
    await waitFor(() => expect(result.current.metrics.length).toBeGreaterThan(0));

    act(() => result.current.clearMetrics());
    await waitFor(() => expect(result.current.metrics).toEqual([]));
  });
});

describe('useOperationTimer', () => {
  it('misst die Dauer zwischen Start und Ende', async () => {
    zeitgeber(250);
    const { result } = renderHook(() => useOperationTimer('Nachweis speichern'));

    let gemessen = 0;
    act(() => {
      result.current.startTimer();
      gemessen = result.current.endTimer();
    });

    expect(gemessen).toBe(250);
    await waitFor(() => expect(result.current.duration).toBe(250));
  });

  it('protokolliert die Dauer in der Entwicklungsumgebung', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    zeitgeber(120);
    const { result } = renderHook(() => useOperationTimer('PDF erzeugen'));

    act(() => {
      result.current.startTimer();
      result.current.endTimer();
    });

    expect(loggerInfo).toHaveBeenCalledWith(expect.stringContaining('PDF erzeugen'));
  });

  it('schweigt in der Produktionsumgebung', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    zeitgeber(120);
    const { result } = renderHook(() => useOperationTimer('PDF erzeugen'));

    act(() => {
      result.current.startTimer();
      result.current.endTimer();
    });

    expect(loggerInfo).not.toHaveBeenCalled();
  });

  it('startet bei 0, solange nichts gemessen wurde', () => {
    const { result } = renderHook(() => useOperationTimer('x'));
    expect(result.current.duration).toBe(0);
  });
});
