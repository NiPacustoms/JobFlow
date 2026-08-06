import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regressionstests zur Offline-Queue der Zeiterfassung.
 * Kernanforderungen für eine Zeitarbeitsfirma: keine doppelten und keine
 * verlorenen Arbeitszeiten – auch wenn der Browser mitten im Sync abbricht.
 */

vi.mock('@/lib/firebase', () => ({
  db: {},
  getDb: vi.fn(() => ({})),
}));

const setDoc = vi.fn();
const updateDoc = vi.fn();
const deleteDoc = vi.fn();

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db: unknown, collectionName: string, id: string) => ({ collectionName, id })),
  setDoc: (...args: unknown[]) => setDoc(...args),
  updateDoc: (...args: unknown[]) => updateDoc(...args),
  deleteDoc: (...args: unknown[]) => deleteDoc(...args),
  serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
}));

// In-Memory-Ersatz für IndexedDB
const speicher = new Map<string, Record<string, unknown>>();
vi.mock('../offlineStorage', () => ({
  getAllQueueItems: vi.fn(async () => Array.from(speicher.values())),
  addQueueItem: vi.fn(async (item: Record<string, unknown>) => {
    speicher.set(item.id as string, { ...item });
  }),
  removeQueueItem: vi.fn(async (id: string) => {
    speicher.delete(id);
  }),
  updateQueueItem: vi.fn(async (id: string, updates: Record<string, unknown>) => {
    const vorhanden = speicher.get(id);
    if (vorhanden) speicher.set(id, { ...vorhanden, ...updates });
  }),
  clearQueue: vi.fn(async () => {
    speicher.clear();
  }),
}));

const importService = async () => (await import('../offlineQueue')).offlineQueueService;

const setzeOnline = (online: boolean) => {
  Object.defineProperty(navigator, 'onLine', { value: online, configurable: true });
};

