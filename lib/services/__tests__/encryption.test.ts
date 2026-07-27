import { describe, expect, it } from 'vitest';
import { EncryptionService } from '../encryption';

/**
 * Verschlüsselung sensibler Personaldaten (IBAN, SV-Nummer, Steuer-ID).
 * DSGVO-relevant: Die Werte liegen in Firestore nur verschlüsselt.
 */

describe('encrypt / decrypt', () => {
  it('verschlüsselt und entschlüsselt einen Wert verlustfrei', () => {
    const original = 'DE88 4205 0001 0102 0122 10';
    const verschluesselt = EncryptionService.encrypt(original);
    expect(verschluesselt).not.toBe(original);
    expect(EncryptionService.decrypt(verschluesselt)).toBe(original);
  });

  it('erzeugt für denselben Klartext unterschiedliche Chiffrate (Salt)', () => {
    const a = EncryptionService.encrypt('geheim');
    const b = EncryptionService.encrypt('geheim');
    expect(a).not.toBe(b);
    expect(EncryptionService.decrypt(a)).toBe('geheim');
    expect(EncryptionService.decrypt(b)).toBe('geheim');
  });
});

describe('IBAN', () => {
  const iban = 'DE88420500010102012210';

  it('verschlüsselt eine gültige IBAN und stellt sie wieder her', () => {
    const verschluesselt = EncryptionService.encryptIBAN(iban);
    expect(EncryptionService.decryptIBAN(verschluesselt)).toBe(iban);
  });

  it('lehnt eine ungültige IBAN ab', () => {
    expect(() => EncryptionService.encryptIBAN('KEINE-IBAN')).toThrow(/Ungültige IBAN/);
    expect(() => EncryptionService.encryptIBAN('')).toThrow(/Ungültige IBAN/);
  });

  it('lehnt ein entschlüsseltes Ergebnis ab, das keine IBAN ist', () => {
    const fremd = EncryptionService.encrypt('kein-iban-wert');
    expect(() => EncryptionService.decryptIBAN(fremd)).toThrow(/ungültig/);
  });
});

describe('Sozialversicherungsnummer', () => {
  // Erwartetes Format des Validators: 12 Ziffern ohne Trennzeichen
  const svnr = '121903670051';

  it('verschlüsselt eine plausible SV-Nummer', () => {
    const verschluesselt = EncryptionService.encryptSocialSecurityNumber(svnr);
    expect(EncryptionService.decryptSocialSecurityNumber(verschluesselt)).toBe(svnr);
  });

  it('lehnt eine unplausible SV-Nummer ab', () => {
    expect(() => EncryptionService.encryptSocialSecurityNumber('123')).toThrow(/Ungültige/);
  });
});

describe('Steuer-ID', () => {
  it('verschlüsselt eine elfstellige Steuer-ID', () => {
    const verschluesselt = EncryptionService.encryptTaxId('12345678901');
    expect(EncryptionService.decryptTaxId(verschluesselt)).toBe('12345678901');
  });

  it('lehnt eine falsch lange Steuer-ID ab', () => {
    expect(() => EncryptionService.encryptTaxId('123')).toThrow(/Ungültige/);
  });
});
