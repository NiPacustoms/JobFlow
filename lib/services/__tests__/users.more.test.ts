import { beforeEach, describe, expect, it, vi } from 'vitest';
import { harness, firestoreModuleMock, ts } from './helpers/firestoreHarness';

/**
 * Weitere Mitarbeiter-Funktionen: Löschen über die API-Route (löscht auch das
 * Auth-Konto), Namenssuche, Gruppen-/Statusfilter und der Token-Refresh, wenn
 * die companyId im Token noch fehlt.
 */

const authZustand = vi.hoisted(() => ({
  currentUser: null as null | { uid: string; getIdToken: () => Promise<string> },
}));

vi.mock('@/lib/firebase', () => ({
  db: {},
  getDb: vi.fn(() => ({})),
  auth: {
    get currentUser() {
      return authZustand.currentUser;
    },
  },
}));

const getCompanyIdFromAuth = vi.fn();
const refreshTokenAndGetCompanyId = vi.fn();
vi.mock('@/lib/utils/companyId', () => ({
  getCompanyIdFromAuth: (...a: unknown[]) => getCompanyIdFromAuth(...a),
  refreshTokenAndGetCompanyId: (...a: unknown[]) => refreshTokenAndGetCompanyId(...a),
}));

vi.mock('firebase/firestore', () => firestoreModuleMock());

const lade = async () => (await import('../users')).userService;

const nutzer = (id: string, daten: Record<string, unknown> = {}) => ({
  id,
  data: {
    email: `${id}@aufabruf.eu`,
    displayName: `Person ${id}`,
    role: 'nurse',
    companyId: 'firmaA',
    active: true,
    createdAt: ts(new Date(2026, 6, 18)),
    updatedAt: ts(new Date(2026, 6, 18)),
    ...daten,
  },
});

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  harness.reset();
  authZustand.currentUser = { uid: 'admin1', getIdToken: async () => 'token-123' };
  getCompanyIdFromAuth.mockResolvedValue('firmaA');
  refreshTokenAndGetCompanyId.mockResolvedValue('firmaA');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
});

describe('delete', () => {
  it('löscht über die API-Route mit Bearer-Token', async () => {
    const service = await lade();
    await service.delete('u9');

    expect(fetchMock).toHaveBeenCalledWith('/api/users/u9', {
      method: 'DELETE',
      headers: expect.objectContaining({ Authorization: 'Bearer token-123' }),
    });
  });

  it('verlangt einen angemeldeten Benutzer', async () => {
    authZustand.currentUser = null;
    const service = await lade();
    await expect(service.delete('u9')).rejects.toThrow('must be authenticated');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('meldet HTTP-Fehler der API', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ message: 'Keine Berechtigung' }),
    });
    const service = await lade();
    await expect(service.delete('u9')).rejects.toThrow('Keine Berechtigung');
  });

  it('meldet HTTP-Status, wenn die API keine Meldung liefert', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error('kein JSON');
      },
    });
    const service = await lade();
    await expect(service.delete('u9')).rejects.toThrow('HTTP 500');
  });

  it('meldet einen fachlichen Fehlschlag trotz HTTP 200', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: false, message: 'Nutzer ist letzter Admin' }),
    });
    const service = await lade();
    await expect(service.delete('u9')).rejects.toThrow('letzter Admin');
  });
});

describe('getAll – Filter und Suche', () => {
  it('sucht per Namenspräfix und liefert die erste Seite', async () => {
    harness.setDocs([nutzer('u1', { displayName: 'Anna Muster' })]);
    harness.count = 1;
    const service = await lade();

    const seite = await service.getAll(1, 50, { search: 'Anna' });
    expect(seite.data).toHaveLength(1);
    expect(seite.data[0].displayName).toBe('Anna Muster');
    expect(seite.total).toBe(1);
  });

  it('filtert nach Gruppe und Status', async () => {
    harness.setDocs([nutzer('u1', { group: 'Frühdienst' })]);
    harness.count = 1;
    const service = await lade();

    await service.getAll(1, 50, { group: 'Frühdienst', status: 'active' });
    expect(harness.hatWhere('group', 'Frühdienst')).toBe(true);
    expect(harness.hatWhere('active', true)).toBe(true);
  });

  it('ignoriert "all" als Filterwert', async () => {
    harness.setDocs([nutzer('u1')]);
    harness.count = 1;
    const service = await lade();

    await service.getAll(1, 50, { role: 'all', status: 'all', group: 'all' });
    expect(harness.hatWhere('role', 'all')).toBe(false);
    expect(harness.hatWhere('companyId', 'firmaA')).toBe(true);
  });

  it('akzeptiert active als booleschen Kurzfilter', async () => {
    harness.setDocs([nutzer('u1')]);
    harness.count = 1;
    const service = await lade();

    await service.getAll(1, 50, { active: false });
    expect(harness.hatWhere('active', false)).toBe(true);
  });

  it('erneuert das Token, wenn die companyId im Token fehlt', async () => {
    getCompanyIdFromAuth.mockResolvedValue(null);
    refreshTokenAndGetCompanyId.mockResolvedValue('firmaNachRefresh');
    harness.setDocs([nutzer('u1')]);
    harness.count = 1;
    const service = await lade();

    const seite = await service.getAll(1, 50);
    expect(refreshTokenAndGetCompanyId).toHaveBeenCalled();
    expect(harness.hatWhere('companyId', 'firmaNachRefresh')).toBe(true);
    expect(seite.data).toHaveLength(1);
  });

  it('liefert ohne companyId eine leere Seite statt fremder Daten', async () => {
    getCompanyIdFromAuth.mockResolvedValue(null);
    refreshTokenAndGetCompanyId.mockResolvedValue(null);
    const service = await lade();

    await expect(service.getAll(1, 50)).resolves.toEqual({
      data: [],
      total: 0,
      page: 1,
      limit: 50,
      hasMore: false,
    });
  });
});
