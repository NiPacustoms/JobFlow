'use client';

import { Chip, Tooltip, CircularProgress } from '@mui/material';
import { CloudOff, CheckCircle, Schedule, ErrorOutline } from '@mui/icons-material';
import { useOfflineSync } from '@/lib/hooks/useOfflineSync';
import { offlineQueueService } from '@/lib/services/offlineQueue';

/**
 * Zeigt den Offline-/Sync-Status der Zeiterfassung (IndexedDB-Queue).
 * Nutzbar auf der Zeiterfassungs-Seite oder im Layout.
 */
export function SyncStatusIndicator() {
  const { pendingCount, failedCount, isSyncing, status } = useOfflineSync();

  // Endgültig fehlgeschlagene Einträge zuerst melden: Die Daten sind lokal noch
  // vorhanden, gehen aber ohne Hinweis niemandem auf – ein Klick stellt sie
  // erneut in die Warteschlange.
  if (failedCount > 0 && !isSyncing) {
    return (
      <Tooltip
        title={`${failedCount} Eintrag/Einträge konnten nicht synchronisiert werden und sind nur lokal gespeichert. Klicken, um es erneut zu versuchen.`}
      >
        <Chip
          size="small"
          icon={<ErrorOutline />}
          label={`${failedCount} nicht synchronisiert`}
          color="error"
          variant="outlined"
          onClick={() => void offlineQueueService.retryFailed()}
          aria-label={`${failedCount} nicht synchronisiert – erneut versuchen`}
        />
      </Tooltip>
    );
  }

  if (status === 'offline') {
    return (
      <Tooltip title="Offline – Zeiterfassungen werden beim nächsten Verbindungswiederaufbau synchronisiert.">
        <Chip
          size="small"
          icon={<CloudOff />}
          label={pendingCount > 0 ? `${pendingCount} ausstehend` : 'Offline'}
          color="warning"
          variant="outlined"
          aria-label="Status: Offline"
        />
      </Tooltip>
    );
  }

  if (isSyncing) {
    return (
      <Tooltip title="Synchronisiere ausstehende Zeiterfassungen…">
        <Chip
          size="small"
          icon={<CircularProgress size={14} color="inherit" />}
          label="Synchronisiere…"
          color="info"
          variant="outlined"
          aria-label="Status: Wird synchronisiert"
        />
      </Tooltip>
    );
  }

  if (pendingCount > 0) {
    return (
      <Tooltip title={`${pendingCount} Zeiterfassung(en) warten auf Synchronisation. Bei Internetverbindung wird automatisch synchronisiert.`}>
        <Chip
          size="small"
          icon={<Schedule />}
          label={`${pendingCount} ausstehend`}
          color="warning"
          variant="outlined"
          aria-label={`${pendingCount} ausstehend`}
        />
      </Tooltip>
    );
  }

  return (
    <Tooltip title="Alle Zeiterfassungen sind synchronisiert.">
      <Chip
        size="small"
        icon={<CheckCircle />}
        label="Synchronisiert"
        color="success"
        variant="outlined"
        aria-label="Status: Synchronisiert"
      />
    </Tooltip>
  );
}
