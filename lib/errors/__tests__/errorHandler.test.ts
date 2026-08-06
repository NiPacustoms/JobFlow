import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Zentrale Fehlerbehandlung: Übersetzung von Firebase-/Netzwerk-/
 * Validierungsfehlern in AppError, Anreicherung und Wiederholungslogik.
 */

import { errorHandler, ErrorUtils } from '../ErrorHandler';
import { AppError, ErrorCode, ErrorSeverity, isAppError } from '../ErrorTypes';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('handleError', () => {
  it('wandelt unbekannte Fehler in einen AppError um', () => {
    const fehler = errorHandler.handleError(new Error('kaputt'), { userId: 'u1' });
    expect(isAppError(fehler)).toBe(true);
    expect(fehler.technicalMessage).toContain('kaputt');
    expect(fehler.context.userId).toBe('u1');
    expect(fehler.context.timestamp).toBeInstanceOf(Date);
  });

  it('reichert einen bestehenden AppError nur an', () => {
    const original = new AppError(ErrorCode.INTERNAL_ERROR, 'intern', ErrorSeverity.CRITICAL);
    const fehler = errorHandler.handleError(original, { userId: 'u1' }, { component: 'test' });
    expect(fehler.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(fehler.severity).toBe(ErrorSeverity.CRITICAL);
    expect(fehler.context.userId).toBe('u1');
    expect(fehler.metadata.component).toBe('test');
  });
});

describe('handleFirebaseError', () => {
  it.each([
    ['permission-denied', ErrorCode.FIREBASE_PERMISSION_DENIED, ErrorSeverity.ERROR],
    ['not-found', ErrorCode.FIREBASE_NOT_FOUND, ErrorSeverity.WARNING],
    ['already-exists', ErrorCode.FIREBASE_ALREADY_EXISTS, ErrorSeverity.WARNING],
    ['resource-exhausted', ErrorCode.FIREBASE_QUOTA_EXCEEDED, ErrorSeverity.CRITICAL],
    ['unauthenticated', ErrorCode.AUTH_REQUIRED, ErrorSeverity.ERROR],
    ['deadline-exceeded', ErrorCode.NETWORK_TIMEOUT, ErrorSeverity.ERROR],
    ['unavailable', ErrorCode.SERVICE_UNAVAILABLE, ErrorSeverity.ERROR],
    ['internal', ErrorCode.INTERNAL_ERROR, ErrorSeverity.CRITICAL],
  ])('übersetzt den Firebase-Code %s', (firebaseCode, erwarteterCode, schwere) => {
    const fehler = errorHandler.handleFirebaseError({ code: firebaseCode, message: 'fb' });
    expect(fehler.code).toBe(erwarteterCode);
    expect(fehler.severity).toBe(schwere);
    expect(fehler.metadata.component).toBe('firebase');
  });

  it('behandelt unbekannte Codes und Nicht-Objekte', () => {
    expect(errorHandler.handleFirebaseError({ code: 'was-auch-immer' }).code).toBe(
      ErrorCode.UNKNOWN_ERROR
    );
    const fehler = errorHandler.handleFirebaseError('nur ein String');
    expect(fehler.code).toBe(ErrorCode.UNKNOWN_ERROR);
    expect(fehler.technicalMessage).toBe('Firebase error occurred');
  });
});

describe('handleNetworkError', () => {
  it.each([
    [{ name: 'TimeoutError' }, ErrorCode.NETWORK_TIMEOUT],
    [{ code: 'TIMEOUT' }, ErrorCode.NETWORK_TIMEOUT],
    [{ status: 429 }, ErrorCode.SERVICE_RATE_LIMITED],
    [{ status: 500 }, ErrorCode.SERVICE_UNAVAILABLE],
    [{ status: 401 }, ErrorCode.AUTH_INVALID_TOKEN],
    [{ status: 403 }, ErrorCode.AUTH_INSUFFICIENT_PERMISSIONS],
    [{ message: 'offline' }, ErrorCode.NETWORK_CONNECTION_FAILED],
  ])('ordnet %o zu', (eingabe, erwarteterCode) => {
    const fehler = errorHandler.handleNetworkError(eingabe);
    expect(fehler.code).toBe(erwarteterCode);
    expect(fehler.metadata.retryable).toBe(true);
  });

  it('stuft Serverfehler als kritisch ein', () => {
    expect(errorHandler.handleNetworkError({ status: 503 }).severity).toBe(ErrorSeverity.CRITICAL);
  });
});

describe('handleValidationError', () => {
  it.each([
    [{ type: 'format' }, ErrorCode.VALIDATION_INVALID_FORMAT],
    [{ type: 'range' }, ErrorCode.VALIDATION_OUT_OF_RANGE],
    [{ type: 'duplicate' }, ErrorCode.VALIDATION_DUPLICATE_VALUE],
    [{ type: 'sonst' }, ErrorCode.VALIDATION_REQUIRED_FIELD],
  ])('ordnet den Typ %o zu', (eingabe, erwarteterCode) => {
    const fehler = errorHandler.handleValidationError(eingabe);
    expect(fehler.code).toBe(erwarteterCode);
    expect(fehler.severity).toBe(ErrorSeverity.WARNING);
  });

  it('stellt das Feld der Meldung voran', () => {
    const fehler = errorHandler.handleValidationError({ message: 'zu kurz' }, 'iban');
    expect(fehler.technicalMessage).toBe('iban: zu kurz');
    expect(fehler.metadata.action).toBe('validate_iban');
  });
});

describe('executeWithRetry', () => {
  it('wiederholt wiederholbare Fehler und liefert das spätere Ergebnis', async () => {
    let versuche = 0;
    const fn = vi.fn(async () => {
      versuche += 1;
      if (versuche === 1) {
        throw new AppError(ErrorCode.SERVICE_UNAVAILABLE, 'kurz weg', ErrorSeverity.ERROR, {}, {
          retryable: true,
        });
      }
      return 'ok';
    });

    const versprechen = errorHandler.executeWithRetry(fn);
    await vi.runAllTimersAsync();
    await expect(versprechen).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('bricht bei nicht wiederholbaren Fehlern sofort ab', async () => {
    const fn = vi.fn(async () => {
      throw new Error('dauerhaft kaputt');
    });
    const versprechen = errorHandler.executeWithRetry(fn).catch(e => e);
    await vi.runAllTimersAsync();
    const fehler = await versprechen;
    expect(isAppError(fehler)).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('createComponentHandler und ErrorUtils', () => {
  it('versieht alle Fehler mit dem Komponentennamen', () => {
    const handler = errorHandler.createComponentHandler('dienstplan');
    // Die Anreicherung setzt den Komponentennamen zuletzt – er gewinnt daher
    // auch gegen die Voreinstellungen 'firebase'/'network'/'validation'.
    expect(handler.handleError(new Error('x')).metadata.component).toBe('dienstplan');
    expect(handler.handleFirebaseError({ code: 'not-found' }).metadata.component).toBe('dienstplan');
    expect(handler.handleNetworkError({ status: 500 }).metadata.component).toBe('dienstplan');
    expect(handler.handleValidationError({ type: 'format' }).metadata.component).toBe('dienstplan');
  });

  it('führt Funktionen mit Wiederholung über den Komponenten-Handler aus', async () => {
    const handler = errorHandler.createComponentHandler('dienstplan');
    await expect(handler.executeWithRetry(async () => 42)).resolves.toBe(42);
  });

  it('wrapAsync reicht Ergebnisse durch und übersetzt Fehler', async () => {
    await expect(ErrorUtils.wrapAsync(async () => 'ok')).resolves.toBe('ok');
    const fehler = await ErrorUtils.wrapAsync(async () => {
      throw new Error('kaputt');
    }).catch(e => e);
    expect(isAppError(fehler)).toBe(true);
  });

  it('wrapSync reicht Ergebnisse durch und übersetzt Fehler', () => {
    expect(ErrorUtils.wrapSync(() => 7)).toBe(7);
    try {
      ErrorUtils.wrapSync(() => {
        throw new Error('kaputt');
      });
      expect.unreachable();
    } catch (fehler) {
      expect(isAppError(fehler)).toBe(true);
    }
  });

  it('erzeugt Routen- und Service-Handler mit Präfix', () => {
    const route = ErrorUtils.createRouteHandler('api/zeiten');
    const service = ErrorUtils.createServiceHandler('zeiten');
    expect(route.handleError(new Error('x')).metadata.component).toBe('route:api/zeiten');
    expect(service.handleError(new Error('x')).metadata.component).toBe('service:zeiten');
  });
});
