import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * IndexedDB-Persistenz der Offline-Queue. Sie entscheidet, ob eine ohne Netz
 * erfasste Schicht einen Browser-Neustart übersteht – Datenverlust wäre hier
 * ein Verstoß gegen die Nachweispflicht.
 *
 * jsdom bringt keine IndexedDB mit; hier steht ein schlanker Stub, der die
 * genutzten Aufrufe (getAll/add/delete/clear/get/put) nachbildet.
 */

type Datensatz = Record<string, unknown> & { id: string };

class AnfrageStub<T> {
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  result: T | undefined;
  error: Error | null = null;

  /** Löst die Anfrage im nächsten Microtask aus, wie der Browser. */
  ausfuehren(wert: T | undefined, fehler: Error | null = null): void {
    queueMicrotask(() => {
      if (fehler) {
        this.error = fehler;
        this.onerror?.();
      } else {
        this.result = wert;
        this.onsuccess?.();
      }
    });
  }
}

class StoreStub {
  constructor(
    private daten: Map<string, Datensatz>,
    private fehlerBei: Set<string>
  ) {}

  private anfrage<T>(art: string, wert: T | undefined): AnfrageStub<T> {
    const req = new AnfrageStub<T>();
    req.ausfuehren(wert, this.fehlerBei.has(art) ? new Error(`${art} fehlgeschlagen`) : null);
    return req;
  }

  getAll() {
    return this.anfrage('getAll', [...this.daten.values()]);
  }

  add(item: Datensatz) {
    if (!this.fehlerBei.has('add')) this.daten.set(item.id, item);
    return this.anfrage<undefined>('add', undefined);
  }

  put(item: Datensatz) {
    if (!this.fehlerBei.has('put')) this.daten.set(item.id, item);
    return this.anfrage<undefined>('put', undefined);
  }

  delete(id: string) {
    if (!this.fehlerBei.has('delete')) this.daten.delete(id);
    return this.anfrage<undefined>('delete', undefined);
  }

  clear() {
    if (!this.fehlerBei.has('clear')) this.daten.clear();
    return this.anfrage<undefined>('clear', undefined);
  }

  get(id: string) {
    return this.anfrage('get', this.daten.get(id));
  }
}

const zustand = {
  daten: new Map<string, Datensatz>(),
  fehlerBei: new Set<string>(),
  geschlossen: 0,
  verfuegbar: true,
  oeffnenSchlaegtFehl: false,
};

const indexedDbStub = {
  open: () => {
    const req = new AnfrageStub<unknown>();
    const db = {
      objectStoreNames: { contains: () => true },
      transaction: () => {
        const tx: { objectStore: () => StoreStub; oncomplete: (() => void) | null } = {
          objectStore: () => new StoreStub(zustand.daten, zustand.fehlerBei),
          oncomplete: null,
        };
        // Transaktionsabschluss nach den Anfragen melden
        queueMicrotask(() => queueMicrotask(() => tx.oncomplete?.()));
        return tx;
      },
      close: () => {
        zustand.geschlossen += 1;
      },
    };
    req.ausfuehren(db, zustand.oeffnenSchlaegtFehl ? new Error('DB blockiert') : null);
    return req;
  },
};

import {
  getAllQueueItems,
  addQueueItem,
  removeQueueItem,
  clearQueue,
  updateQueueItem,
  type StoredQueueItem,
} from '../offlineStorage';

const eintrag = (id: string, overrides: Partial<StoredQueueItem> = {}): StoredQueueItem => ({
  id,
  type: 'timesheet',
  action: 'create',
  data: { startTime: '06:00' },
  timestamp: 1_770_000_000_000,
  retries: 0,
  ...overrides,
});

