import { describe, it, expect } from 'vitest';
import { mapDocToShift } from '../mapDoc';
import { safeToDate, safeDateToISOString } from '../types';
import { timeToMs, checkTimeOverlap } from '../helpers';

/**
 * Abbildung und Zeitlogik der Schichten. Fehler hier wirken sich direkt auf den
 * Dienstplan aus: falsches Datum, verlorener Folgetag (Nachtschicht) oder ein
 * nicht erkannter Konflikt bei der Zuweisung.
 */

describe('safeToDate', () => {
  it('reicht ein Date unverändert durch', () => {
    const d = new Date(2026, 6, 20);
    expect(safeToDate(d)).toBe(d);
  });

  it('wandelt ISO-Strings um', () => {
    expect(safeToDate('2026-07-20T00:00:00.000Z').toISOString()).toBe('2026-07-20T00:00:00.000Z');
  });

  it('wandelt Firestore-Timestamps um', () => {
    const ts = { toDate: () => new Date(2026, 6, 20) };
    expect(safeToDate(ts).getDate()).toBe(20);
  });

  it('liefert für leere Werte ein gültiges Datum', () => {
    expect(safeToDate(null)).toBeInstanceOf(Date);
    expect(safeToDate(undefined)).toBeInstanceOf(Date);
    expect(safeToDate(0)).toBeInstanceOf(Date);
  });

  it('liefert für unbekannte Typen ein gültiges Datum', () => {
    expect(safeToDate({ irgendwas: true })).toBeInstanceOf(Date);
  });
});

describe('safeDateToISOString', () => {
  it('kürzt auf den Tagesanteil', () => {
    expect(safeDateToISOString('2026-07-20T22:15:00.000Z')).toBe('2026-07-20');
  });
});

describe('mapDocToShift', () => {
  const basis = {
    facilityId: 'f1',
    date: '2026-07-20T00:00:00.000Z',
    startTime: '06:00',
    endTime: '14:00',
    type: 'Frühdienst',
  };

  it('bildet die Pflichtfelder ab', () => {
    const shift = mapDocToShift('s1', basis);
    expect(shift).toMatchObject({
      id: 's1',
      facilityId: 'f1',
      date: '2026-07-20',
      startTime: '06:00',
      endTime: '14:00',
    });
  });

  it('erzeugt einen Titel aus Typ und Startzeit, wenn keiner gesetzt ist', () => {
    expect(mapDocToShift('s1', basis).title).toBe('Frühdienst - 06:00');
  });

  it('übernimmt einen gesetzten Titel', () => {
    expect(mapDocToShift('s1', { ...basis, title: 'Nachtwache' }).title).toBe('Nachtwache');
  });

  it('übernimmt den Folgetag einer Nachtschicht', () => {
    const shift = mapDocToShift('s1', {
      ...basis,
      startTime: '22:00',
      endTime: '06:00',
      endDate: '2026-07-21T00:00:00.000Z',
    });
    expect(shift.endDate).toBe('2026-07-21');
  });

  it('lässt endDate ohne Angabe undefiniert', () => {
    expect(mapDocToShift('s1', basis).endDate).toBeUndefined();
  });

  it('normalisiert den Altstatus "assigned" zu "filled"', () => {
    expect(mapDocToShift('s1', { ...basis, status: 'assigned' }).status).toBe('filled');
  });

  it('akzeptiert die gültigen Statuswerte unabhängig von Groß-/Kleinschreibung', () => {
    expect(mapDocToShift('s1', { ...basis, status: 'OPEN' }).status).toBe('open');
    expect(mapDocToShift('s1', { ...basis, status: 'filled' }).status).toBe('filled');
    expect(mapDocToShift('s1', { ...basis, status: 'cancelled' }).status).toBe('cancelled');
  });

  it('fällt bei unbekanntem oder fehlendem Status auf "open" zurück', () => {
    expect(mapDocToShift('s1', { ...basis, status: 'irgendwas' }).status).toBe('open');
    expect(mapDocToShift('s1', basis).status).toBe('open');
    expect(mapDocToShift('s1', { ...basis, status: 42 }).status).toBe('open');
  });

  it('setzt Standardwerte für Kapazität und Zähler', () => {
    const shift = mapDocToShift('s1', basis);
    expect(shift.capacity).toBe(1);
    expect(shift.maxStaff).toBe(1);
    expect(shift.assignedCount).toBe(0);
    expect(shift.assignedTo).toEqual([]);
    expect(shift.requiredQualifications).toEqual([]);
    expect(shift.timezone).toBe('Europe/Berlin');
  });

  it('übernimmt gesetzte Kapazitätswerte inklusive 0', () => {
    const shift = mapDocToShift('s1', { ...basis, capacity: 0, assignedCount: 0, maxStaff: 5 });
    expect(shift.capacity).toBe(0);
    expect(shift.maxStaff).toBe(5);
  });
});

describe('timeToMs', () => {
  it('rechnet HH:MM in Millisekunden um', () => {
    expect(timeToMs('00:00')).toBe(0);
    expect(timeToMs('01:30')).toBe(90 * 60 * 1000);
    expect(timeToMs('23:59')).toBe((23 * 60 + 59) * 60 * 1000);
  });
});

describe('checkTimeOverlap', () => {
  const tag = '2026-07-20';

  it('erkennt überlappende Schichten am selben Tag', () => {
    expect(
      checkTimeOverlap(
        { date: tag, startTime: '06:00', endTime: '14:00' },
        { date: tag, startTime: '13:00', endTime: '21:00' }
      )
    ).toBe(true);
  });

  it('lässt direkt anschließende Schichten zu', () => {
    expect(
      checkTimeOverlap(
        { date: tag, startTime: '06:00', endTime: '14:00' },
        { date: tag, startTime: '14:00', endTime: '22:00' }
      )
    ).toBe(false);
  });

  it('erkennt getrennte Schichten', () => {
    expect(
      checkTimeOverlap(
        { date: tag, startTime: '06:00', endTime: '10:00' },
        { date: tag, startTime: '14:00', endTime: '22:00' }
      )
    ).toBe(false);
  });

  it('erkennt vollständig eingeschlossene Schichten', () => {
    expect(
      checkTimeOverlap(
        { date: tag, startTime: '06:00', endTime: '22:00' },
        { date: tag, startTime: '10:00', endTime: '12:00' }
      )
    ).toBe(true);
  });

  it('meldet für verschiedene Tage keine Überschneidung', () => {
    expect(
      checkTimeOverlap(
        { date: '2026-07-20', startTime: '06:00', endTime: '14:00' },
        { date: '2026-07-21', startTime: '06:00', endTime: '14:00' }
      )
    ).toBe(false);
  });
});
