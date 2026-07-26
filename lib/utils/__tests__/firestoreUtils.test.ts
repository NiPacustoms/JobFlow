import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  toDate,
  toTimestamp,
  safeGet,
  convertFirestoreData,
  isValidDocumentId,
  generateDocumentId,
  toDateInputValue,
  formatFirestoreError,
} from '../firestore';
import { isFirestoreTimestamp, toDate as toDateStrict } from '../firestoreTimestamp';
import { createInitialFacilityFormData, validateFacilityForm } from '../facilityFormUtils';
import { getRateLimiter } from '../rateLimit';

describe('toDate / toDateStrict', () => {
  const timestamp = { toDate: () => new Date(2026, 6, 20) };

  it('reicht Date-Objekte durch', () => {
    const d = new Date(2026, 6, 20);
    expect(toDate(d)).toBe(d);
    expect(toDateStrict(d)).toBe(d);
  });

  it('wandelt Firestore-Timestamps um', () => {
    expect(toDate(timestamp).getDate()).toBe(20);
    expect(toDateStrict(timestamp).getDate()).toBe(20);
  });

  it('wandelt Strings und Zahlen um', () => {
    expect(toDate('2026-07-20T00:00:00.000Z').toISOString()).toBe('2026-07-20T00:00:00.000Z');
    expect(toDate(1_700_000_000_000)).toBeInstanceOf(Date);
    expect(toDateStrict('2026-07-20T00:00:00.000Z').getUTCDate()).toBe(20);
  });

  it('liefert für leere Werte das aktuelle Datum', () => {
    expect(toDate(null)).toBeInstanceOf(Date);
    expect(toDateStrict(undefined)).toBeInstanceOf(Date);
    expect(toDateStrict(0)).toBeInstanceOf(Date);
  });

  it('liefert für unbekannte Typen ein Datum statt zu werfen', () => {
    expect(toDateStrict({ foo: 1 })).toBeInstanceOf(Date);
  });
});

describe('isFirestoreTimestamp', () => {
  it('erkennt Timestamp-ähnliche Objekte', () => {
    expect(isFirestoreTimestamp({ toDate: () => new Date() })).toBe(true);
  });

  it('lehnt alles andere ab', () => {
    expect(isFirestoreTimestamp(null)).toBe(false);
    expect(isFirestoreTimestamp('2026-07-20')).toBe(false);
    expect(isFirestoreTimestamp({ toDate: 'kein Funktion' })).toBe(false);
    expect(isFirestoreTimestamp(new Date())).toBe(false);
  });
});

describe('toTimestamp', () => {
  it('normalisiert verschiedene Eingaben auf Date', () => {
    const d = new Date(2026, 6, 20);
    expect(toTimestamp(d)).toBe(d);
    expect(toTimestamp('2026-07-20')).toBeInstanceOf(Date);
    expect(toTimestamp(1_700_000_000_000)).toBeInstanceOf(Date);
    expect(toTimestamp(null)).toBeInstanceOf(Date);
    expect(toTimestamp({ irgendwas: true })).toBeInstanceOf(Date);
  });
});

describe('safeGet', () => {
  const obj = { user: { profile: { name: 'Anna' }, aktiv: false } };

  it('liest verschachtelte Pfade', () => {
    expect(safeGet(obj, 'user.profile.name', 'Fallback')).toBe('Anna');
  });

  it('liefert auch falsy Werte statt des Fallbacks', () => {
    expect(safeGet(obj, 'user.aktiv', true)).toBe(false);
  });

  it('liefert den Fallback bei fehlendem Pfad', () => {
    expect(safeGet(obj, 'user.profile.email', 'keine')).toBe('keine');
    expect(safeGet(obj, 'firma.name', 'keine')).toBe('keine');
  });

  it('liefert den Fallback für Nicht-Objekte', () => {
    expect(safeGet(null, 'a.b', 'x')).toBe('x');
    expect(safeGet('text', 'a', 'x')).toBe('x');
  });
});

describe('convertFirestoreData', () => {
  it('wandelt Timestamps in Dates', () => {
    const result = convertFirestoreData({
      createdAt: { toDate: () => new Date(2026, 6, 20) },
      name: 'Schicht',
    }) as Record<string, unknown>;
    expect(result.createdAt).toBeInstanceOf(Date);
    expect(result.name).toBe('Schicht');
  });

  it('arbeitet rekursiv in verschachtelten Objekten', () => {
    const result = convertFirestoreData({
      meta: { updatedAt: { toDate: () => new Date(2026, 6, 21) } },
    }) as { meta: { updatedAt: Date } };
    expect(result.meta.updatedAt).toBeInstanceOf(Date);
  });

  it('reicht primitive Werte und null durch', () => {
    expect(convertFirestoreData(null)).toBeNull();
    expect(convertFirestoreData(undefined)).toBeUndefined();
    expect(convertFirestoreData(42)).toBe(42);
    expect(convertFirestoreData('text')).toBe('text');
  });
});

describe('isValidDocumentId', () => {
  it('akzeptiert normale IDs', () => {
    expect(isValidDocumentId('abc123')).toBe(true);
  });

  it('lehnt leere und überlange IDs ab', () => {
    expect(isValidDocumentId('')).toBe(false);
    expect(isValidDocumentId('x'.repeat(1501))).toBe(false);
    expect(isValidDocumentId(42 as never)).toBe(false);
  });
});