describe('offlineQueueService', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    speicher.clear();
    setzeOnline(true);
    setDoc.mockResolvedValue(undefined);
    updateDoc.mockResolvedValue(undefined);
    deleteDoc.mockResolvedValue(undefined);
    const service = await importService();
    await service.clearQueue();
  });

  describe('Idempotenz', () => {
    it('schreibt Neuanlagen mit der Queue-ID als Dokument-ID', async () => {
      setzeOnline(false);
      const service = await importService();
      const id = await service.addToQueue('timesheet', 'create', {
        userId: 'u1',
        startTime: '08:00',
      });

      setzeOnline(true);
      await service.syncQueue();

      expect(setDoc).toHaveBeenCalledTimes(1);
      const [ref, daten, optionen] = setDoc.mock.calls[0];
      expect(ref).toMatchObject({ collectionName: 'timesheets', id });
      expect(daten).toMatchObject({ userId: 'u1', syncedFromOffline: true });
      expect(optionen).toEqual({ merge: true });
    });

    it('legt bei erneutem Sync desselben Eintrags kein zweites Dokument an', async () => {
      setzeOnline(false);
      const service = await importService();
      const id = await service.addToQueue('timesheet', 'create', { userId: 'u1' });

      setzeOnline(true);
      // Erster Sync: Schreiben klappt, das Entfernen aus IndexedDB schlägt fehl
      // (simuliert Absturz zwischen Write und Cleanup).
      const storage = await import('../offlineStorage');
      vi.mocked(storage.removeQueueItem).mockRejectedValueOnce(new Error('IndexedDB weg'));
      await service.syncQueue();
      // Eintrag ist noch da → zweiter Durchlauf
      await service.syncQueue();

      const geschriebeneIds = setDoc.mock.calls.map(call => (call[0] as { id: string }).id);
      expect(new Set(geschriebeneIds).size).toBe(1);
      expect(geschriebeneIds[0]).toBe(id);
    });

    it('liefert eine ID, unter der ein späteres Update denselben Beleg trifft', async () => {
      setzeOnline(false);
      const service = await importService();
      const id = await service.addToQueue('timesheet', 'create', { userId: 'u1' });
      await service.addToQueue('timesheet', 'update', { id, breakMinutes: 45 });

      setzeOnline(true);
      await service.syncQueue();

      expect((setDoc.mock.calls[0][0] as { id: string }).id).toBe(id);
      expect((updateDoc.mock.calls[0][0] as { id: string }).id).toBe(id);
    });
  });

  describe('Kein Datenverlust', () => {
    it('behält Einträge nach erschöpften Versuchen als "failed" statt sie zu löschen', async () => {
      setzeOnline(false);
      const service = await importService();
      await service.addToQueue('timesheet', 'create', { userId: 'u1' });

      setzeOnline(true);
      setDoc.mockRejectedValue(new Error('Netzwerk weg'));
      await service.syncQueue();
      await service.syncQueue();
      await service.syncQueue();

      expect(service.getPendingCount()).toBe(0);
      expect(service.getFailedCount()).toBe(1);
      expect(speicher.size).toBe(1);
      expect(service.getFailedItems()[0].lastError).toBe('Netzwerk weg');
    });

    it('stellt fehlgeschlagene Einträge auf Wunsch erneut zu', async () => {
      setzeOnline(false);
      const service = await importService();
      await service.addToQueue('timesheet', 'create', { userId: 'u1' });

      setzeOnline(true);
      setDoc.mockRejectedValue(new Error('Netzwerk weg'));
      await service.syncQueue();
      await service.syncQueue();
      await service.syncQueue();
      expect(service.getFailedCount()).toBe(1);

      setDoc.mockResolvedValue(undefined);
      await service.retryFailed();

      expect(service.getFailedCount()).toBe(0);
      expect(service.getPendingCount()).toBe(0);
      expect(speicher.size).toBe(0);
    });

    it('zählt Versuche hoch, bevor endgültig aufgegeben wird', async () => {
      setzeOnline(false);
      const service = await importService();
      const id = await service.addToQueue('timesheet', 'create', { userId: 'u1' });

      setzeOnline(true);
      setDoc.mockRejectedValue(new Error('kurz weg'));
      await service.syncQueue();

      expect(service.getPendingCount()).toBe(1);
      expect(service.getFailedCount()).toBe(0);
      expect(speicher.get(id)?.retries).toBe(1);
    });
  });

  describe('Zuordnung der Collections', () => {
    it.each([
      ['timesheet', 'timesheets'],
      ['sick', 'times'],
      ['break', 'times'],
      ['timeEntry', 'times'],
      ['assignment', 'assignments'],
    ] as const)('schreibt %s nach %s', async (typ, collectionName) => {
      setzeOnline(false);
      const service = await importService();
      await service.addToQueue(typ, 'create', { userId: 'u1' });

      setzeOnline(true);
      await service.syncQueue();

      expect((setDoc.mock.calls[0][0] as { collectionName: string }).collectionName).toBe(
        collectionName
      );
    });

    it('löscht über die passende Collection', async () => {
      setzeOnline(false);
      const service = await importService();
      await service.addToQueue('timesheet', 'delete', { id: 'ts1' });

      setzeOnline(true);
      await service.syncQueue();

      expect((deleteDoc.mock.calls[0][0] as { collectionName: string; id: string })).toMatchObject({
        collectionName: 'timesheets',
        id: 'ts1',
      });
    });
  });

  describe('Status', () => {
    it('meldet offline, solange keine Verbindung besteht', async () => {
      setzeOnline(false);
      const service = await importService();
      await service.addToQueue('timesheet', 'create', { userId: 'u1' });

      const status = service.getStatus();
      expect(status.status).toBe('offline');
      expect(status.pendingCount).toBe(1);
      expect(status.failedCount).toBe(0);
    });

    it('meldet idle nach erfolgreichem Sync', async () => {
      setzeOnline(false);
      const service = await importService();
      await service.addToQueue('timesheet', 'create', { userId: 'u1' });
      setzeOnline(true);
      await service.syncQueue();

      expect(service.getStatus()).toMatchObject({
        status: 'idle',
        pendingCount: 0,
        failedCount: 0,
      });
    });

    it('synchronisiert nicht, solange keine Verbindung besteht', async () => {
      setzeOnline(false);
      const service = await importService();
      await service.addToQueue('timesheet', 'create', { userId: 'u1' });
      await service.syncQueue();

      expect(setDoc).not.toHaveBeenCalled();
      expect(service.getPendingCount()).toBe(1);
    });
  });
});
