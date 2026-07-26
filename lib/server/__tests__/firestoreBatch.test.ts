import { describe, it, expect, vi } from 'vitest';
import { ChunkedBatch } from '../firestoreBatch';

/**
 * Firestore begrenzt einen Batch hart auf 500 Operationen. Bei der
 * DSGVO-Löschung eines langjährigen Mitarbeiters wurde diese Grenze gerissen –
 * der commit() schlug fehl und es wurde NICHTS gelöscht.
 */

interface BatchAufruf {
  deletes: unknown[];
  updates: Array<{ ref: unknown; daten: unknown }>;
  committed: boolean;
}

const createDbMock = () => {
  const batches: BatchAufruf[] = [];
  const db = {
    batch: vi.fn(() => {
      const aufruf: BatchAufruf = { deletes: [], updates: [], committed: false };
      batches.push(aufruf);
      return {
        delete: (ref: unknown) => aufruf.deletes.push(ref),
        update: (ref: unknown, daten: unknown) => aufruf.updates.push({ ref, daten }),
        commit: async () => {
          aufruf.committed = true;
        },
      };
    }),
  };
  return { db, batches };
};

const ref = (id: number) => ({ id: `doc${id}` });

describe('ChunkedBatch', () => {
  it('committet nichts, wenn keine Operationen vorgemerkt sind', async () => {
    const { db, batches } = createDbMock();
    const batch = new ChunkedBatch(db as never);
    expect(batch.size).toBe(0);
    expect(await batch.commit()).toBe(0);
    expect(batches).toHaveLength(0);
  });

  it('schreibt eine kleine Menge in einem einzigen Batch', async () => {
    const { db, batches } = createDbMock();
    const batch = new ChunkedBatch(db as never);
    batch.delete(ref(1));
    batch.update(ref(2), { anonymized: true });

    expect(batch.size).toBe(2);
    expect(await batch.commit()).toBe(2);
    expect(batches).toHaveLength(1);
    expect(batches[0].deletes).toHaveLength(1);
    expect(batches[0].updates).toHaveLength(1);
    expect(batches[0].committed).toBe(true);
  });

  it('teilt mehr als 450 Operationen auf mehrere Batches auf', async () => {
    const { db, batches } = createDbMock();
    const batch = new ChunkedBatch(db as never);
    for (let i = 0; i < 1000; i++) batch.delete(ref(i));

    expect(await batch.commit()).toBe(1000);
    expect(batches).toHaveLength(3); // 450 + 450 + 100
    expect(batches[0].deletes).toHaveLength(450);
    expect(batches[1].deletes).toHaveLength(450);
    expect(batches[2].deletes).toHaveLength(100);
    expect(batches.every(b => b.committed)).toBe(true);
  });

  it('überschreitet nie das harte Limit von 500', async () => {
    const { db, batches } = createDbMock();
    const batch = new ChunkedBatch(db as never);
    for (let i = 0; i < 2000; i++) batch.update(ref(i), { deleted: true });
    await batch.commit();

    for (const b of batches) {
      expect(b.deletes.length + b.updates.length).toBeLessThanOrEqual(500);
    }
  });

  it('behält die Reihenfolge über Batch-Grenzen hinweg', async () => {
    const { db, batches } = createDbMock();
    const batch = new ChunkedBatch(db as never);
    for (let i = 0; i < 460; i++) batch.delete(ref(i));
    await batch.commit();

    expect((batches[0].deletes[0] as { id: string }).id).toBe('doc0');
    expect((batches[0].deletes[449] as { id: string }).id).toBe('doc449');
    expect((batches[1].deletes[0] as { id: string }).id).toBe('doc450');
  });

  it('setzt die Sammlung nach dem Commit zurück', async () => {
    const { db, batches } = createDbMock();
    const batch = new ChunkedBatch(db as never);
    batch.delete(ref(1));
    await batch.commit();
    expect(batch.size).toBe(0);

    expect(await batch.commit()).toBe(0);
    expect(batches).toHaveLength(1);
  });

  it('mischt Löschungen und Aktualisierungen in derselben Reihenfolge', async () => {
    const { db, batches } = createDbMock();
    const batch = new ChunkedBatch(db as never);
    batch.update(ref(1), { anonymized: true });
    batch.delete(ref(2));
    batch.update(ref(3), { deleted: true });
    await batch.commit();

    expect(batches[0].updates).toHaveLength(2);
    expect(batches[0].deletes).toHaveLength(1);
  });
});
