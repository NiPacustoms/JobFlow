import { describe, it, expect } from 'vitest';
import { formatCurrency, formatHours, formatPercent, formatDateISO, trendColor, assert } from '../format';
import { isAdmin, ensureSameCompany, maskEmail } from '../authz';
import { dataUrlToBlob } from '../dataUrl';

describe('format', () => {
  it('formatiert Beträge in Euro', () => {
    expect(formatCurrency(1234.5).replace(/ /g, ' ')).toBe('1.234,50 €');
    expect(formatCurrency(0).replace(/ /g, ' ')).toBe('0,00 €');
  });

  it('behandelt NaN-Beträge als 0', () => {
    expect(formatCurrency(Number.NaN).replace(/ /g, ' ')).toBe('0,00 €');
  });

  it('formatiert Stunden und Prozente', () => {
    expect(formatHours(7.5)).toBe('7.50 Std');
    expect(formatHours(Number.NaN)).toBe('0.00 Std');
    expect(formatPercent(12.34)).toBe('12.3%');
    expect(formatPercent(Number.POSITIVE_INFINITY)).toBe('0.0%');
  });

  it('formatiert Datumsangaben als ISO-Tag', () => {
    expect(formatDateISO(new Date(Date.UTC(2026, 6, 26)))).toBe('2026-07-26');
    expect(formatDateISO('2026-01-02T10:00:00.000Z')).toBe('2026-01-02');
  });

  it('liefert Trendfarben nach Vorzeichen', () => {
    expect(trendColor(1)).toBe('success.main');
    expect(trendColor(-1)).toBe('error.main');
    expect(trendColor(0)).toBe('text.secondary');
  });

  it('assert reicht Werte durch und wirft bei null/undefined', () => {
    expect(assert('wert', 'fehlt')).toBe('wert');
    expect(assert(0, 'fehlt')).toBe(0);
    expect(() => assert(null, 'Nutzer fehlt')).toThrow('Nutzer fehlt');
    expect(() => assert(undefined, 'Nutzer fehlt')).toThrow('Nutzer fehlt');
  });
});

describe('authz', () => {
  it('erkennt Admins', () => {
    expect(isAdmin({ role: 'admin' })).toBe(true);
    expect(isAdmin({ role: 'nurse' })).toBe(false);
    expect(isAdmin(null)).toBe(false);
    expect(isAdmin(undefined)).toBe(false);
  });

  it('prüft die Mandantenzugehörigkeit', () => {
    expect(ensureSameCompany({ companyId: 'firmaA' }, 'firmaA')).toBe(true);
    expect(ensureSameCompany({ companyId: 'firmaA' }, 'firmaB')).toBe(false);
    expect(ensureSameCompany(null, 'firmaA')).toBe(false);
    expect(ensureSameCompany({ companyId: 'firmaA' }, null)).toBe(false);
    expect(ensureSameCompany({ companyId: 'firmaA' }, '')).toBe(false);
  });

  it('maskiert E-Mail-Adressen', () => {
    expect(maskEmail('anna.muster@aufabruf.eu')).toBe('a***@aufabruf.eu');
    expect(maskEmail('x@y.de')).toBe('x***@y.de');
  });
});

describe('dataUrlToBlob', () => {
  it('konvertiert eine PNG-Data-URL in einen Blob', () => {
    // 1x1 transparentes PNG
    const dataUrl =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const blob = dataUrlToBlob(dataUrl);
    expect(blob.type).toBe('image/png');
    expect(blob.size).toBeGreaterThan(0);
  });

  it('fällt ohne MIME-Angabe auf image/png zurück', () => {
    const blob = dataUrlToBlob('data:;base64,QUJD');
    expect(blob.type).toBe('image/png');
    expect(blob.size).toBe(3);
  });
});
