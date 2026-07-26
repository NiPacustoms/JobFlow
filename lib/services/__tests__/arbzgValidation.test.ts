import { describe, expect, it } from 'vitest';
import { arbzgValidationService, type TimesheetEntry } from '../arbzgValidation';

/**
 * Prüft die gesetzlichen Vorgaben des Arbeitszeitgesetzes.
 * Für eine Zeitarbeitsfirma in der Pflege ist das der haftungsrelevante Kern:
 * § 3 (Höchstarbeitszeit), § 4 (Pausen), § 5 (Ruhezeit).
 */

const eintrag = (overrides: Partial<TimesheetEntry> = {}): TimesheetEntry => ({
  date: new Date(2026, 6, 20),
  startTime: '08:00',
  endTime: '16:30',
  totalHours: 8,
  breakMinutes: 30,
  ...overrides,
});

const pruefe = (entries: TimesheetEntry[]) => arbzgValidationService.validateArbZG(entries);

describe('§ 3 ArbZG – tägliche Höchstarbeitszeit', () => {
  it('meldet 8 Stunden als unauffällig', () => {
    const result = pruefe([eintrag({ totalHours: 8 })]);
    expect(result.violations.filter(v => v.type === 'daily')).toHaveLength(0);
    expect(result.isValid).toBe(true);
  });

  it('warnt zwischen 8 und 10 Stunden', () => {
    const result = pruefe([eintrag({ totalHours: 9, breakMinutes: 30 })]);
    const daily = result.violations.filter(v => v.type === 'daily');
    expect(daily).toHaveLength(1);
    expect(daily[0].severity).toBe('warning');
    expect(result.isValid).toBe(true);
  });

  it('stuft über 10 Stunden als Fehler ein', () => {
    const result = pruefe([eintrag({ totalHours: 10.5, breakMinutes: 45 })]);
    const daily = result.violations.filter(v => v.type === 'daily');
    expect(daily[0].severity).toBe('error');
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toContain('überschreitet 8h/Tag');
  });

  it('ignoriert Einträge mit ungültigem Datum', () => {
    const result = pruefe([eintrag({ date: 'kein-datum', totalHours: 20 })]);
    expect(result.violations).toHaveLength(0);
  });

  it('ignoriert negative oder unendliche Stunden', () => {
    const result = pruefe([
      eintrag({ totalHours: -5 }),
      eintrag({ totalHours: Number.POSITIVE_INFINITY }),
    ]);
    expect(result.violations.filter(v => v.type === 'daily')).toHaveLength(0);
  });

  it('akzeptiert ISO-Datumsstrings', () => {
    const result = pruefe([eintrag({ date: '2026-07-20T00:00:00', totalHours: 12, breakMinutes: 45 })]);
    expect(result.violations.some(v => v.type === 'daily')).toBe(true);
  });
});

describe('§ 3 ArbZG – wöchentliche Höchstarbeitszeit', () => {
  const woche = (stunden: number[]) =>
    stunden.map((h, i) =>
      eintrag({ date: new Date(2026, 6, 20 + i), totalHours: h, breakMinutes: 45 })
    );

  it('meldet 40 Stunden als unauffällig', () => {
    const result = pruefe(woche([8, 8, 8, 8, 8]));
    expect(result.violations.filter(v => v.type === 'weekly')).toHaveLength(0);
  });

  it('warnt zwischen 40 und 48 Stunden', () => {
    const result = pruefe(woche([9, 9, 9, 9, 9]));
    const weekly = result.violations.filter(v => v.type === 'weekly');
    expect(weekly).toHaveLength(1);
    expect(weekly[0].severity).toBe('warning');
  });

  it('stuft über 48 Stunden als Fehler ein', () => {
    const result = pruefe(woche([10, 10, 10, 10, 10]));
    const weekly = result.violations.filter(v => v.type === 'weekly');
    expect(weekly[0].severity).toBe('error');
    expect(weekly[0].message).toContain('überschreitet 40h/Woche');
  });

  it('rechnet Wochen getrennt ab', () => {
    const result = pruefe([
      ...woche([9, 9, 9, 9, 9]),
      // Folgewoche, unauffällig
      eintrag({ date: new Date(2026, 6, 27), totalHours: 8 }),
    ]);
    expect(result.violations.filter(v => v.type === 'weekly')).toHaveLength(1);
  });

  it('ordnet den Sonntag der laufenden ISO-Woche zu', () => {
    // 20.–26.07.2026 ist Mo–So derselben ISO-Woche.
    const result = pruefe([
      eintrag({ date: new Date(2026, 6, 20), totalHours: 20, breakMinutes: 45 }),
      eintrag({ date: new Date(2026, 6, 26), totalHours: 25, breakMinutes: 45 }),
    ]);
    const weekly = result.violations.filter(v => v.type === 'weekly');
    expect(weekly).toHaveLength(1);
    expect(weekly[0].message).toContain('45.00h');
  });
});

