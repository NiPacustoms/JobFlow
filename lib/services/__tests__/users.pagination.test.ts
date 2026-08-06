import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regressionstests zur seitenweisen Mitarbeiterliste.
 * Vorher lieferte jede Seite > 1 erneut Seite 1 (falsche Cursor-Variable) und
 * Zwischenabfragen liefen ohne limit() über die gesamte Collection.
 */

vi.mock('@/lib/firebase', () => ({
  db: {},
  getDb: vi.fn(() => ({})),
  auth: { currentUser: { uid: 'admin1' } },
}));

vi.mock('@/lib/utils/companyId', () => ({
  getCompanyIdFromAuth: vi.fn(() => Promise.resolve('company123')),
  refreshTokenAndGetCompanyId: vi.fn(() => Promise.resolve('company123')),
}));

/** Merkt sich pro Query, welche Constraints gesetzt wurden. */
interface QueryBeschreibung {
  constraints: Array<{ art: string; args: unknown[] }>;
}

const seiten: string[][] = [];
let abfragen: QueryBeschreibung[] = [];

vi.mock('firebase/firestore', () => {
  const constraint = (art: string) => (...args: unknown[]) => ({ art, args });
  return {
    collection: vi.fn(() => ({ typ: 'collection' })),
    doc: vi.fn(() => ({})),
    getDoc: vi.fn(),
    getDocs: vi.fn(),
    setDoc: vi.fn(),
    addDoc: vi.fn(),
    updateDoc: vi.fn(),
    deleteDoc: vi.fn(),
    serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
    getCountFromServer: vi.fn(async () => ({ data: () => ({ count: 7 }) })),
    query: vi.fn((_base: unknown, ...constraints: Array<{ art: string; args: unknown[] }>) => {
      const beschreibung: QueryBeschreibung = { constraints };
      abfragen.push(beschreibung);
      return beschreibung;
    }),
    where: constraint('where'),
    orderBy: constraint('orderBy'),
    limit: constraint('limit'),
    startAfter: constraint('startAfter'),
    startAt: constraint('startAt'),
    endAt: constraint('endAt'),
  };
});

const nutzerDoc = (id: string) => ({
  id,
  data: () => ({
    email: `${id}@aufabruf.eu`,
    displayName: id,
    role: 'nurse',
    active: true,
    companyId: 'company123',
  }),
});

describe('userService.getAll – Paginierung', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    abfragen = [];
    seiten.length = 0;
    const { getDocs } = await import('firebase/firestore');
    // Jede getDocs-Antwort entspricht der nächsten vorbereiteten Seite.
    let index = 0;
    vi.mocked(getDocs).mockImplementation(async () => {
      const ids = seiten[index] ?? [];
      index++;
      return { docs: ids.map(nutzerDoc), empty: ids.length === 0 } as never;
    });
  });

  const lade = async () => (await import('../users')).userService;

  it('liefert auf Seite 1 die erste Seite', async () => {
    seiten.push(['u1', 'u2', 'u3']);
    const userService = await lade();
    const result = await userService.getAll(1, 3, { companyId: 'company123' });
    expect(result.data.map(u => u.id)).toEqual(['u1', 'u2', 'u3']);
    expect(result.page).toBe(1);
    expect(result.total).toBe(7);
    expect(result.hasMore).toBe(true);
  });

  it('liefert auf Seite 2 die ZWEITE Seite, nicht erneut die erste', async () => {
    seiten.push(['u1', 'u2', 'u3']); // Cursor-Lauf für Seite 1
    seiten.push(['u4', 'u5', 'u6']); // eigentliche Seite 2
    const userService = await lade();
    const result = await userService.getAll(2, 3, { companyId: 'company123' });
    expect(result.data.map(u => u.id)).toEqual(['u4', 'u5', 'u6']);
    expect(result.page).toBe(2);
  });

  it('setzt für Seite 2 einen startAfter-Cursor', async () => {
    seiten.push(['u1', 'u2', 'u3']);
    seiten.push(['u4', 'u5', 'u6']);
    const userService = await lade();
    await userService.getAll(2, 3, { companyId: 'company123' });

    const mitCursor = abfragen.filter(a => a.constraints.some(c => c.art === 'startAfter'));
    expect(mitCursor.length).toBeGreaterThan(0);
  });

  it('begrenzt JEDE Zwischenabfrage mit limit()', async () => {
    seiten.push(['u1', 'u2', 'u3']);
    seiten.push(['u4', 'u5', 'u6']);
    seiten.push(['u7']);
    const userService = await lade();
    await userService.getAll(3, 3, { companyId: 'company123' });

    const datenAbfragen = abfragen.filter(a =>
      a.constraints.some(c => c.art === 'startAfter' || c.art === 'limit')
    );
    expect(datenAbfragen.length).toBeGreaterThan(0);
    for (const abfrage of datenAbfragen) {
      expect(abfrage.constraints.some(c => c.art === 'limit')).toBe(true);
    }
  });

  it('liefert eine leere Seite, wenn hinter dem Ende geblättert wird', async () => {
    seiten.push(['u1', 'u2']); // Seite 1 ist bereits unvollständig → kein weiterer Cursor
    const userService = await lade();
    const result = await userService.getAll(5, 3, { companyId: 'company123' });
    expect(result.data).toEqual([]);
    expect(result.hasMore).toBe(false);
  });

  it('meldet hasMore=false auf einer angebrochenen letzten Seite', async () => {
    seiten.push(['u1', 'u2', 'u3']);
    seiten.push(['u4', 'u5']);
    const userService = await lade();
    const result = await userService.getAll(2, 3, { companyId: 'company123' });
    expect(result.data).toHaveLength(2);
    expect(result.hasMore).toBe(false);
  });

  it('filtert serverseitig nach companyId', async () => {
    seiten.push(['u1']);
    const userService = await lade();
    await userService.getAll(1, 3, { companyId: 'company123' });
    const companyFilter = abfragen
      .flatMap(a => a.constraints)
      .filter(c => c.art === 'where' && c.args.includes('company123'));
    expect(companyFilter.length).toBeGreaterThan(0);
  });
});
