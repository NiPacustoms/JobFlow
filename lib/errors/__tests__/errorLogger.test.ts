import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Strukturiertes Logging: Log-Level-Schwelle, Konsolen- und JSON-Ausgabe,
 * Unterdrückung erwarteter Firestore-Warnungen und Komponenten-Logger.
 */

import { Logger, LogLevel, LogUtils, logger } from '../ErrorLogger';
import { AppError, ErrorCode, ErrorSeverity } from '../ErrorTypes';

/**
 * Der globale Logger ist ein Singleton mit den Voreinstellungen der Umgebung.
 * Für die Prüfung der Konfigurationszweige wird über getInstance eine
 * frische Instanz auf einer eigenen Klassen-Kopie gebaut.
 */
const frischerLogger = (config: Parameters<typeof Logger.getInstance>[0]) => {
  // Singleton-Feld zurücksetzen, damit die Konfiguration greift
  (Logger as unknown as { instance?: Logger }).instance = undefined;
  const instanz = Logger.getInstance(config);
  return instanz;
};

let konsole: {
  debug: ReturnType<typeof vi.spyOn>;
  info: ReturnType<typeof vi.spyOn>;
  warn: ReturnType<typeof vi.spyOn>;
  error: ReturnType<typeof vi.spyOn>;
  log: ReturnType<typeof vi.spyOn>;
};