beforeEach(() => {
  zustand.daten = new Map();
  zustand.fehlerBei = new Set();
  zustand.geschlossen = 0;
  zustand.oeffnenSchlaegtFehl = false;
  zustand.verfuegbar = true;
  Object.defineProperty(window, 'indexedDB', {
    get: () => (zustand.verfuegbar ? indexedDbStub : undefined),
    configurable: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Warteschlange lesen und schreiben', () => {
  it('legt Einträge an und liest sie wieder', async () => {
    await addQueueItem(eintrag('q1'));
    await addQueueItem(eintrag('q2', { action: 'update' }));

    const eintraege = await getAllQueueItems();
    expect(eintraege.map(e => e.id)).toEqual(['q1', 'q2']);
    expect(eintraege[1].action).toBe('update');
  });

  it('liefert eine leere Liste, wenn nichts gespeichert ist', async () => {
    await expect(getAllQueueItems()).resolves.toEqual([]);
  });

  it('entfernt einen Eintrag', async () => {
    await addQueueItem(eintrag('q1'));
    await addQueueItem(eintrag('q2'));
    await removeQueueItem('q1');

    const eintraege = await getAllQueueItems();
    expect(eintraege.map(e => e.id)).toEqual(['q2']);
  });

  it('leert die Warteschlange vollständig', async () => {
    await addQueueItem(eintrag('q1'));
    await clearQueue();
    await expect(getAllQueueItems()).resolves.toEqual([]);
  });

  it('schließt die Datenbankverbindung nach jedem Zugriff', async () => {
    await addQueueItem(eintrag('q1'));
    await getAllQueueItems();
    expect(zustand.geschlossen).toBeGreaterThanOrEqual(2);
  });
});

describe('updateQueueItem', () => {
  it('erhöht den Wiederholungszähler und merkt den Fehler', async () => {
    await addQueueItem(eintrag('q1'));
    await updateQueueItem('q1', { retries: 2, lastError: 'offline' });

    const [gespeichert] = await getAllQueueItems();
    expect(gespeichert).toMatchObject({ retries: 2, lastError: 'offline' });
    // Die Nutzdaten bleiben unangetastet
    expect(gespeichert.data).toEqual({ startTime: '06:00' });
  });

  it('markiert einen Eintrag als endgültig fehlgeschlagen, ohne ihn zu löschen', async () => {
    await addQueueItem(eintrag('q1', { retries: 3 }));
    await updateQueueItem('q1', { failed: true, lastError: 'Rules verweigern' });

    const [gespeichert] = await getAllQueueItems();
    expect(gespeichert.failed).toBe(true);
    expect(gespeichert.id).toBe('q1');
  });

  it('tut nichts, wenn der Eintrag nicht mehr existiert', async () => {
    await expect(updateQueueItem('weg', { retries: 1 })).resolves.toBeUndefined();
  });
});

describe('Fehlerfälle', () => {
  it('scheitert ohne IndexedDB im Browser', async () => {
    zustand.verfuegbar = false;
    await expect(getAllQueueItems()).rejects.toThrow('IndexedDB not available');
  });

  it('meldet einen Fehler beim Öffnen der Datenbank', async () => {
    zustand.oeffnenSchlaegtFehl = true;
    await expect(addQueueItem(eintrag('q1'))).rejects.toThrow('DB blockiert');
  });

  it('meldet Fehler der einzelnen Zugriffe', async () => {
    zustand.fehlerBei = new Set(['getAll']);
    await expect(getAllQueueItems()).rejects.toThrow('getAll fehlgeschlagen');

    zustand.fehlerBei = new Set(['add']);
    await expect(addQueueItem(eintrag('q1'))).rejects.toThrow('add fehlgeschlagen');

    zustand.fehlerBei = new Set(['delete']);
    await expect(removeQueueItem('q1')).rejects.toThrow('delete fehlgeschlagen');

    zustand.fehlerBei = new Set(['clear']);
    await expect(clearQueue()).rejects.toThrow('clear fehlgeschlagen');
  });

  it('meldet Fehler beim Lesen und Schreiben einer Aktualisierung', async () => {
    zustand.fehlerBei = new Set(['get']);
    await expect(updateQueueItem('q1', { retries: 1 })).rejects.toThrow('get fehlgeschlagen');

    zustand.fehlerBei = new Set();
    await addQueueItem(eintrag('q1'));
    zustand.fehlerBei = new Set(['put']);
    await expect(updateQueueItem('q1', { retries: 1 })).rejects.toThrow('put fehlgeschlagen');
  });
});
