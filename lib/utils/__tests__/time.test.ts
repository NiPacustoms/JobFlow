import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  toHHMM,
  diffHHMM,
  calcWorkMin,
  getRequiredBreakMinutes,
  calculateWorkedMinutes,
  todayISO,
  entryIdFromDate,
  isValidTimeFormat,
  isEndAfterStart,
  needsBreakWarning,
  formatWorkHours,
} from '../time';

afterEach(() => {
  vi.useRealTimers();
});

describe('toHHMM', () => {
  it('formatiert eine Uhrzeit als HH:MM', () => {
    expect(toHHMM(new Date(2026, 0, 15, 6, 5))).toBe('06:05');
    expect(toHHMM(new Date(2026, 0, 15, 23, 59))).toBe('23:59');
  });

  it('nutzt ohne Argument die aktuelle Zeit', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 3, 14, 30));
    expect(toHHMM()).toBe('14:30');
  });
});

describe('diffHHMM', () => {
  it('berechnet die Differenz innerhalb eines Tages', () => {
    expect(diffHHMM('06:00', '14:00')).toBe(480);
    expect(diffHHMM('08:15', '08:45')).toBe(30);
  });

  it('behandelt Nachtschichten über Mitternacht', () => {
    expect(diffHHMM('22:00', '06:00')).toBe(480);
    expect(diffHHMM('23:30', '00:30')).toBe(60);
  });

  it('liefert 0 bei identischen Zeiten', () => {
    expect(diffHHMM('08:00', '08:00')).toBe(0);
  });
});

describe('calcWorkMin', () => {
  it('zieht die Pause ab', () => {
    expect(calcWorkMin('06:00', '14:00', 30)).toBe(450);
  });

  it('wird nie negativ', () => {
    expect(calcWorkMin('08:00', '09:00', 120)).toBe(0);
  });

  it('rechnet auch über Mitternacht korrekt', () => {
    expect(calcWorkMin('21:00', '06:00', 45)).toBe(495);
  });
});

describe('getRequiredBreakMinutes (§ 4 ArbZG)', () => {
  it('verlangt bis einschließlich 6 Stunden keine Pause', () => {
    expect(getRequiredBreakMinutes(0)).toBe(0);
    expect(getRequiredBreakMinutes(5 * 60)).toBe(0);
    expect(getRequiredBreakMinutes(6 * 60)).toBe(0);
  });

  it('verlangt über 6 bis 9 Stunden 30 Minuten', () => {
    expect(getRequiredBreakMinutes(6 * 60 + 1)).toBe(30);
    expect(getRequiredBreakMinutes(8 * 60)).toBe(30);
    expect(getRequiredBreakMinutes(9 * 60)).toBe(30);
  });

  it('verlangt über 9 Stunden 45 Minuten', () => {
    expect(getRequiredBreakMinutes(9 * 60 + 1)).toBe(45);
    expect(getRequiredBreakMinutes(12 * 60)).toBe(45);
  });
});

describe('calculateWorkedMinutes', () => {
  const date = new Date(2026, 2, 10);

  it('liefert 0 ohne Startzeit oder Datum', () => {
    expect(calculateWorkedMinutes({ date })).toBe(0);
    expect(calculateWorkedMinutes({ startTime: '08:00' })).toBe(0);
    expect(calculateWorkedMinutes({} as never)).toBe(0);
  });

  it('berechnet abgeschlossene Schichten abzüglich Pause', () => {
    expect(
      calculateWorkedMinutes({ date, startTime: '08:00', endTime: '16:00', breakMinutes: 30 })
    ).toBe(450);
  });

  it('behandelt Nachtschichten als Folgetag', () => {
    expect(
      calculateWorkedMinutes({ date, startTime: '22:00', endTime: '06:00', breakMinutes: 0 })
    ).toBe(480);
  });

  it('behandelt eine 24-Stunden-Spanne bei gleicher Start-/Endzeit', () => {
    expect(
      calculateWorkedMinutes({ date, startTime: '08:00', endTime: '08:00', breakMinutes: 0 })
    ).toBe(24 * 60);
  });

  it('rechnet laufende Schichten bis zum Referenzzeitpunkt', () => {
    const reference = new Date(2026, 2, 10, 11, 30);
    expect(
      calculateWorkedMinutes({ date, startTime: '08:00', endTime: null, breakMinutes: 0 }, reference)
    ).toBe(210);
  });

  it('liefert 0, wenn der Referenzzeitpunkt vor dem Start liegt', () => {
    const reference = new Date(2026, 2, 10, 6, 0);
    expect(
      calculateWorkedMinutes({ date, startTime: '08:00', endTime: null }, reference)
    ).toBe(0);
  });

  it('wird durch überlange Pausen nicht negativ', () => {
    expect(
      calculateWorkedMinutes({ date, startTime: '08:00', endTime: '09:00', breakMinutes: 300 })
    ).toBe(0);
  });
});

describe('todayISO / entryIdFromDate', () => {
  it('liefert das heutige Datum als ISO-Tag', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 6, 26, 12, 0, 0)));
    expect(todayISO()).toBe('2026-07-26');
  });

  it('bildet die Eintrags-ID als yyyyMMdd', () => {
    expect(entryIdFromDate(new Date(2026, 0, 5))).toBe('20260105');
    expect(entryIdFromDate(new Date(2026, 11, 31))).toBe('20261231');
  });

  it('nutzt ohne Argument das aktuelle Datum', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 9, 10, 0, 0));
    expect(entryIdFromDate()).toBe('20260909');
  });
});

describe('isValidTimeFormat', () => {
  it('akzeptiert gültige HH:MM-Zeiten', () => {
    expect(isValidTimeFormat('00:00')).toBe(true);
    expect(isValidTimeFormat('23:59')).toBe(true);
    expect(isValidTimeFormat('06:30')).toBe(true);
  });

  it('lehnt ungültige Formate ab', () => {
    expect(isValidTimeFormat('24:00')).toBe(false);
    expect(isValidTimeFormat('6:30')).toBe(false);
    expect(isValidTimeFormat('08:60')).toBe(false);
    expect(isValidTimeFormat('acht Uhr')).toBe(false);
    expect(isValidTimeFormat('')).toBe(false);
  });
});

describe('isEndAfterStart', () => {
  it('erkennt reguläre Zeitspannen', () => {
    expect(isEndAfterStart('08:00', '16:00')).toBe(true);
  });

  it('wertet Nachtschichten als gültig', () => {
    expect(isEndAfterStart('22:00', '06:00')).toBe(true);
  });

  it('liefert false bei fehlenden Werten', () => {
    expect(isEndAfterStart('', '16:00')).toBe(false);
    expect(isEndAfterStart('08:00', '')).toBe(false);
  });
});

describe('needsBreakWarning', () => {
  it('warnt bei zu kurzer Pause über 6 Stunden', () => {
    expect(needsBreakWarning(7 * 60, 15)).toBe(true);
  });

  it('warnt nicht bei ausreichender Pause', () => {
    expect(needsBreakWarning(7 * 60, 30)).toBe(false);
    expect(needsBreakWarning(10 * 60, 45)).toBe(false);
  });

  it('warnt nicht bei kurzen Schichten ohne Pflichtpause', () => {
    expect(needsBreakWarning(5 * 60, 0)).toBe(false);
  });
});

describe('formatWorkHours', () => {
  it('formatiert Minuten als Stunden', () => {
    expect(formatWorkHours(480)).toBe('8h');
    expect(formatWorkHours(450)).toBe('7.5h');
    expect(formatWorkHours(0)).toBe('0h');
  });
});
