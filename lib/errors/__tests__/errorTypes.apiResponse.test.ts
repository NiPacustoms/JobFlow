import { describe, it, expect } from 'vitest';

/**
 * Fehlertypen und das API-Antwortformat. Die HTTP-Status-Zuordnung ist Teil des
 * Vertrags mit dem Frontend: 401/403 lösen eine Neuanmeldung aus, 409 eine
 * Konfliktmeldung, 429 eine Wiederholung mit Wartezeit.
 */

import {
  AppError,
  ErrorCode,
  ErrorSeverity,
  ValidationError,
  NetworkError,
  AuthError,
  ServiceError,
  CriticalError,
  createAppError,
  isAppError,
  isCriticalError,
  isRetryableError,
} from '../ErrorTypes';
import {
  getHttpStatusFromError,
  createErrorResponse,
  createAuthErrorResponse,
  createValidationErrorResponse,
  createNotFoundErrorResponse,
} from '../apiErrorResponse';

describe('AppError', () => {
  it('liefert eine deutsche Nutzermeldung je Fehlercode', () => {
    const fehler = new AppError(ErrorCode.FIREBASE_PERMISSION_DENIED, 'permission-denied');
    expect(fehler.userMessage).toBeTruthy();
    expect(fehler.userMessage).not.toBe('permission-denied');
    expect(fehler.technicalMessage).toBe('permission-denied');
  });

  it('nutzt für unbekannte Codes die allgemeine Meldung', () => {
    const fehler = new AppError('KEIN_ECHTER_CODE' as ErrorCode, 'x');
    expect(fehler.userMessage).toContain('unbekannter Fehler');
  });

  it('serialisiert sich vollständig für das Logging', () => {
    const fehler = new AppError(
      ErrorCode.INTERNAL_ERROR,
      'intern',
      ErrorSeverity.CRITICAL,
      { userId: 'u1', route: '/api/shifts' },
      { component: 'shifts' }
    );

    const objekt = fehler.toObject();
    expect(objekt).toMatchObject({
      code: ErrorCode.INTERNAL_ERROR,
      severity: ErrorSeverity.CRITICAL,
      message: 'intern',
    });
    expect((objekt.context as Record<string, unknown>).userId).toBe('u1');
    expect(objekt.stack).toBeTruthy();
  });

  it('zählt Wiederholungen hoch und respektiert die Obergrenze', () => {
    const fehler = new AppError(
      ErrorCode.SERVICE_UNAVAILABLE,
      'weg',
      ErrorSeverity.ERROR,
      {},
      { retryable: true, maxRetries: 2 }
    );

    expect(fehler.isRetryable()).toBe(true);
    const zweiter = fehler.incrementRetryCount();
    expect(zweiter.metadata.retryCount).toBe(1);
    expect(zweiter.isRetryable()).toBe(true);
    const dritter = zweiter.incrementRetryCount();
    expect(dritter.isRetryable()).toBe(false);
  });

  it('gilt ohne retryable-Kennzeichen als nicht wiederholbar', () => {
    const fehler = new AppError(ErrorCode.VALIDATION_REQUIRED_FIELD, 'fehlt');
    expect(fehler.isRetryable()).toBe(false);
  });
});

describe('Fehlerklassen', () => {
  it('setzt Name, Schwere und Wiederholbarkeit passend', () => {
    const validierung = new ValidationError(ErrorCode.VALIDATION_INVALID_FORMAT, 'Format');
    expect(validierung.name).toBe('ValidationError');
    expect(validierung.severity).toBe(ErrorSeverity.WARNING);

    const netz = new NetworkError(ErrorCode.NETWORK_TIMEOUT, 'Timeout');
    expect(netz.name).toBe('NetworkError');
    expect(netz.isRetryable()).toBe(true);

    const auth = new AuthError(ErrorCode.AUTH_REQUIRED, 'Anmeldung');
    expect(auth.name).toBe('AuthError');
    expect(auth.severity).toBe(ErrorSeverity.ERROR);

    const service = new ServiceError(ErrorCode.SERVICE_UNAVAILABLE, 'weg');
    expect(service.name).toBe('ServiceError');
    expect(service.isRetryable()).toBe(true);

    const kritisch = new CriticalError(ErrorCode.INTERNAL_ERROR, 'Ausfall');
    expect(kritisch.name).toBe('CriticalError');
    expect(isCriticalError(kritisch)).toBe(true);
  });
});

describe('createAppError', () => {
  it('gibt einen bestehenden AppError unverändert zurück', () => {
    const original = new AppError(ErrorCode.SHIFT_FULL, 'voll');
    expect(createAppError(original)).toBe(original);
  });

  it('erkennt fehlende Firestore-Indizes an der Meldung', () => {
    const fehler = createAppError(new Error('The query requires an index on date'));
    expect(fehler.code).toBe(ErrorCode.FIREBASE_MISSING_INDEX);
  });

  it('erkennt Berechtigungsfehler an der Meldung', () => {
    const fehler = createAppError(new Error('Missing or insufficient permissions'));
    expect(fehler.code).toBe(ErrorCode.FIREBASE_PERMISSION_DENIED);
  });

  it('behält einen ausdrücklich gesetzten Code', () => {
    const fehler = createAppError(new Error('The query requires an index'), ErrorCode.SHIFT_CONFLICT);
    expect(fehler.code).toBe(ErrorCode.SHIFT_CONFLICT);
  });

  it('verpackt auch Nicht-Fehler-Werte', () => {
    const fehler = createAppError('nur ein Text');
    expect(fehler.technicalMessage).toBe('nur ein Text');
    expect(isAppError(fehler)).toBe(true);
    expect(fehler.metadata.originalError).toBeUndefined();
  });

  it('erkennt Nicht-Fehler über isAppError', () => {
    expect(isAppError(new Error('x'))).toBe(false);
    expect(isCriticalError(new Error('x'))).toBe(false);
    expect(isRetryableError(new Error('x'))).toBe(false);
  });
});

