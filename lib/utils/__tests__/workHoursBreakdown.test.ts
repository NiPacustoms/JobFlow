import { describe, it, expect } from 'vitest';
import {
  computeWorkHoursBreakdown,
  getNationalHolidayKeys,
} from '../../../functions/src/utils/workHoursBreakdown';

describe('getNationalHolidayKeys', () => {
  it('kennt die bundesweiten Feiertage 2026 (inkl. korrektem Pfingstmontag)', () => {
    const keys = getNationalHolidayKeys(2026);
    expect(keys.has('2026-01-01')).toBe(true); // Neujahr
    expect(keys.has('2026-04-03')).toBe(true); // Karfreitag (Ostern 05.04.)
    expect(keys.has('2026-04-06')).toBe(true); // Ostermontag
    expect(keys.has('2026-05-14')).toBe(true); // Christi Himmelfahrt
    expect(keys.has('2026-05-25')).toBe(true); // Pfingstmontag (+50, NICHT +49)
    expect(keys.has('2026-05-24')).toBe(false); // Pfingstsonntag ist kein Extra-Key
    expect(keys.has('2026-10-03')).toBe(true);
    expect(keys.has('2026-12-25')).toBe(true);
  });
});

describe('computeWorkHoursBreakdown', () => {
  it('Werktag-Frühdienst: keine Sonderstunden', () => {
    // Mi 08.07.2026, 06:30–14:30, 30 Min Pause
    const b = computeWorkHoursBreakdown(
      new Date(2026, 6, 8, 6, 30),
      new Date(2026, 6, 8, 14, 30),
      30
    );
    expect(b.totalHours).toBeCloseTo(7.5);
    expect(b.nightHours).toBe(0);
    expect(b.weekendHours).toBe(0);
    expect(b.holidayHours).toBe(0);
    expect(b.overtimeHours).toBe(0);
  });

  it('Nachtschicht über Mitternacht: Nachtfenster 23–06 korrekt aufgeteilt', () => {
    // Do 09.07. 21:00 – Fr 10.07. 06:00, keine Pause → 9h, davon 23–06 = 7h Nacht
    const b = computeWorkHoursBreakdown(
      new Date(2026, 6, 9, 21, 0),
      new Date(2026, 6, 10, 6, 0),
      0
    );
    expect(b.totalHours).toBeCloseTo(9);
    expect(b.nightHours).toBeCloseTo(7);
    expect(b.overtimeHours).toBeCloseTo(1); // > 8h
  });

  it('Pause wird proportional abgezogen', () => {
    // 9h brutto mit 60 Min Pause → Faktor 8/9 auch auf Nachtanteil
    const b = computeWorkHoursBreakdown(
      new Date(2026, 6, 9, 21, 0),
      new Date(2026, 6, 10, 6, 0),
      60
    );
    expect(b.totalHours).toBeCloseTo(8);
    expect(b.nightHours).toBeCloseTo(7 * (8 / 9), 2);
  });

  it('Samstag→Sonntag über Mitternacht: Stunden landen im richtigen Tages-Bucket', () => {
    // Sa 11.07.2026 22:00 – So 12.07. 04:00 (6h): Sa 2h, So 4h; Nacht 23–04 = 5h
    const b = computeWorkHoursBreakdown(
      new Date(2026, 6, 11, 22, 0),
      new Date(2026, 6, 12, 4, 0),
      0
    );
    expect(b.saturdayHours).toBeCloseTo(2);
    expect(b.sundayHours).toBeCloseTo(4);
    expect(b.weekendHours).toBeCloseTo(6);
    expect(b.nightHours).toBeCloseTo(5);
  });

  it('Feiertagsstunden werden korrekt erkannt', () => {
    // Tag der Arbeit, Fr 01.05.2026, 08:00–16:00, keine Pause
    const b = computeWorkHoursBreakdown(
      new Date(2026, 4, 1, 8, 0),
      new Date(2026, 4, 1, 16, 0),
      0
    );
    expect(b.holidayHours).toBeCloseTo(8);
  });

  it('Sonntagsstunden an einem Nicht-Feiertag', () => {
    // So 12.07.2026 (kein Feiertag), 08:00–16:00
    const b = computeWorkHoursBreakdown(
      new Date(2026, 6, 12, 8, 0),
      new Date(2026, 6, 12, 16, 0),
      0
    );
    expect(b.sundayHours).toBeCloseTo(8);
  });
});
