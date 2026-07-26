/**
 * Offline Queue Service für Zeiterfassung
 * Persistiert in IndexedDB, synchronisiert bei Online-Wiederkehr.
 * Sync-Status für UI: getPendingCount(), isSyncing(), notifySyncStatus().
 */

import { db, getDb } from '@/lib/firebase';
import { serverTimestamp } from 'firebase/firestore';
import { logger } from '@/lib/logging';
import { createAppError, ErrorCode } from '@/lib/errors';
import * as offlineStorage from './offlineStorage';

export const OFFLINE_SYNC_STATUS_EVENT = 'schichtklar-offline-sync-status';
const SYNC_STATUS_EVENT = OFFLINE_SYNC_STATUS_EVENT;

export interface OfflineQueueItem {
  id: string;
  /** Nur Typen, für die syncItem() tatsächlich eine Zuordnung kennt. */
  type: 'timesheet' | 'sick' | 'break' | 'timeEntry' | 'assignment';
  action: 'create' | 'update' | 'delete';
  data: Record<string, unknown>;
  timestamp: number;
  retries: number;
  /**
   * Nach erschöpften Versuchen bleibt der Eintrag als "failed" erhalten statt
   * gelöscht zu werden – sonst verschwinden erfasste Arbeitszeiten spurlos.
   */
  failed?: boolean;
  lastError?: string;
}

export type OfflineSyncStatus = 'idle' | 'syncing' | 'offline';

const MAX_RETRIES = 3;

/** Firestore-Collection je Queue-Typ. */
const COLLECTION_BY_TYPE: Record<OfflineQueueItem['type'], string> = {
  timesheet: 'timesheets',
  sick: 'times',
  break: 'times',
  timeEntry: 'times',
  assignment: 'assignments',
};

class OfflineQueueService {
  private queue: OfflineQueueItem[] = [];
  private failed: OfflineQueueItem[] = [];
  private syncing = false;

  constructor() {
    if (typeof window !== 'undefined') {
      this.loadQueue();
      this.setupOnlineListener();
    }
  }

