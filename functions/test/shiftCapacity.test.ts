import { describe, it, expect } from 'vitest';
import {
  releaseShiftCapacity,
  consumesCapacity,
  CAPACITY_CONSUMING_STATUSES,
} from '../src/utils/shiftCapacity';

/**
 * Kapazitätsrechnung beim Freiwerden eines Schichtplatzes.
 * Ein Fehler hier bedeutet: Schicht bleibt fälschlich "besetzt" (Einsatz kann
 * nicht nachbesetzt werden) oder wird doppelt freigegeben (Überbuchung).
 */

describe('consumesCapacity', () => {
  it.each(CAPACITY_CONSUMING_STATUSES)('%s belegt einen Platz', status => {
    expect(consumesCapacity(status)).toBe(true);
  });

  it.each(['requested', 'declined', 'cancelled', 'completed', undefined])(
    '%s belegt keinen Platz',
    status => {
      expect(consumesCapacity(status as string | undefined)).toBe(false);
    }
  );
});

describe('releaseShiftCapacity', () => {
  it('gibt einen Platz frei und öffnet die Schicht wieder', () => {
    expect(releaseShiftCapacity({ assignedCount: 2, capacity: 2, status: 'filled' }, 'accepted')).toEqual(
      { assignedCount: 1, status: 'open' }
    );
  });

  it('lässt eine weiterhin volle Schicht auf "filled"', () => {
    expect(releaseShiftCapacity({ assignedCount: 3, capacity: 2, status: 'filled' }, 'assigned')).toEqual(
      { assignedCount: 2, status: 'filled' }
    );
  });

  it('dekrementiert bei einer bloßen Anfrage NICHT', () => {
    expect(releaseShiftCapacity({ assignedCount: 1, capacity: 2, status: 'open' }, 'requested')).toEqual(
      { assignedCount: 1, status: 'open' }
    );
  });

  it('dekrementiert ein bereits abgelehntes Assignment NICHT erneut', () => {
    expect(releaseShiftCapacity({ assignedCount: 1, capacity: 2, status: 'open' }, 'declined')).toEqual(
      { assignedCount: 1, status: 'open' }
    );
  });

  it('wird nie negativ', () => {
    expect(releaseShiftCapacity({ assignedCount: 0, capacity: 1, status: 'open' }, 'accepted')).toEqual(
      { assignedCount: 0, status: 'open' }
    );
  });

  it('hält eine abgesagte Schicht abgesagt', () => {
    expect(
      releaseShiftCapacity({ assignedCount: 1, capacity: 1, status: 'cancelled' }, 'accepted')
    ).toEqual({ assignedCount: 0, status: 'cancelled' });
  });

  it('nimmt fehlende Kapazität als 1 an', () => {
    expect(releaseShiftCapacity({ assignedCount: 1, status: 'filled' }, 'accepted')).toEqual({
      assignedCount: 0,
      status: 'open',
    });
  });

  it('nimmt einen fehlenden Zähler als 0 an', () => {
    expect(releaseShiftCapacity({ capacity: 2, status: 'open' }, 'accepted')).toEqual({
      assignedCount: 0,
      status: 'open',
    });
  });

  it('meldet eine Schicht mit Kapazität 0 als besetzt', () => {
    expect(releaseShiftCapacity({ assignedCount: 1, capacity: 1, status: 'filled' }, 'pending')).toEqual(
      { assignedCount: 0, status: 'open' }
    );
  });
});
