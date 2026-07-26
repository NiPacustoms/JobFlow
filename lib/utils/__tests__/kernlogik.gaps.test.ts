import { describe, it, expect } from 'vitest';
import {
  getNextRequiredSignatureDate,
  validateSignatureScheduleMaxBlock,
  calculateSignatureSchedule,
} from '../signatureSchedule';
import { checkOverlap } from '../shiftTimeUtils';
import { getLegalInfo } from '@/lib/config/legal';
import { stripTags, sanitizeUserUpdate } from '../sanitize';
import { dataUrlToBlob } from '../dataUrl';
import { calculateWorkedMinutes } from '../time';

/**
 * Schließt die verbliebenen Lücken der Kernlogik-Abdeckung:
 * Signaturplanung, Überlappungsprüfung, Firmendaten, Randfälle.
 */

describe('getNextRequiredSignatureDate', () => {
  const start = new Date(2026, 6, 20);
  const ende = new Date(2026, 6, 31);

  it('liefert den ersten noch offenen Pflichttag', () => {
    const { requiredDates } = calculateSignatureSchedule(start, ende);
    const naechster = getNextRequiredSignatureDate(start, ende, []);
    expect(naechster).toEqual(requiredDates[0]);
  });

  it('überspringt bereits gesammelte Tage', () => {
    const { requiredDates } = calculateSignatureSchedule(start, ende);
    const ersterKey = requiredDates[0].toISOString().slice(0, 10);
    const naechster = getNextRequiredSignatureDate(start, ende, [ersterKey]);
    expect(naechster).not.toBeNull();
    expect(naechster?.getTime()).not.toBe(requiredDates[0].getTime());
  });

  it('liefert null, wenn alle Pflichttage abgedeckt sind', () => {
    const { requiredDates } = calculateSignatureSchedule(start, ende);
    const alle = requiredDates.map(d => d.toISOString().slice(0, 10));
    expect(getNextRequiredSignatureDate(start, ende, alle)).toBeNull();
  });
});

describe('validateSignatureScheduleMaxBlock (Regel: max. 7 Tage ohne Signatur)', () => {
  it('akzeptiert den regulär berechneten Zeitplan', () => {
    const start = new Date(2026, 6, 20);
    const ende = new Date(2026, 6, 31);
    const { requiredDates } = calculateSignatureSchedule(start, ende);
    const result = validateSignatureScheduleMaxBlock(start, ende, requiredDates);
    expect(result.isValid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('meldet einen Restblock von mehr als sieben Tagen nach der letzten Signatur', () => {
    const start = new Date(2026, 6, 1);
    const ende = new Date(2026, 6, 31);
    const result = validateSignatureScheduleMaxBlock(start, ende, [new Date(2026, 6, 1)]);
    expect(result.isValid).toBe(false);
    expect(result.violations.join(' ')).toMatch(/Restblock|Signaturblock/);
  });

  it('meldet einen zu langen Block zwischen zwei Signaturen', () => {
    const start = new Date(2026, 6, 1);
    const ende = new Date(2026, 6, 20);
    const result = validateSignatureScheduleMaxBlock(start, ende, [
      new Date(2026, 6, 1),
      new Date(2026, 6, 20),
    ]);
    expect(result.isValid).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
  });

  it('meldet einen zu langen Zeitraum ganz ohne Signatur', () => {
    const result = validateSignatureScheduleMaxBlock(
      new Date(2026, 6, 1),
      new Date(2026, 6, 31),
      []
    );
    expect(result.isValid).toBe(false);
  });
});

describe('checkOverlap', () => {
  const iv = (vonH: number, bisH: number) => ({
    start: new Date(2026, 6, 20, vonH),
    end: new Date(2026, 6, 20, bisH),
  });

  it('erkennt echte Überschneidungen', () => {
    expect(checkOverlap(iv(8, 16), iv(14, 22))).toBe(true);
  });

  it('erkennt vollständige Überdeckung', () => {
    expect(checkOverlap(iv(8, 20), iv(10, 12))).toBe(true);
  });

  it('lässt direkt anschließende Schichten zu', () => {
    expect(checkOverlap(iv(8, 16), iv(16, 22))).toBe(false);
  });

  it('erkennt getrennte Zeiträume', () => {
    expect(checkOverlap(iv(6, 10), iv(14, 22))).toBe(false);
  });
});

describe('getLegalInfo', () => {
  it('liefert die hinterlegten Firmendaten der AufAbruf GmbH', () => {
    const info = getLegalInfo();
    expect(info.companyName).toContain('AufAbruf');
    expect(info.contact.email).toBe('info@aufabruf.eu');
    expect(info.address.city).toBeTruthy();
    expect(info.registration?.registerNumber ?? '').toBeTruthy();
  });
});

describe('Randfälle der Textbereinigung', () => {
  it('lässt Objekte ohne die optionalen Blöcke unverändert', () => {
    const result = sanitizeUserUpdate({ address: null, contact: null, emergencyContact: null });
    expect(result.address).toBeNull();
    expect(result.contact).toBeNull();
  });

  it('ignoriert Nicht-String-Werte in verschachtelten Blöcken', () => {
    const result = sanitizeUserUpdate({
      contact: { phoneMobile: 123, emailPrivate: undefined },
      bankAccount: { bic: 42 },
      emergencyContact: { phone: null },
    });
    expect((result.contact as Record<string, unknown>).phoneMobile).toBe(123);
    expect((result.bankAccount as Record<string, unknown>).bic).toBe(42);
  });

  it('entfernt Nicht-Strings aus den Qualifikationen', () => {
    const result = sanitizeUserUpdate({ qualifications: [42, 'Examiniert', null] });
    expect(result.qualifications).toEqual(['Examiniert']);
  });

  it('gibt bei reinen Tags einen leeren String zurück', () => {
    expect(stripTags('<b></b>')).toBe('');
  });
});

describe('Randfälle Data-URL und Arbeitszeit', () => {
  it('verarbeitet eine Data-URL ohne Nutzdaten', () => {
    const blob = dataUrlToBlob('data:image/png;base64,');
    expect(blob.size).toBe(0);
    expect(blob.type).toBe('image/png');
  });

  it('behandelt unvollständige Uhrzeiten als Mitternacht', () => {
    const minuten = calculateWorkedMinutes({
      date: new Date(2026, 6, 20),
      startTime: '08',
      endTime: '16:00',
      breakMinutes: 0,
    });
    // '08' → Stunde 8, Minute fehlt → 0
    expect(minuten).toBe(480);
  });

  it('behandelt eine fehlende Pausenangabe als 0', () => {
    const minuten = calculateWorkedMinutes({
      date: new Date(2026, 6, 20),
      startTime: '08:00',
      endTime: '16:00',
      breakMinutes: null,
    });
    expect(minuten).toBe(480);
  });
});
