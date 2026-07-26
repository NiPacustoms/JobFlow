'use client';

import { useState, useEffect } from 'react';
import { offlineQueueService, OFFLINE_SYNC_STATUS_EVENT, type OfflineSyncStatus } from '@/lib/services/offlineQueue';

export interface OfflineSyncState {
  pendingCount: number;
  /** Einträge, deren Sync endgültig fehlgeschlagen ist (lokal erhalten). */
  failedCount: number;
  isSyncing: boolean;
  status: OfflineSyncStatus;
}

export function useOfflineSync(): OfflineSyncState {
  const [state, setState] = useState<OfflineSyncState>(() => offlineQueueService.getStatus());

  useEffect(() => {
    const handler = () => setState(offlineQueueService.getStatus());
    window.addEventListener(OFFLINE_SYNC_STATUS_EVENT, handler);
    window.addEventListener('online', handler);
    window.addEventListener('offline', handler);
    return () => {
      window.removeEventListener(OFFLINE_SYNC_STATUS_EVENT, handler);
      window.removeEventListener('online', handler);
      window.removeEventListener('offline', handler);
    };
  }, []);

  return state;
}