describe('§ 4 ArbZG – Pausen', () => {
  it('verlangt bis 6 Stunden keine Pause', () => {
    const result = pruefe([eintrag({ totalHours: 6, breakMinutes: 0, endTime: '14:00' })]);
    expect(result.violations.filter(v => v.type === 'break')).toHaveLength(0);
  });

  it('warnt bei über 6 Stunden und weniger als 30 Minuten Pause', () => {
    const result = pruefe([eintrag({ totalHours: 7, breakMinutes: 15 })]);
    const pausen = result.violations.filter(v => v.type === 'break');
    expect(pausen).toHaveLength(1);
    expect(pausen[0].severity).toBe('warning');
    expect(pausen[0].message).toContain('unterschreitet 30min');
  });

  it('akzeptiert genau 30 Minuten bei 7 Stunden', () => {
    const result = pruefe([eintrag({ totalHours: 7, breakMinutes: 30 })]);
    expect(result.violations.filter(v => v.type === 'break')).toHaveLength(0);
  });

  it('stuft zu kurze Pause über 9 Stunden als Fehler ein', () => {
    const result = pruefe([eintrag({ totalHours: 9.5, breakMinutes: 30 })]);
    const pausen = result.violations.filter(v => v.type === 'break');
    expect(pausen[0].severity).toBe('error');
    expect(pausen[0].message).toContain('unterschreitet 45min');
    expect(result.isValid).toBe(false);
  });

  it('akzeptiert genau 45 Minuten über 9 Stunden', () => {
    const result = pruefe([eintrag({ totalHours: 9.5, breakMinutes: 45 })]);
    expect(result.violations.filter(v => v.type === 'break')).toHaveLength(0);
  });

  it('behandelt eine fehlende Pausenangabe als 0 Minuten', () => {
    const result = pruefe([eintrag({ totalHours: 8, breakMinutes: undefined })]);
    expect(result.violations.filter(v => v.type === 'break')).toHaveLength(1);
  });

  it('ignoriert negative Pausenangaben', () => {
    const result = pruefe([eintrag({ totalHours: 8, breakMinutes: -30 })]);
    expect(result.violations.filter(v => v.type === 'break')).toHaveLength(0);
  });
});