describe('generateDocumentId', () => {
  it('erzeugt standardmäßig 20 Zeichen', () => {
    expect(generateDocumentId()).toHaveLength(20);
  });

  it('respektiert die gewünschte Länge', () => {
    expect(generateDocumentId(8)).toHaveLength(8);
    expect(generateDocumentId(0)).toBe('');
  });

  it('erzeugt nur alphanumerische Zeichen', () => {
    expect(generateDocumentId(50)).toMatch(/^[A-Za-z0-9]+$/);
  });
});

describe('toDateInputValue', () => {
  it('formatiert für ein HTML-Datumsfeld', () => {
    expect(toDateInputValue(new Date(Date.UTC(2026, 6, 20)))).toBe('2026-07-20');
  });

  it('liefert für leere Werte einen leeren String', () => {
    expect(toDateInputValue(null)).toBe('');
    expect(toDateInputValue(undefined)).toBe('');
  });
});

describe('formatFirestoreError', () => {
  it.each([
    ['permission-denied', 'Zugriff verweigert. Überprüfen Sie Ihre Berechtigungen.'],
    ['not-found', 'Dokument nicht gefunden.'],
    ['already-exists', 'Dokument existiert bereits.'],
    ['unauthenticated', 'Nicht authentifiziert. Bitte melden Sie sich an.'],
    ['unavailable', 'Service nicht verfügbar. Versuchen Sie es später erneut.'],
  ])('übersetzt %s', (code, erwartet) => {
    expect(formatFirestoreError({ code, message: 'raw' })).toBe(erwartet);
  });

  it('nutzt bei unbekanntem Code die Originalmeldung', () => {
    expect(formatFirestoreError({ code: 'xyz', message: 'Originaltext' })).toBe('Originaltext');
  });

  it('liefert für Nicht-Firestore-Fehler eine allgemeine Meldung', () => {
    expect(formatFirestoreError(new Error('irgendwas'))).toBe('Unbekannter Fehler aufgetreten.');
    expect(formatFirestoreError(null)).toBe('Unbekannter Fehler aufgetreten.');
  });
});

describe('Einrichtungs-Formular', () => {
  const vollstaendig = () => ({
    ...createInitialFacilityFormData('#0f766e'),
    name: 'Haus Sonnenschein',
    address: 'Hauptstr. 1, 45699 Herten',
    contactPerson: 'Frau Müller',
    phone: '02366 123456',
    email: 'info@sonnenschein.de',
    debtorNumber: 'D-1001',
  });

  it('erzeugt sinnvolle Startwerte', () => {
    const initial = createInitialFacilityFormData('#0f766e');
    expect(initial.colorCode).toBe('#0f766e');
    expect(initial.paymentTerms).toBe('30 Tage netto');
    expect(initial.name).toBe('');
  });

  it('akzeptiert ein vollständiges Formular', () => {
    const result = validateFacilityForm(vollstaendig());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual({});
  });

  it('meldet alle fehlenden Pflichtfelder', () => {
    const result = validateFacilityForm(createInitialFacilityFormData('#000'));
    expect(result.valid).toBe(false);
    expect(Object.keys(result.errors).sort()).toEqual(
      ['address', 'contactPerson', 'debtorNumber', 'email', 'name', 'phone'].sort()
    );
  });

  it('prüft das E-Mail-Format', () => {
    const result = validateFacilityForm({ ...vollstaendig(), email: 'kaputt' });
    expect(result.errors.email).toBe('Ungültige E-Mail-Adresse');
  });

  it('prüft auch die Rechnungs-E-Mail', () => {
    const result = validateFacilityForm({ ...vollstaendig(), billingEmail: 'kaputt' });
    expect(result.valid).toBe(false);
    expect(result.errors.billingEmail).toBe('Ungültige E-Mail-Adresse');
  });

  it('lässt eine leere Rechnungs-E-Mail zu', () => {
    expect(validateFacilityForm({ ...vollstaendig(), billingEmail: '' }).valid).toBe(true);
  });
});

describe('getRateLimiter', () => {
  beforeEach(() => {
    (globalThis as { __rateLimitStore?: Map<string, unknown> }).__rateLimitStore = new Map();
  });

  it('lässt Anfragen bis zum Limit zu', () => {
    const limiter = getRateLimiter({ windowMs: 60_000, max: 3 });
    expect(limiter.check('ip1').allowed).toBe(true);
    expect(limiter.check('ip1').allowed).toBe(true);
    expect(limiter.check('ip1').allowed).toBe(true);
  });

  it('blockiert nach Überschreiten und nennt eine Wartezeit', () => {
    const limiter = getRateLimiter({ windowMs: 60_000, max: 2 });
    limiter.check('ip2');
    limiter.check('ip2');
    const result = limiter.check('ip2');
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('zählt je Schlüssel getrennt', () => {
    const limiter = getRateLimiter({ windowMs: 60_000, max: 1 });
    expect(limiter.check('ipA').allowed).toBe(true);
    expect(limiter.check('ipB').allowed).toBe(true);
    expect(limiter.check('ipA').allowed).toBe(false);
  });

  it('füllt Token über die Zeit wieder auf', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 20, 12, 0, 0));
    const limiter = getRateLimiter({ windowMs: 60_000, max: 2 });
    limiter.check('ipC');
    limiter.check('ipC');
    expect(limiter.check('ipC').allowed).toBe(false);

    vi.setSystemTime(new Date(2026, 6, 20, 12, 1, 0));
    expect(limiter.check('ipC').allowed).toBe(true);
    vi.useRealTimers();
  });
});
