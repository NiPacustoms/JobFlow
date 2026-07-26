import { describe, it, expect, vi } from 'vitest';

/**
 * Tests der serverseitigen Wochenstunden-Logik.
 * Regression: getStartOfWeek verschob Sonntage sechs Tage VORWÄRTS – Sonntags-
 * schichten landeten in der Folgewoche und das Limit blockierte sonntags nie.
 */

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({ collection: () => ({}) }),
  FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' },
}));

const triggerBuilder = {
  region: () => triggerBuilder,
  firestore: { document: () => ({ onWrite: (fn: unknown) => fn }) },
};

vi.mock('firebase-functions/v1', () => ({
  ...triggerBuilder,
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  default: triggerBuilder,
}));

const lade = async () => await import('../src/weeklyLimitOnTimesheetWrite');

describe('getStartOfWeek (Cloud Function)', () => {
  it('liefert für einen Mittwoch den Montag derselben Woche', async () => {
    const { getStartOfWeek } = await lade();
    const montag = getStartOfWeek(new Date(2026, 6, 22));
    expect(montag.getDay()).toBe(1);
    expect(montag.getDate()).toBe(20);
    expect(montag.getHours()).toBe(0);
  });

  it('rechnet den Sonntag der laufenden Woche zu, nicht der Folgewoche', async () => {
    const { getStartOfWeek } = await lade();
    const montag = getStartOfWeek(new Date(2026, 6, 26)); // Sonntag
    expect(montag.getMonth()).toBe(6);
    expect(montag.getDate()).toBe(20);
  });

  it('lässt einen Montag auf sich selbst zeigen', async () => {
    const { getStartOfWeek } = await lade();
    const montag = getStartOfWeek(new Date(2026, 6, 20, 23, 59));
    expect(montag.getDate()).toBe(20);
    expect(montag.getHours()).toBe(0);
  });

  it('arbeitet über den Monatswechsel hinweg korrekt', async () => {
    const { getStartOfWeek } = await lade();
    const montag = getStartOfWeek(new Date(2026, 7, 2)); // Sonntag, 2. August
    expect(montag.getMonth()).toBe(6);
    expect(montag.getDate()).toBe(27);
  });
});

describe('getEndOfWeek (Cloud Function)', () => {
  it('liefert den Sonntag 23:59:59 derselben Woche', async () => {
    const { getEndOfWeek } = await lade();
    const ende = getEndOfWeek(new Date(2026, 6, 22));
    expect(ende.getDay()).toBe(0);
    expect(ende.getDate()).toBe(26);
    expect(ende.getHours()).toBe(23);
    expect(ende.getMinutes()).toBe(59);
  });

  it('umschließt einen Sonntag selbst', async () => {
    const { getStartOfWeek, getEndOfWeek } = await lade();
    const sonntag = new Date(2026, 6, 26, 12, 0);
    expect(getStartOfWeek(sonntag).getTime()).toBeLessThanOrEqual(sonntag.getTime());
    expect(getEndOfWeek(sonntag).getTime()).toBeGreaterThanOrEqual(sonntag.getTime());
  });
});

describe('computeStatus (Wochenstunden-Limit)', () => {
  it('meldet normal deutlich unter dem Limit', async () => {
    const { computeStatus } = await lade();
    expect(computeStatus(40, 20)).toBe('normal');
  });

  it('warnt ab 90 Prozent', async () => {
    const { computeStatus } = await lade();
    expect(computeStatus(40, 36)).toBe('warning');
    expect(computeStatus(40, 35.9)).toBe('normal');
  });

  it('blockiert über dem Limit', async () => {
    const { computeStatus } = await lade();
    expect(computeStatus(40, 40.1)).toBe('blocked');
  });

  it('meldet genau am Limit noch warning, nicht blocked', async () => {
    const { computeStatus } = await lade();
    expect(computeStatus(40, 40)).toBe('warning');
  });

  it('behandelt ein Limit von 0 als "kein Limit"', async () => {
    const { computeStatus } = await lade();
    expect(computeStatus(0, 80)).toBe('normal');
    expect(computeStatus(-1, 80)).toBe('normal');
  });
});
