import type { firestore } from 'firebase-admin';

/**
 * Firestore-Batches sind hart auf 500 Operationen begrenzt. Ein einzelner
 * batch.commit() über alle Dokumente eines Mitarbeiters (Timesheets,
 * Assignments, Dokumente, Benachrichtigungen …) scheitert deshalb bei
 * langjährigen Konten komplett – die DSGVO-Löschung lief dann in einen Fehler
 * und es wurde NICHTS gelöscht.
 *
 * Dieser Helfer sammelt Operationen und committet sie in Blöcken.
 */
const MAX_OPS_PER_BATCH = 450; // Sicherheitsabstand zum harten Limit von 500

type BatchOperation =
  | { art: 'delete'; ref: firestore.DocumentReference }
  | { art: 'update'; ref: firestore.DocumentReference; daten: firestore.UpdateData<firestore.DocumentData> };

export class ChunkedBatch {
  private operationen: BatchOperation[] = [];

  constructor(private readonly db: firestore.Firestore) {}

  delete(ref: firestore.DocumentReference): void {
    this.operationen.push({ art: 'delete', ref });
  }

  update(ref: firestore.DocumentReference, daten: firestore.UpdateData<firestore.DocumentData>): void {
    this.operationen.push({ art: 'update', ref, daten });
  }

  /** Anzahl vorgemerkter Operationen. */
  get size(): number {
    return this.operationen.length;
  }

  /**
   * Committet alle vorgemerkten Operationen in Blöcken zu je 450.
   * Gibt die Anzahl geschriebener Operationen zurück.
   */
  async commit(): Promise<number> {
    let geschrieben = 0;
    for (let i = 0; i < this.operationen.length; i += MAX_OPS_PER_BATCH) {
      const block = this.operationen.slice(i, i + MAX_OPS_PER_BATCH);
      const batch = this.db.batch();
      for (const op of block) {
        if (op.art === 'delete') batch.delete(op.ref);
        else batch.update(op.ref, op.daten);
      }
      await batch.commit();
      geschrieben += block.length;
    }
    this.operationen = [];
    return geschrieben;
  }
}
