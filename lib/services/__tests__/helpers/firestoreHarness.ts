import { vi } from 'vitest';

/**
 * Gemeinsames Mock-Gerüst für Firestore-basierte Services.
 *
 * Die meisten Services in lib/services folgen demselben Muster
 * (query → getDocs → mapDoc, addDoc/updateDoc/deleteDoc). Statt das Mocking in
 * jeder Testdatei zu wiederholen, wird es hier einmal aufgebaut.
 *
 * Verwendung in der Testdatei:
 *
 *   vi.mock('firebase/firestore', async () => (await import('./helpers/firestoreHarness')).firestoreModuleMock());
 *   import { harness } from './helpers/firestoreHarness';
 */

export interface MockDoc {
  id: string;
  data: Record<string, unknown>;
}

export interface AufgezeichneteQuery {
  constraints: Array<{ art: string; args: unknown[] }>;
}

class FirestoreHarness {
  /** Antworten für aufeinanderfolgende getDocs-Aufrufe. */
  private antworten: MockDoc[][] = [];
  private antwortIndex = 0;
  /** Antwort für getDoc (Einzeldokument). */
  private einzelDoc: MockDoc | null = null;
  /** Aufgezeichnete Query-Constraints. */
  queries: AufgezeichneteQuery[] = [];
  /** Aufgezeichnete Schreibzugriffe. */
  writes: Array<{ art: 'add' | 'set' | 'update' | 'delete'; ziel: unknown; daten?: unknown }> = [];
  /** Fehler, den der nächste getDocs-Aufruf werfen soll. */
  naechsterFehler: Error | null = null;
  /** Zähler für getCountFromServer. */
  count = 0;

  reset(): void {
    this.antworten = [];
    this.antwortIndex = 0;
    this.einzelDoc = null;
    this.queries = [];
    this.writes = [];
    this.naechsterFehler = null;
    this.count = 0;
  }

  /** Legt die Antwort(en) für kommende getDocs-Aufrufe fest. */
  setDocs(...seiten: MockDoc[][]): void {
    this.antworten = seiten;
    this.antwortIndex = 0;
  }

  /** Legt das Ergebnis für getDoc fest (null = existiert nicht). */
  setDoc(doc: MockDoc | null): void {
    this.einzelDoc = doc;
  }

  naechsteAntwort(): MockDoc[] {
    const seite = this.antworten[this.antwortIndex] ?? this.antworten[0] ?? [];
    if (this.antwortIndex < this.antworten.length - 1) this.antwortIndex++;
    return seite;
  }

  aktuellesEinzelDoc(): MockDoc | null {
    return this.einzelDoc;
  }

  /** Constraints aller aufgezeichneten Queries flach. */
  alleConstraints(): Array<{ art: string; args: unknown[] }> {
    return this.queries.flatMap(q => q.constraints);
  }

  /** true, wenn irgendeine Query ein where(feld, op, wert) gesetzt hat. */
  hatWhere(feld: string, wert?: unknown): boolean {
    return this.alleConstraints().some(
      c => c.art === 'where' && c.args[0] === feld && (wert === undefined || c.args[2] === wert)
    );
  }
}

export const harness = new FirestoreHarness();

const snapshotAus = (docs: MockDoc[]) => ({
  docs: docs.map(d => ({
    id: d.id,
    ref: { id: d.id },
    exists: () => true,
    data: () => d.data,
  })),
  empty: docs.length === 0,
  size: docs.length,
  forEach(cb: (d: unknown) => void) {
    this.docs.forEach(cb);
  },
});

/** Modul-Mock für 'firebase/firestore'. */
export function firestoreModuleMock() {
  const constraint = (art: string) => (...args: unknown[]) => ({ art, args });
  return {
    collection: vi.fn((_db: unknown, ...pfad: string[]) => ({ typ: 'collection', pfad })),
    doc: vi.fn((_db: unknown, ...pfad: string[]) => ({ typ: 'doc', pfad, id: pfad[pfad.length - 1] })),
    query: vi.fn((_base: unknown, ...constraints: Array<{ art: string; args: unknown[] }>) => {
      harness.queries.push({ constraints });
      return { typ: 'query', constraints };
    }),
    where: constraint('where'),
    orderBy: constraint('orderBy'),
    limit: constraint('limit'),
    startAfter: constraint('startAfter'),
    startAt: constraint('startAt'),
    endAt: constraint('endAt'),
    getDocs: vi.fn(async () => {
      if (harness.naechsterFehler) {
        const fehler = harness.naechsterFehler;
        harness.naechsterFehler = null;
        throw fehler;
      }
      return snapshotAus(harness.naechsteAntwort());
    }),
    getDoc: vi.fn(async () => {
      const doc = harness.aktuellesEinzelDoc();
      return {
        exists: () => doc !== null,
        id: doc?.id ?? 'unbekannt',
        ref: { id: doc?.id ?? 'unbekannt' },
        data: () => doc?.data,
        get: (feld: string) => doc?.data?.[feld],
      };
    }),
    getCountFromServer: vi.fn(async () => ({ data: () => ({ count: harness.count }) })),
    addDoc: vi.fn(async (ziel: unknown, daten: unknown) => {
      harness.writes.push({ art: 'add', ziel, daten });
      return { id: 'neu1' };
    }),
    setDoc: vi.fn(async (ziel: unknown, daten: unknown) => {
      harness.writes.push({ art: 'set', ziel, daten });
    }),
    updateDoc: vi.fn(async (ziel: unknown, daten: unknown) => {
      harness.writes.push({ art: 'update', ziel, daten });
    }),
    deleteDoc: vi.fn(async (ziel: unknown) => {
      harness.writes.push({ art: 'delete', ziel });
    }),
    writeBatch: vi.fn(() => ({
      update: (ziel: unknown, daten: unknown) => harness.writes.push({ art: 'update', ziel, daten }),
      delete: (ziel: unknown) => harness.writes.push({ art: 'delete', ziel }),
      set: (ziel: unknown, daten: unknown) => harness.writes.push({ art: 'set', ziel, daten }),
      commit: vi.fn(async () => undefined),
    })),
    runTransaction: vi.fn(async (_db: unknown, fn: (t: unknown) => Promise<unknown>) =>
      fn({
        get: async () => {
          const doc = harness.aktuellesEinzelDoc();
          return { exists: () => doc !== null, id: doc?.id, data: () => doc?.data };
        },
        set: (ziel: unknown, daten: unknown) => harness.writes.push({ art: 'set', ziel, daten }),
        update: (ziel: unknown, daten: unknown) => harness.writes.push({ art: 'update', ziel, daten }),
        delete: (ziel: unknown) => harness.writes.push({ art: 'delete', ziel }),
      })
    ),
    onSnapshot: vi.fn(() => () => undefined),
    serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
    Timestamp: {
      fromDate: (d: Date) => ({ toDate: () => d }),
      now: () => ({ toDate: () => new Date() }),
    },
    arrayUnion: vi.fn((...werte: unknown[]) => ({ arrayUnion: werte })),
    arrayRemove: vi.fn((...werte: unknown[]) => ({ arrayRemove: werte })),
    increment: vi.fn((n: number) => ({ increment: n })),
    documentId: vi.fn(() => '__name__'),
  };
}

/** Firestore-Timestamp-Attrappe für Testdaten. */
export const ts = (date: Date) => ({ toDate: () => date });