beforeEach(() => {
  konsole = {
    debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
    info: vi.spyOn(console, 'info').mockImplementation(() => {}),
    warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
    error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    log: vi.spyOn(console, 'log').mockImplementation(() => {}),
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  // Globalen Logger wiederherstellen, damit andere Tests ihn unverändert nutzen
  (Logger as unknown as { instance?: Logger }).instance = logger;
});

describe('Log-Level', () => {
  it('gibt Meldungen ab der konfigurierten Schwelle aus', () => {
    const log = frischerLogger({ logLevel: LogLevel.WARN, enableStructuredLogging: false });

    log.debug('nicht sichtbar');
    log.info('auch nicht');
    log.warn('sichtbar');

    expect(konsole.debug).not.toHaveBeenCalled();
    expect(konsole.info).not.toHaveBeenCalled();
    expect(konsole.warn).toHaveBeenCalledTimes(1);
  });

  it('nutzt für jede Stufe die passende Konsolenmethode', () => {
    const log = frischerLogger({ logLevel: LogLevel.DEBUG, enableStructuredLogging: false });

    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');
    log.critical('c');

    expect(konsole.debug).toHaveBeenCalled();
    expect(konsole.info).toHaveBeenCalled();
    expect(konsole.warn).toHaveBeenCalled();
    // error + critical (+ ggf. Fehlerdetails)
    expect(konsole.error).toHaveBeenCalled();
  });
});

describe('Fehler-Anreicherung', () => {
  it('verpackt einfache Fehler in einen AppError und gibt Details aus', () => {
    const log = frischerLogger({ logLevel: LogLevel.DEBUG, enableStructuredLogging: false });
    log.error('Ladefehler', new Error('kaputt'));

    expect(konsole.error).toHaveBeenCalledWith(expect.stringContaining('Ladefehler'));
    expect(konsole.error).toHaveBeenCalledWith('Error Details:', expect.any(Object));
  });

  it('übernimmt einen bestehenden AppError samt Nutzermeldung', () => {
    const log = frischerLogger({ logLevel: LogLevel.DEBUG, enableStructuredLogging: false });
    const appFehler = new AppError(
      ErrorCode.FIREBASE_PERMISSION_DENIED,
      'kein Zugriff',
      ErrorSeverity.ERROR
    );
    log.critical('Abbruch', appFehler);

    const ausgaben = konsole.error.mock.calls.map(c => String(c[0]));
    expect(ausgaben.some(a => a.includes('Abbruch'))).toBe(true);
  });

  it('gibt Metadaten separat aus', () => {
    const log = frischerLogger({ logLevel: LogLevel.DEBUG, enableStructuredLogging: false });
    log.info('mit Daten', {}, { schichtId: 's1' });
    expect(konsole.log).toHaveBeenCalledWith('Metadata:', { schichtId: 's1' });
  });
});

describe('Kontext-Formatierung', () => {
  it('stellt Komponente, Aktion, Route und Nutzer voran', () => {
    const log = frischerLogger({ logLevel: LogLevel.DEBUG, enableStructuredLogging: false });
    log.info('Nachricht', {
      component: 'Dienstplan',
      action: 'laden',
      route: '/schedule',
      userId: 'u1',
    });

    const ausgabe = String(konsole.info.mock.calls[0][0]);
    expect(ausgabe).toContain('[Dienstplan]');
    expect(ausgabe).toContain('(laden)');
    expect(ausgabe).toContain('route:/schedule');
    expect(ausgabe).toContain('user:u1');
  });
});

describe('erwartete Firestore-Warnungen', () => {
  it('unterdrückt die Schicht-Berechtigungswarnung in beiden Ausgaben', () => {
    const log = frischerLogger({ logLevel: LogLevel.DEBUG, enableStructuredLogging: true });
    log.warn('Firestore access denied for shifts, likely due to security rules');

    expect(konsole.warn).not.toHaveBeenCalled();
    // auch keine JSON-Zeile
    const jsonZeilen = konsole.log.mock.calls.filter(c => String(c[0]).startsWith('{'));
    expect(jsonZeilen).toHaveLength(0);
  });

  it('lässt andere Warnungen unverändert durch', () => {
    const log = frischerLogger({ logLevel: LogLevel.DEBUG, enableStructuredLogging: false });
    log.warn('Firestore access denied for timesheets');
    expect(konsole.warn).toHaveBeenCalled();
  });
});

describe('strukturierte Ausgabe und Fehlerberichte', () => {
  it('schreibt eine JSON-Zeile mit Zeitstempel und Umgebung', () => {
    const log = frischerLogger({
      logLevel: LogLevel.DEBUG,
      enableConsoleLogging: false,
      enableStructuredLogging: true,
    });
    log.info('strukturiert', { userId: 'u1' });

    const zeile = konsole.log.mock.calls.map(c => String(c[0])).find(a => a.startsWith('{'));
    expect(zeile).toBeTruthy();
    const daten = JSON.parse(zeile!);
    expect(daten).toMatchObject({ level: 'info', message: 'strukturiert' });
    expect(daten.context.userId).toBe('u1');
    expect(typeof daten.timestamp).toBe('string');
  });

  it('meldet kritische Fehler an die Fehlerberichterstattung', () => {
    const log = frischerLogger({
      logLevel: LogLevel.DEBUG,
      enableConsoleLogging: false,
      enableStructuredLogging: false,
      enableErrorReporting: true,
    });
    log.critical('Systemausfall', new Error('down'));

    expect(konsole.error).toHaveBeenCalledWith('CRITICAL ERROR REPORT:', expect.any(Object));
  });

  it('berichtet einfache Fehler NICHT als kritisch', () => {
    const log = frischerLogger({
      logLevel: LogLevel.DEBUG,
      enableConsoleLogging: false,
      enableStructuredLogging: false,
      enableErrorReporting: true,
    });
    log.error('nur ein Fehler', new Error('x'));

    const berichte = konsole.error.mock.calls.filter(c => c[0] === 'CRITICAL ERROR REPORT:');
    expect(berichte).toHaveLength(0);
  });
});

describe('Spezial-Logs', () => {
  it('protokolliert Laufzeiten nur bei aktivierter Performance-Messung', () => {
    const aus = frischerLogger({
      logLevel: LogLevel.DEBUG,
      enableStructuredLogging: false,
      enablePerformanceLogging: false,
    });
    aus.performance('laden', 120);
    expect(konsole.info).not.toHaveBeenCalled();

    const an = frischerLogger({
      logLevel: LogLevel.DEBUG,
      enableStructuredLogging: false,
      enablePerformanceLogging: true,
    });
    an.performance('laden', 120);
    expect(konsole.info).toHaveBeenCalledWith(expect.stringContaining('Performance: laden'));
  });

  it('protokolliert Nutzeraktionen', () => {
    const log = frischerLogger({ logLevel: LogLevel.DEBUG, enableStructuredLogging: false });
    log.userAction('Schicht angenommen', { userId: 'u1' });
    expect(konsole.info).toHaveBeenCalledWith(expect.stringContaining('User Action'));
  });

  it('protokolliert API-Aufrufe je nach Status als Info oder Fehler', () => {
    const log = frischerLogger({ logLevel: LogLevel.DEBUG, enableStructuredLogging: false });

    log.apiRequest('GET', '/api/shifts', 200, 42);
    expect(konsole.info).toHaveBeenCalledWith(expect.stringContaining('API GET /api/shifts'));

    log.apiRequest('POST', '/api/shifts', 500, 42);
    expect(konsole.error).toHaveBeenCalledWith(expect.stringContaining('API POST /api/shifts'));
  });
});

describe('Komponenten-Logger und LogUtils', () => {
  it('ergänzt den Komponentennamen in allen Stufen', () => {
    const log = frischerLogger({ logLevel: LogLevel.DEBUG, enableStructuredLogging: false });
    const komponente = log.createComponentLogger('Stempeluhr');

    komponente.debug('d');
    komponente.info('i');
    komponente.warn('w');
    komponente.error('e', new Error('x'));
    komponente.critical('c');
    komponente.userAction('eingestempelt');

    expect(String(konsole.debug.mock.calls[0][0])).toContain('[Stempeluhr]');
    expect(String(konsole.warn.mock.calls[0][0])).toContain('[Stempeluhr]');
  });

  it('erzeugt Routen-, Service- und Komponenten-Logger', () => {
    frischerLogger({ logLevel: LogLevel.DEBUG, enableStructuredLogging: false });

    LogUtils.createRouteLogger('api/zeiten').info('route');
    LogUtils.createServiceLogger('zeiten').info('service');
    LogUtils.createComponentLogger('Karte').info('komponente');

    const ausgaben = konsole.info.mock.calls.map(c => String(c[0]));
    expect(ausgaben.some(a => a.includes('[route:api/zeiten]'))).toBe(true);
    expect(ausgaben.some(a => a.includes('[service:zeiten]'))).toBe(true);
    expect(ausgaben.some(a => a.includes('[Karte]'))).toBe(true);
  });

  it('gibt das Ergebnis durch und meldet Fehler weiter', async () => {
    // LogUtils nutzt die globale Logger-Instanz (Laufzeit-Logs sind außerhalb
    // der Entwicklungsumgebung bewusst abgeschaltet).
    await expect(LogUtils.logExecutionTime('laden', async () => 'ok')).resolves.toBe('ok');

    await expect(
      LogUtils.logExecutionTime('laden', async () => {
        throw new Error('kaputt');
      })
    ).rejects.toThrow('kaputt');
    expect(konsole.error).toHaveBeenCalledWith(expect.stringContaining('Failed: laden'));
  });
});