  private notifyStatus(): void {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(SYNC_STATUS_EVENT, { detail: this.getStatus() }));
    }
  }

  private async loadQueue(): Promise<void> {
    try {
      const alle = (await offlineStorage.getAllQueueItems()) as OfflineQueueItem[];
      this.queue = alle.filter(item => !item.failed);
      this.failed = alle.filter(item => item.failed);
      this.notifyStatus();
      if (typeof navigator !== 'undefined' && navigator.onLine && this.queue.length > 0) {
        void this.syncQueue();
      }
    } catch (error) {
      logger.error('Error loading offline queue', error instanceof Error ? error : new Error(String(error)));
      this.queue = [];
      this.failed = [];
    }
  }

  private async persistItem(item: OfflineQueueItem): Promise<void> {
    try {
      await offlineStorage.addQueueItem(item);
    } catch (error) {
      logger.error('Error persisting queue item', error instanceof Error ? error : new Error(String(error)));
    }
  }

  private async removePersistedItem(id: string): Promise<void> {
    try {
      await offlineStorage.removeQueueItem(id);
    } catch (error) {
      logger.error('Error removing queue item', error instanceof Error ? error : new Error(String(error)));
    }
  }

  private async updatePersistedRetries(id: string, retries: number): Promise<void> {
    try {
      await offlineStorage.updateQueueItem(id, { retries });
    } catch (error) {
      logger.error('Error updating queue item retries', error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Markiert einen Eintrag nach erschöpften Versuchen als dauerhaft
   * fehlgeschlagen. Er bleibt in IndexedDB erhalten (Datenverlust wäre bei
   * Arbeitszeiten nicht hinnehmbar) und wird über getStatus() sichtbar.
   */
  private async markFailed(item: OfflineQueueItem, error: unknown): Promise<void> {
    const lastError = error instanceof Error ? error.message : String(error);
    item.failed = true;
    item.lastError = lastError;
    try {
      await offlineStorage.updateQueueItem(item.id, { failed: true, lastError });
    } catch (persistError) {
      logger.error('Error marking queue item as failed', persistError instanceof Error ? persistError : new Error(String(persistError)));
    }
    this.failed.push(item);
  }

  private setupOnlineListener(): void {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        this.syncQueue();
      });
    }
  }

  /**
   * Fügt ein Item zur Offline-Queue hinzu (persistiert in IndexedDB)
   */
  async addToQueue(
    type: OfflineQueueItem['type'],
    action: OfflineQueueItem['action'],
    data: Record<string, unknown>
  ): Promise<string> {
    const item: OfflineQueueItem = {
      id: `offline_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      action,
      data,
      timestamp: Date.now(),
      retries: 0,
    };

    this.queue.push(item);
    await this.persistItem(item);
    this.notifyStatus();

    if (navigator.onLine) {
      await this.syncQueue();
    }

    return item.id;
  }

  /** Anzahl ausstehender Einträge */
  getPendingCount(): number {
    return this.queue.length;
  }

  /** Anzahl dauerhaft fehlgeschlagener Einträge (bleiben lokal erhalten). */
  getFailedCount(): number {
    return this.failed.length;
  }

  /** Dauerhaft fehlgeschlagene Einträge (für Anzeige/Export). */
  getFailedItems(): OfflineQueueItem[] {
    return [...this.failed];
  }

  /** Fehlgeschlagene Einträge erneut in die Warteschlange stellen. */
  async retryFailed(): Promise<void> {
    if (this.failed.length === 0) return;
    for (const item of this.failed) {
      item.failed = false;
      item.retries = 0;
      item.lastError = undefined;
      try {
        await offlineStorage.updateQueueItem(item.id, { failed: false, retries: 0, lastError: null });
      } catch (error) {
        logger.error('Error requeueing failed item', error instanceof Error ? error : new Error(String(error)));
      }
      this.queue.push(item);
    }
    this.failed = [];
    this.notifyStatus();
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      await this.syncQueue();
    }
  }

  /** Ob gerade synchronisiert wird */
  isSyncing(): boolean {
    return this.syncing;
  }

  /** Status für UI (Sync-Status-Indikator) */
  getStatus(): { pendingCount: number; failedCount: number; isSyncing: boolean; status: OfflineSyncStatus } {
    const online = typeof navigator === 'undefined' ? true : navigator.onLine;
    const status: OfflineSyncStatus = this.syncing ? 'syncing' : !online ? 'offline' : 'idle';
    return {
      pendingCount: this.queue.length,
      failedCount: this.failed.length,
      isSyncing: this.syncing,
      status,
    };
  }


  /**
   * Synchronisiert die Queue mit Firestore (liest aus IndexedDB, entfernt synced Items dort)
   */
  async syncQueue(): Promise<void> {
    if (!navigator.onLine || !db) {
      return;
    }
    if (this.syncing) return;

    this.syncing = true;
    this.notifyStatus();

    try {
      await this.loadQueue();
      const itemsToSync = [...this.queue];
      const syncedIds: string[] = [];
      const failedItems: OfflineQueueItem[] = [];

      for (const item of itemsToSync) {
        try {
          await this.syncItem(item);
          syncedIds.push(item.id);
          await this.removePersistedItem(item.id);
        } catch (error) {
          logger.error(`Error syncing item ${item.id}`, error instanceof Error ? error : new Error(String(error)));
          item.retries += 1;
          if (item.retries < MAX_RETRIES) {
            failedItems.push(item);
            await this.updatePersistedRetries(item.id, item.retries);
          } else {
            // NICHT löschen – erfasste Arbeitszeit bleibt als "failed" erhalten.
            await this.markFailed(item, error);
          }
        }
      }

      // Einträge, die WÄHREND des Syncs dazugekommen sind, bleiben erhalten;
      // vorher wurden sie durch `this.queue = failedItems` aus dem Speicher
      // geworfen und tauchten erst nach einem Neuladen wieder auf.
      const verarbeitet = new Set(itemsToSync.map(i => i.id));
      const waehrendSyncNeu = this.queue.filter(i => !verarbeitet.has(i.id));
      this.queue = [...failedItems, ...waehrendSyncNeu];
      if (syncedIds.length > 0) {
        logger.info(`Successfully synced ${syncedIds.length} items`);
      }
    } catch (error) {
      logger.error('Error syncing queue', error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.syncing = false;
      this.notifyStatus();
    }
  }

  private async syncItem(item: OfflineQueueItem): Promise<void> {
    if (!db) {
      throw createAppError(
        new Error('Firestore not initialized'),
        ErrorCode.SERVICE_UNAVAILABLE,
        { component: 'offlineQueueService', action: 'syncItem' }
      );
    }

    const collectionName = COLLECTION_BY_TYPE[item.type];
    if (!collectionName) {
      throw createAppError(
        new Error(`Unknown queue item type: ${item.type}`),
        ErrorCode.VALIDATION_INVALID_FORMAT,
        { component: 'offlineQueueService', action: 'syncItem' }
      );
    }

    const { doc, setDoc, updateDoc, deleteDoc } = await import('firebase/firestore');

    if (item.action === 'create') {
      // IDEMPOTENT: Die Queue-Item-ID ist zugleich die Dokument-ID. Bricht der
      // Browser nach dem Schreiben, aber vor dem Entfernen aus IndexedDB ab,
      // überschreibt der nächste Sync dasselbe Dokument – vorher legte addDoc()
      // bei jedem Wiederholungslauf einen zusätzlichen Eintrag an (doppelt
      // erfasste Arbeitszeiten). Die ID ist außerdem der Wert, den create()
      // zurückgegeben hat, sodass ein späteres update() denselben Beleg trifft.
      await setDoc(
        doc(getDb(), collectionName, item.id),
        {
          ...item.data,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          syncedFromOffline: true,
        },
        { merge: true }
      );
      return;
    }

    if (item.action === 'update' && item.data.id) {
      const { id: docId, ...updatePayload } = item.data;
      await updateDoc(doc(getDb(), collectionName, docId as string), {
        ...updatePayload,
        updatedAt: serverTimestamp(),
        syncedFromOffline: true,
      });
      return;
    }

    if (item.action === 'delete' && item.data.id) {
      await deleteDoc(doc(getDb(), collectionName, item.data.id as string));
    }
  }

  /**
   * Gibt die aktuelle Queue zurück
   */
  getQueue(): OfflineQueueItem[] {
    return [...this.queue];
  }

  /**
   * Löscht die Queue (Speicher + IndexedDB)
   */
  async clearQueue(): Promise<void> {
    this.queue = [];
    try {
      await offlineStorage.clearQueue();
    } catch (error) {
      logger.error('Error clearing offline queue', error instanceof Error ? error : new Error(String(error)));
    }
    this.notifyStatus();
  }
}

export const offlineQueueService = new OfflineQueueService();