describe('§ 5 ArbZG – Ruhezeit von 11 Stunden', () => {
  it('meldet keine Verletzung bei ausreichender Ruhezeit', () => {
    const result = pruefe([
      eintrag({ date: new Date(2026, 6, 20), startTime: '08:00', endTime: '16:00', totalHours: 8 }),
      eintrag({ date: new Date(2026, 6, 21), startTime: '08:00', endTime: '16:00', totalHours: 8 }),
    ]);
    expect(result.violations.filter(v => v.type === 'rest')).toHaveLength(0);
  });

  it('warnt bei Ruhezeit zwischen 9 und 11 Stunden', () => {
    const result = pruefe([
      eintrag({ date: new Date(2026, 6, 20), startTime: '14:00', endTime: '22:00', totalHours: 8 }),
      eintrag({ date: new Date(2026, 6, 21), startTime: '08:00', endTime: '16:00', totalHours: 8 }),
    ]);
    const ruhe = result.violations.filter(v => v.type === 'rest');
    expect(ruhe).toHaveLength(1);
    expect(ruhe[0].severity).toBe('warning');
    expect(ruhe[0].message).toContain('unterschreitet 11h');
  });

  it('stuft weniger als 9 Stunden Ruhezeit als Fehler ein', () => {
    const result = pruefe([
      eintrag({ date: new Date(2026, 6, 20), startTime: '14:00', endTime: '23:00', totalHours: 8.5, breakMinutes: 30 }),
      eintrag({ date: new Date(2026, 6, 21), startTime: '06:00', endTime: '14:00', totalHours: 8 }),
    ]);
    const ruhe = result.violations.filter(v => v.type === 'rest');
    expect(ruhe[0].severity).toBe('error');
    expect(result.isValid).toBe(false);
  });

  it('berücksichtigt Nachtschichten über Mitternacht', () => {
    // Nachtschicht endet am 21. um 06:00, nächste Schicht beginnt am 21. um 14:00 → 8h Ruhe
    const result = pruefe([
      eintrag({ date: new Date(2026, 6, 20), startTime: '22:00', endTime: '06:00', totalHours: 8 }),
      eintrag({ date: new Date(2026, 6, 21), startTime: '14:00', endTime: '22:00', totalHours: 8 }),
    ]);
    const ruhe = result.violations.filter(v => v.type === 'rest');
    expect(ruhe).toHaveLength(1);
    expect(ruhe[0].severity).toBe('error');
  });

  it('prüft nichts bei nur einer Schicht', () => {
    const result = pruefe([eintrag()]);
    expect(result.violations.filter(v => v.type === 'rest')).toHaveLength(0);
  });

  it('ignoriert Lücken über 48 Stunden', () => {
    const result = pruefe([
      eintrag({ date: new Date(2026, 6, 20), startTime: '08:00', endTime: '16:00', totalHours: 8 }),
      eintrag({ date: new Date(2026, 6, 25), startTime: '08:00', endTime: '16:00', totalHours: 8 }),
    ]);
    expect(result.violations.filter(v => v.type === 'rest')).toHaveLength(0);
  });

  it('überspringt Einträge ohne Zeitangaben', () => {
    const result = pruefe([
      eintrag({ date: new Date(2026, 6, 20), startTime: undefined, endTime: undefined, totalHours: 8 }),
      eintrag({ date: new Date(2026, 6, 21), startTime: undefined, endTime: undefined, totalHours: 8 }),
    ]);
    expect(result.violations.filter(v => v.type === 'rest')).toHaveLength(0);
  });

  it('überspringt unsinnige Uhrzeiten', () => {
    const result = pruefe([
      eintrag({ date: new Date(2026, 6, 20), startTime: '25:00', endTime: '99:99', totalHours: 8 }),
      eintrag({ date: new Date(2026, 6, 21), startTime: '08:00', endTime: '16:00', totalHours: 8 }),
    ]);
    expect(result.violations.filter(v => v.type === 'rest')).toHaveLength(0);
  });

  it('überspringt unvollständige Zeitformate', () => {
    const result = pruefe([
      eintrag({ date: new Date(2026, 6, 20), startTime: '8', endTime: '16', totalHours: 8 }),
      eintrag({ date: new Date(2026, 6, 21), startTime: '08:00', endTime: '16:00', totalHours: 8 }),
    ]);
    expect(result.violations.filter(v => v.type === 'rest')).toHaveLength(0);
  });
});

describe('Gesamtergebnis', () => {
  it('ist bei leerer Eingabe gültig', () => {
    const result = pruefe([]);
    expect(result).toEqual({ isValid: true, errors: [], warnings: [], violations: [] });
  });

  it('trennt Fehler und Warnungen', () => {
    const result = pruefe([
      eintrag({ date: new Date(2026, 6, 20), totalHours: 9, breakMinutes: 30 }), // Warnung (täglich)
      eintrag({ date: new Date(2026, 6, 22), totalHours: 11, breakMinutes: 30 }), // Fehler (täglich + Pause)
    ]);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.isValid).toBe(false);
    expect(result.errors.length + result.warnings.length).toBe(result.violations.length);
  });

  it('erkennt mehrere Verstoßarten gleichzeitig', () => {
    const result = pruefe([
      eintrag({ date: new Date(2026, 6, 20), startTime: '10:00', endTime: '23:00', totalHours: 12.5, breakMinutes: 0 }),
      eintrag({ date: new Date(2026, 6, 21), startTime: '06:00', endTime: '18:00', totalHours: 11.5, breakMinutes: 0 }),
    ]);
    const arten = new Set(result.violations.map(v => v.type));
    expect(arten.has('daily')).toBe(true);
    expect(arten.has('break')).toBe(true);
    expect(arten.has('rest')).toBe(true);
  });
});
