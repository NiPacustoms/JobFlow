import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkLimitStatus } from '../checkLimitStatus';
import { getStartOfWeek, getEndOfWeek } from '../calculateWeeklyHours';

const getByDateRange = vi.fn();
vi.mock('@/lib/services/timesheets', () => ({
  timesheetService: {
    getByDateRange: (...args: unknown[]) => getByDateRange(...args),
  },
}));

describe('getStartOfWeek / getEndOfWeek (ISO-Woche Mo–So)', () => {
  it('liefert für einen Mittwoch den Montag derselben Woche', () => {
    const montag = getStartOfWeek(new Date(2026, 6, 22)); // Mittwoch
    expect(montag.getDay()).toBe(1);
    expect(montag.getDate()).toBe(20);
    expect(montag.getHours()).toBe(0);
  });

  it('rechnet den Sonntag der Vorwoche zu, nicht der Folgewoche', () => {
    const montag = getStartOfWeek(new Date(2026, 6, 26)); // Sonntag
    expect(montag.getDate()).toBe(20);
  });

  it('lässt einen Montag unverändert', () => {
    const montag = getStartOfWeek(new Date(2026, 6, 20, 15, 30));
    expect(montag.getDate()).toBe(20);
    expect(montag.getHours()).toBe(0);
  });

  it('liefert den Sonntag 23:59:59 als Wochenende', () => {
    const ende = getEndOfWeek(new Date(2026, 6, 22));
    expect(ende.getDay()).toBe(0);
    expect(ende.getDate()).toBe(26);
    expect(ende.getHours()).toBe(23);
    expect(ende.getMinutes()).toBe(59);
  });

  it('funktioniert über einen Monatswechsel hinweg', () => {
    const montag = getStartOfWeek(new Date(2026, 7, 1)); // Samstag, 1. August
    expect(montag.getMonth()).toBe(6);
    expect(montag.getDate()).toBe(27);
  });
});

describe('calculateWeeklyHours', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const lade = async () => (await import('../calculateWeeklyHours')).calculateWeeklyHours;

  it('summiert Entwurf, eingereicht und genehmigt', async () => {
    getByDateRange.mockResolvedValue({
      timesheets: [
        { userId: 'u1', status: 'draft', totalHours: 8 },
        { userId: 'u1', status: 'submitted', totalHours: 7.5 },
        { userId: 'u1', status: 'approved', totalHours: 6 },
      ],
    });
    const calculateWeeklyHours = await lade();
    const result = await calculateWeeklyHours('u1', getStartOfWeek(new Date(2026, 6, 22)));
    expect(result.wochenstunden).toBe(21.5);
  });

  it('zählt abgelehnte Nachweise NICHT mit', async () => {
    getByDateRange.mockResolvedValue({
      timesheets: [
        { userId: 'u1', status: 'approved', totalHours: 8 },
        { userId: 'u1', status: 'rejected', totalHours: 12 },
      ],
    });
    const calculateWeeklyHours = await lade();
    const result = await calculateWeeklyHours('u1', getStartOfWeek(new Date(2026, 6, 22)));
    expect(result.wochenstunden).toBe(8);
  });

  it('ignoriert Nachweise anderer Mitarbeiter', async () => {
    getByDateRange.mockResolvedValue({
      timesheets: [
        { userId: 'u1', status: 'approved', totalHours: 8 },
        { userId: 'u2', status: 'approved', totalHours: 40 },
      ],
    });
    const calculateWeeklyHours = await lade();
    const result = await calculateWeeklyHours('u1', getStartOfWeek(new Date(2026, 6, 22)));
    expect(result.wochenstunden).toBe(8);
  });

  it('behandelt fehlende oder unsaubere Stundenwerte als 0', async () => {
    getByDateRange.mockResolvedValue({
      timesheets: [
        { userId: 'u1', status: 'approved', totalHours: undefined },
        { userId: 'u1', status: 'approved', totalHours: Number.NaN },
        { userId: 'u1', status: 'approved', totalHours: 5 },
      ],
    });
    const calculateWeeklyHours = await lade();
    const result = await calculateWeeklyHours('u1', getStartOfWeek(new Date(2026, 6, 22)));
    expect(result.wochenstunden).toBe(5);
  });

  it('liefert 0 Stunden statt eines Fehlers, wenn die Abfrage scheitert', async () => {
    getByDateRange.mockRejectedValue(new Error('Firestore weg'));
    const calculateWeeklyHours = await lade();
    const result = await calculateWeeklyHours('u1', getStartOfWeek(new Date(2026, 6, 22)));
    expect(result.wochenstunden).toBe(0);
    expect(result.startOfWeek).toBeInstanceOf(Date);
    expect(result.endOfWeek).toBeInstanceOf(Date);
  });

  it('rundet auf zwei Nachkommastellen', async () => {
    getByDateRange.mockResolvedValue({
      timesheets: [
        { userId: 'u1', status: 'approved', totalHours: 1.005 },
        { userId: 'u1', status: 'approved', totalHours: 2.007 },
      ],
    });
    const calculateWeeklyHours = await lade();
    const result = await calculateWeeklyHours('u1', getStartOfWeek(new Date(2026, 6, 22)));
    expect(result.wochenstunden).toBe(3.01);
  });
});

describe('checkLimitStatus', () => {
  it('meldet normal deutlich unter dem Limit', () => {
    expect(checkLimitStatus(40, 20)).toEqual({ status: 'normal', ueberschreitung: 0 });
  });

  it('warnt ab 90 Prozent des Limits', () => {
    expect(checkLimitStatus(40, 36)).toEqual({ status: 'warning', ueberschreitung: 0 });
    expect(checkLimitStatus(40, 35.9)).toEqual({ status: 'normal', ueberschreitung: 0 });
  });

  it('meldet genau am Limit noch keine Überschreitung', () => {
    expect(checkLimitStatus(40, 40)).toEqual({ status: 'warning', ueberschreitung: 0 });
  });

  it('blockiert über dem Limit und beziffert die Überschreitung', () => {
    expect(checkLimitStatus(40, 42.5)).toEqual({ status: 'blocked', ueberschreitung: 2.5 });
  });

  it('behandelt ein Limit von 0 oder kleiner als "kein Limit"', () => {
    expect(checkLimitStatus(0, 60)).toEqual({ status: 'normal', ueberschreitung: 0 });
    expect(checkLimitStatus(-5, 60)).toEqual({ status: 'normal', ueberschreitung: 0 });
  });

  it('rundet die Überschreitung auf zwei Nachkommastellen', () => {
    expect(checkLimitStatus(40, 40.567).ueberschreitung).toBe(0.57);
  });
});
