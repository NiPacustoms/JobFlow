import { describe, it, expect } from 'vitest';
import { escapeHtml, stripTags, sanitizeUserUpdate } from '../sanitize';

describe('escapeHtml', () => {
  it('maskiert alle HTML-Sonderzeichen', () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'
    );
    expect(escapeHtml("O'Brien & Co")).toBe('O&#x27;Brien &amp; Co');
  });

  it('liefert für leere Werte einen leeren String', () => {
    expect(escapeHtml('')).toBe('');
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  it('maskiert das kaufmännische Und vor den übrigen Entities', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });
});

describe('stripTags', () => {
  it('entfernt Tags und normalisiert Whitespace', () => {
    expect(stripTags('<b>Anna</b>   Muster')).toBe('Anna Muster');
    expect(stripTags('  mehrere\n\nZeilen  ')).toBe('mehrere Zeilen');
  });

  it('liefert undefined für Nicht-Strings', () => {
    expect(stripTags(42)).toBeUndefined();
    expect(stripTags(null)).toBeUndefined();
    expect(stripTags(undefined)).toBeUndefined();
    expect(stripTags({})).toBeUndefined();
  });
});

describe('sanitizeUserUpdate', () => {
  it('bereinigt einfache Textfelder', () => {
    const result = sanitizeUserUpdate({
      displayName: '<i>Anna</i>',
      jobTitle: '<b>Pflegefachkraft</b>',
      group: ' Team A ',
      phone: '  +49 170 1234567  ',
    });
    expect(result.displayName).toBe('Anna');
    expect(result.jobTitle).toBe('Pflegefachkraft');
    expect(result.group).toBe('Team A');
    expect(result.phone).toBe('+49 170 1234567');
  });

  it('setzt displayName auf leeren String, wenn nichts übrig bleibt', () => {
    expect(sanitizeUserUpdate({ displayName: 123 }).displayName).toBe('');
  });

  it('bereinigt verschachtelte Adress- und Kontaktobjekte', () => {
    const result = sanitizeUserUpdate({
      address: { street: '<b>Hauptstr.</b>', houseNumber: '1a', city: ' Herten ' },
      contact: { phoneMobile: ' 0170 ', emailPrivate: '<i>a@b.de</i>' },
      emergencyContact: { name: '<b>Bea</b>', phone: ' 0201 ', relation: 'Schwester' },
    });
    expect((result.address as Record<string, unknown>).street).toBe('Hauptstr.');
    expect((result.address as Record<string, unknown>).city).toBe('Herten');
    expect((result.contact as Record<string, unknown>).phoneMobile).toBe('0170');
    expect((result.contact as Record<string, unknown>).emailPrivate).toBe('a@b.de');
    expect((result.emergencyContact as Record<string, unknown>).name).toBe('Bea');
  });

  it('normalisiert Bankdaten und lässt die IBAN unangetastet', () => {
    const result = sanitizeUserUpdate({
      bankAccount: { iban: 'VERSCHLUESSELT', bic: ' weladed1gek ', bankName: '<b>Sparkasse</b>' },
    });
    const bank = result.bankAccount as Record<string, unknown>;
    expect(bank.iban).toBe('VERSCHLUESSELT');
    expect(bank.bic).toBe('WELADED1GEK');
    expect(bank.bankName).toBe('Sparkasse');
  });

  it('bereinigt Qualifikationen und entfernt leere Einträge', () => {
    const result = sanitizeUserUpdate({
      qualifications: ['<b>Examiniert</b>', '   ', 'Beatmung'],
    });
    expect(result.qualifications).toEqual(['Examiniert', 'Beatmung']);
  });

  it('normalisiert customRoleId inklusive Zurücksetzen', () => {
    expect(sanitizeUserUpdate({ customRoleId: '  rolle1 ' }).customRoleId).toBe('rolle1');
    expect(sanitizeUserUpdate({ customRoleId: null }).customRoleId).toBeNull();
    expect(sanitizeUserUpdate({ customRoleId: undefined }).customRoleId).toBeNull();
  });

  it('lässt unbekannte Felder unverändert', () => {
    const result = sanitizeUserUpdate({ active: true, workingHoursPerWeek: 35 });
    expect(result.active).toBe(true);
    expect(result.workingHoursPerWeek).toBe(35);
  });
});