describe('getHttpStatusFromError', () => {
  it.each([
    [ErrorCode.AUTH_REQUIRED, 401],
    [ErrorCode.AUTH_INVALID_TOKEN, 401],
    [ErrorCode.AUTH_SESSION_EXPIRED, 401],
    [ErrorCode.AUTH_INSUFFICIENT_PERMISSIONS, 403],
    [ErrorCode.VALIDATION_REQUIRED_FIELD, 400],
    [ErrorCode.VALIDATION_INVALID_FORMAT, 400],
    [ErrorCode.VALIDATION_OUT_OF_RANGE, 400],
    [ErrorCode.VALIDATION_DUPLICATE_VALUE, 409],
    [ErrorCode.FIREBASE_NOT_FOUND, 404],
    [ErrorCode.FIREBASE_ALREADY_EXISTS, 409],
    [ErrorCode.FIREBASE_PERMISSION_DENIED, 403],
    [ErrorCode.FIREBASE_QUOTA_EXCEEDED, 429],
    [ErrorCode.FIREBASE_MISSING_INDEX, 400],
    [ErrorCode.NETWORK_TIMEOUT, 504],
    [ErrorCode.NETWORK_CONNECTION_FAILED, 503],
    [ErrorCode.SERVICE_UNAVAILABLE, 503],
    [ErrorCode.SERVICE_RATE_LIMITED, 429],
    [ErrorCode.SHIFT_CONFLICT, 409],
    [ErrorCode.SHIFT_FULL, 409],
    [ErrorCode.TIMESHEET_INVALID, 400],
    [ErrorCode.INVITATION_EXPIRED, 410],
    [ErrorCode.INTERNAL_ERROR, 500],
  ])('ordnet %s auf %i zu', (code, status) => {
    expect(getHttpStatusFromError(new AppError(code, 'x'))).toBe(status);
  });

  it('nutzt 500 für nicht zugeordnete Codes', () => {
    expect(getHttpStatusFromError(new AppError(ErrorCode.UNKNOWN_ERROR, 'x'))).toBe(500);
  });
});

describe('createErrorResponse', () => {
  it('liefert Status, Code und beide Meldungen', async () => {
    const antwort = createErrorResponse(
      new AppError(ErrorCode.FIREBASE_NOT_FOUND, 'Schicht fehlt')
    );

    expect(antwort.status).toBe(404);
    const koerper = await antwort.json();
    expect(koerper.success).toBe(false);
    expect(koerper.error.code).toBe(ErrorCode.FIREBASE_NOT_FOUND);
    expect(koerper.error.message).toBe('Schicht fehlt');
    expect(koerper.error.userMessage).toBeTruthy();
  });

  it('gibt Zusatzangaben nur ohne eingebetteten Originalfehler weiter', async () => {
    const mitDaten = createErrorResponse(
      new AppError(ErrorCode.VALIDATION_INVALID_FORMAT, 'Format', ErrorSeverity.WARNING, {
        additionalData: { feld: 'iban' },
      })
    );
    expect((await mitDaten.json()).error.details).toEqual({ feld: 'iban' });

    const mitOriginal = createErrorResponse(
      new AppError(
        ErrorCode.VALIDATION_INVALID_FORMAT,
        'Format',
        ErrorSeverity.WARNING,
        { additionalData: { feld: 'iban' } },
        { originalError: new Error('roh') }
      )
    );
    expect((await mitOriginal.json()).error.details).toBeUndefined();
  });
});

describe('Antwort-Helfer', () => {
  it('liefert 401 für fehlende Anmeldung und 403 für fehlende Rechte', async () => {
    const nichtAngemeldet = createAuthErrorResponse('UNAUTHENTICATED', '/api/shifts');
    expect(nichtAngemeldet.status).toBe(401);
    expect((await nichtAngemeldet.json()).error.message).toBe('Unauthenticated');

    const keineRechte = createAuthErrorResponse('UNAUTHORIZED');
    expect(keineRechte.status).toBe(403);
    expect((await keineRechte.json()).error.message).toBe('Unauthorized');
  });

  it('liefert 400 für Validierungsfehler, auch mit eigenem Code', async () => {
    const standard = createValidationErrorResponse('Feld fehlt');
    expect(standard.status).toBe(400);
    expect((await standard.json()).error.code).toBe(ErrorCode.VALIDATION_REQUIRED_FIELD);

    const konflikt = createValidationErrorResponse(
      'schon vorhanden',
      ErrorCode.VALIDATION_DUPLICATE_VALUE
    );
    expect(konflikt.status).toBe(409);
  });

  it('liefert 404 für nicht gefundene Objekte', async () => {
    const antwort = createNotFoundErrorResponse('Nachweis fehlt', '/api/timesheets');
    expect(antwort.status).toBe(404);
    expect((await antwort.json()).error.message).toBe('Nachweis fehlt');
  });
});
