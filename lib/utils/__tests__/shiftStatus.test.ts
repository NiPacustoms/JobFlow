import { describe, it, expect, vi, afterEach } from 'vitest';
import { isShiftEnded, getShiftDisplayStatus, getShiftStatusLabel } from '../shiftStatus';

afterEach(() => {
  vi.useRealTimers();
});

const setNow = (date: Date) => {
  vi.useFakeTimers();
  vi.setSystemTime(date);
};

describe('isShiftEnded', () => {
  it('erkennt eine vergangene Schicht als beendet', () => {
    setNow(new Date(2026, 3, 10, 12, 0));
    expect(isShiftEnded({ date: new Date(2026, 3, 9), endTime: '16:00' })).toBe(true);
  });

  it('erkennt eine laufende Schicht als nicht beendet', () => {
    setNow(new Date(2026, 3, 10, 12, 0));
    expect(isShiftEnded({ date: new Date(2026, 3, 10), endTime: '16:00' })).toBe(false);
  });

  it('nimmt ohne endTime das Tagesende an', () => {
    setNow(new Date(2026, 3, 10, 23, 0));
    expect(isShiftEnded({ date: new Date(2026, 3, 10) })).toBe(false);
    setNow(new Date(2026, 3, 11, 0, 30));
    expect(isShiftEnded({ date: new Date(2026, 3, 10) })).toBe(true);
  });

  it('verarbeitet ISO-Datumsstrings', () => {
    setNow(new Date(2026, 3, 10, 12, 0));
    expect(isShiftEnded({ date: '2026-04-09T00:00:00', endTime: '16:00' })).toBe(true);
  });

  it('behandelt ein ungültiges Datum als heute (nicht beendet vor Endzeit)', () => {
    setNow(new Date(2026, 3, 10, 8, 0));
    expect(isShiftEnded({ date: 'kein-datum', endTime: '16:00' })).toBe(false);
  });
});

describe('getShiftDisplayStatus', () => {
  it('meldet beendete Schichten unabhängig vom gespeicherten Status', () => {
    setNow(new Date(2026, 3, 10, 12, 0));
    expect(
      getShiftDisplayStatus({ date: new Date(2026, 3, 9), endTime: '16:00', status: 'open' })
    ).toBe('ended');
  });

  it('gibt den gespeicherten Status für zukünftige Schichten zurück', () => {
    setNow(new Date(2026, 3, 10, 12, 0));
    const shift = { date: new Date(2026, 3, 11), endTime: '16:00' } as const;
    expect(getShiftDisplayStatus({ ...shift, status: 'open' })).toBe('open');
    expect(getShiftDisplayStatus({ ...shift, status: 'filled' })).toBe('filled');
    expect(getShiftDisplayStatus({ ...shift, status: 'cancelled' })).toBe('cancelled');
  });

  it('fällt bei fehlendem oder unbekanntem Status auf "open" zurück', () => {
    setNow(new Date(2026, 3, 10, 12, 0));
    expect(getShiftDisplayStatus({ date: new Date(2026, 3, 11), endTime: '16:00' })).toBe('open');
    expect(
      getShiftDisplayStatus({
        date: new Date(2026, 3, 11),
        endTime: '16:00',
        status: 'unbekannt' as never,
      })
    ).toBe('open');
  });
});

describe('getShiftStatusLabel', () => {
  it('liefert deutsche Bezeichnungen', () => {
    expect(getShiftStatusLabel('open')).toBe('Offen');
    expect(getShiftStatusLabel('filled')).toBe('Besetzt');
    expect(getShiftStatusLabel('cancelled')).toBe('Abgesagt');
    expect(getShiftStatusLabel('ended')).toBe('Beendet');
    expect(getShiftStatusLabel('unbekannt' as never)).toBe('Offen');
  });
});
