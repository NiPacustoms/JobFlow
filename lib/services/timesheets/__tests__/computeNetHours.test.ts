import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/firebase', () => ({ db: {}, getDb: () => ({}), functions: {} }));
vi.mock('@/lib/utils/companyId', () => ({ getCompanyIdFromAuth: vi.fn() }));
vi.mock('../../offlineQueue', () => ({ offlineQueueService: { addToQueue: vi.fn() } }));

import { computeNetHours } from '../computeNetHours';

describe('computeNetHours', () => {
  it('berechnet normale Schicht mit Pause', () => {
    expect(computeNetHours('06:30', '14:30', 30)).toBeCloseTo(7.5);
  });

  it('berechnet Nachtschicht über Mitternacht', () => {
    expect(computeNetHours('21:00', '06:00', 45)).toBeCloseTo(8.25);
  });

  it('wirft, wenn die Pause die Arbeitszeit aufzehrt (verhindert negative Stunden)', () => {
    expect(() => computeNetHours('08:00', '09:00', 90)).toThrow(/Pause/);
    expect(() => computeNetHours('08:00', '09:00', 60)).toThrow(/Pause/);
  });

  it('wirft bei ungültigem Zeitformat (verhindert NaN in der Datenbank)', () => {
    expect(() => computeNetHours('8 Uhr', '16:00', 0)).toThrow(/Zeitformat/);
    expect(() => computeNetHours('08:00', '24:30', 0)).toThrow(/Zeitformat/);
  });

  it('wirft bei negativen Pausenminuten', () => {
    expect(() => computeNetHours('08:00', '16:00', -15)).toThrow(/Pausenminuten/);
  });

  it('gleiche Start-/Endzeit wird als 24h-Schicht interpretiert, nicht als 0h', () => {
    expect(computeNetHours('08:00', '08:00', 60)).toBeCloseTo(23);
  });
});
