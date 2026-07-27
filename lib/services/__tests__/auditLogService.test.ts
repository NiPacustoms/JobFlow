import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Audit-Log (GoBD/DSGVO-Nachvollziehbarkeit): Schreiben über die API-Route mit
 * Company-Auflösung und Datenbereinigung sowie Echtzeit-Abo für die Anzeige.
 */

const zustand = vi.hoisted(() => ({
  currentUser: null as null | {
    uid: string;
    getIdToken: () => Promise<string>;
    getIdTokenResult: () => Promise<{ claims: Record<string, unknown> }>;
  },
  db: {} as unknown,
}));

vi.mock('@/lib/firebase', () => ({
  auth: {
    get currentUser() {
      return zustand.currentUser;
    },
  },
  getDb: () => zustand.db,
}));

const getCompanyIdFromAuth = vi.fn();
vi.mock('@/lib/utils/companyId', () => ({
  getCompanyIdFromAuth: (...a: unknown[]) => getCompanyIdFromAuth(...a),
}));

const loggerError = vi.fn();
const loggerWarn = vi.fn();
vi.mock('@/lib/logging', () => ({
  logger: {
    error: (...a: unknown[]) => loggerError(...a),
    warn: (...a: unknown[]) => loggerWarn(...a),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

const onSnapshotMock = vi.fn();
const whereMock = vi.fn((feld: string, op: string, wert: unknown) => ({ feld, op, wert }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db: unknown, name: string) => ({ sammlung: name })),
  query: vi.fn((...teile: unknown[]) => ({ teile })),
  where: (...a: never[]) => whereMock(...a),
  orderBy: vi.fn(),
  limit: vi.fn(),
  onSnapshot: (...a: unknown[]) => onSnapshotMock(...a),
}));

import { writeAuditLog, subscribeAuditLogs } from '../auditLogService';

const fetchMock = vi.fn();

const angemeldet = (claims: Record<string, unknown> = {}) => {
  zustand.currentUser = {
    uid: 'admin1',
    getIdToken: async () => 'token-123',
    getIdTokenResult: async () => ({ claims }),
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  zustand.currentUser = null;
  zustand.db = {};
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
  getCompanyIdFromAuth.mockResolvedValue(null);
});

describe('writeAuditLog', () => {
  const eintrag = {
    actorUid: 'admin1',
    companyId: 'firmaA',
    action: 'facility.update',
    target: { collection: 'facilities', id: 'f1' },
  };

  it('überspringt das Log ohne angemeldeten Benutzer', async () => {
    await writeAuditLog(eintrag);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(loggerWarn).toHaveBeenCalled();
  });

  it('sendet den Eintrag mit Token an die Audit-API', async () => {
    angemeldet();
    await writeAuditLog(eintrag);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/audit/logs',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer token-123' }),
      })
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toMatchObject({ companyId: 'firmaA', actorUid: 'admin1' });
  });

  it('bereinigt Datumswerte, Timestamps und Funktionen im Vorher/Nachher', async () => {
    angemeldet();
    await writeAuditLog({
      ...eintrag,
      before: {
        datum: new Date('2026-07-27T10:00:00.000Z'),
        zeitstempel: { toDate: () => new Date('2026-07-26T09:00:00.000Z') },
        funktion: () => 'weg damit',
        liste: [new Date('2026-07-25T08:00:00.000Z'), 'text'],
        nichts: null,
      },
      after: { name: 'Haus Sonnenschein' },
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.before).toEqual({
      datum: '2026-07-27T10:00:00.000Z',
      zeitstempel: '2026-07-26T09:00:00.000Z',
      liste: ['2026-07-25T08:00:00.000Z', 'text'],
      nichts: null,
    });
    expect(body.after).toEqual({ name: 'Haus Sonnenschein' });
  });

  it('zieht die Company-ID aus den Token-Claims, wenn der Eintrag keine hat', async () => {
    angemeldet({ companyId: 'firmaClaims' });
    await writeAuditLog({ ...eintrag, companyId: 'unknown' });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.companyId).toBe('firmaClaims');
  });

  it('fragt als nächste Stufe den Auth-Helfer', async () => {
    angemeldet();
    getCompanyIdFromAuth.mockResolvedValue('firmaAuth');
    await writeAuditLog({ ...eintrag, companyId: 'unknown' });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.companyId).toBe('firmaAuth');
  });

  it('nutzt als letzte Stufe die Company-ID aus den Dokumentdaten', async () => {
    angemeldet();
    await writeAuditLog({
      ...eintrag,
      companyId: 'unknown',
      after: { companyId: ' firmaDoc ' },
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.companyId).toBe('firmaDoc');
  });

  it('überspringt das Log ohne auffindbare Company-ID', async () => {
    angemeldet();
    await writeAuditLog({ ...eintrag, companyId: 'unknown' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(loggerWarn).toHaveBeenCalled();
  });

  it('wirft bei API-Fehlern nicht, sondern protokolliert', async () => {
    angemeldet();
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ message: 'Wartung' }),
    });
    await expect(writeAuditLog(eintrag)).resolves.toBeUndefined();
    expect(loggerError).toHaveBeenCalled();
  });

  it('wirft auch bei Netzwerkfehlern nicht', async () => {
    angemeldet();
    fetchMock.mockRejectedValue(new Error('offline'));
    await expect(writeAuditLog(eintrag)).resolves.toBeUndefined();
    expect(loggerError).toHaveBeenCalled();
  });
});

describe('subscribeAuditLogs', () => {
  it('liefert ohne Firestore sofort eine leere Liste', () => {
    zustand.db = null;
    const callback = vi.fn();
    const unsub = subscribeAuditLogs(undefined, callback);
    expect(callback).toHaveBeenCalledWith([]);
    expect(() => unsub()).not.toThrow();
  });

  it('abonniert die Logs und reicht die Einträge durch', () => {
    const innererUnsub = vi.fn();
    onSnapshotMock.mockImplementation((_q, handler) => {
      handler({
        docs: [
          { id: 'l1', data: () => ({ action: 'shift.create', companyId: 'firmaA' }) },
        ],
      });
      return innererUnsub;
    });

    const callback = vi.fn();
    const unsub = subscribeAuditLogs({ limit: 10 }, callback);

    expect(callback).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'l1', action: 'shift.create' }),
    ]);
    expect(whereMock).not.toHaveBeenCalled();

    unsub();
    expect(innererUnsub).toHaveBeenCalled();
  });

  it('filtert auf Wunsch nach der Company', () => {
    onSnapshotMock.mockReturnValue(vi.fn());
    subscribeAuditLogs({ companyId: 'firmaA' }, vi.fn());
    expect(whereMock).toHaveBeenCalledWith('companyId', '==', 'firmaA');
  });
});
