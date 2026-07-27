import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Generischer Firestore-Zugriff (FirestoreService): CRUD, Echtzeit-Abos und
 * die vordefinierten Schichtklar-Abfragen.
 */

const getDocsMock = vi.fn();
const getDocMock = vi.fn();
const addDocMock = vi.fn(async () => ({ id: 'neu1' }));
const updateDocMock = vi.fn(async () => undefined);
const deleteDocMock = vi.fn(async () => undefined);
const onSnapshotMock = vi.fn();
const whereMock = vi.fn((feld: string, op: string, wert: unknown) => ({ feld, op, wert }));
const orderByMock = vi.fn((feld: string) => ({ orderBy: feld }));
const limitMock = vi.fn((n: number) => ({ limit: n }));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db: unknown, name: string) => ({ sammlung: name })),
  doc: vi.fn((_db: unknown, sammlung: string, id: string) => ({ pfad: `${sammlung}/${id}` })),
  query: vi.fn((quelle: unknown, ...teile: unknown[]) => ({ quelle, teile })),
  where: (...a: never[]) => whereMock(...a),
  orderBy: (...a: never[]) => orderByMock(...a),
  limit: (...a: never[]) => limitMock(...a),
  getDocs: (...a: unknown[]) => getDocsMock(...a),
  getDoc: (...a: unknown[]) => getDocMock(...a),
  addDoc: (...a: unknown[]) => addDocMock(...a),
  updateDoc: (...a: unknown[]) => updateDocMock(...a),
  deleteDoc: (...a: unknown[]) => deleteDocMock(...a),
  onSnapshot: (...a: unknown[]) => onSnapshotMock(...a),
  Timestamp: { now: vi.fn(() => 'JETZT') },
}));

vi.mock('@/lib/firebase', () => ({ getDb: vi.fn(() => ({})) }));

import { FirestoreService } from '../firestoreService';

const snapshot = (docs: Array<{ id: string; data: Record<string, unknown> }>) => ({
  docs: docs.map(d => ({ id: d.id, data: () => d.data })),
});

beforeEach(() => {
  vi.clearAllMocks();
  getDocsMock.mockResolvedValue(snapshot([]));
});

describe('CRUD', () => {
  it('liest eine Sammlung mit Einschränkungen', async () => {
    getDocsMock.mockResolvedValue(snapshot([{ id: 'a', data: { name: 'Haus A' } }]));
    const ergebnis = await FirestoreService.getCollection('facilities');
    expect(ergebnis).toEqual([{ id: 'a', name: 'Haus A' }]);
  });

  it('liest ein einzelnes Dokument oder null', async () => {
    getDocMock.mockResolvedValue({ exists: () => true, id: 'u1', data: () => ({ name: 'Anna' }) });
    await expect(FirestoreService.getDocument('users', 'u1')).resolves.toEqual({
      id: 'u1',
      name: 'Anna',
    });

    getDocMock.mockResolvedValue({ exists: () => false });
    await expect(FirestoreService.getDocument('users', 'fehlt')).resolves.toBeNull();
  });

  it('legt ein Dokument mit Zeitstempeln an', async () => {
    const id = await FirestoreService.createDocument('shifts', { title: 'Frühdienst' });
    expect(id).toBe('neu1');
    expect(addDocMock).toHaveBeenCalledWith(
      expect.objectContaining({ sammlung: 'shifts' }),
      expect.objectContaining({ title: 'Frühdienst', createdAt: 'JETZT', updatedAt: 'JETZT' })
    );
  });

  it('aktualisiert ein Dokument mit neuem Zeitstempel', async () => {
    await FirestoreService.updateDocument('shifts', 's1', { title: 'Spätdienst' });
    expect(updateDocMock).toHaveBeenCalledWith(
      expect.objectContaining({ pfad: 'shifts/s1' }),
      expect.objectContaining({ title: 'Spätdienst', updatedAt: 'JETZT' })
    );
  });

  it('löscht ein Dokument', async () => {
    await FirestoreService.deleteDocument('shifts', 's1');
    expect(deleteDocMock).toHaveBeenCalledWith(expect.objectContaining({ pfad: 'shifts/s1' }));
  });
});

describe('Echtzeit-Abos', () => {
  it('meldet Sammlungsänderungen an den Callback', () => {
    const abmelden = vi.fn();
    onSnapshotMock.mockImplementation((_q, handler) => {
      handler(snapshot([{ id: 'a', data: { name: 'Haus A' } }]));
      return abmelden;
    });

    const callback = vi.fn();
    const unsub = FirestoreService.subscribeToCollection('facilities', [], callback);
    expect(callback).toHaveBeenCalledWith([{ id: 'a', name: 'Haus A' }]);
    expect(unsub).toBe(abmelden);
  });

  it('meldet Dokumentänderungen inklusive Löschung', () => {
    onSnapshotMock.mockImplementation((_ref, handler) => {
      handler({ exists: () => true, id: 'u1', data: () => ({ name: 'Anna' }) });
      handler({ exists: () => false });
      return vi.fn();
    });

    const callback = vi.fn();
    FirestoreService.subscribeToDocument('users', 'u1', callback);
    expect(callback).toHaveBeenNthCalledWith(1, { id: 'u1', name: 'Anna' });
    expect(callback).toHaveBeenNthCalledWith(2, null);
  });
});

describe('vordefinierte Abfragen', () => {
  it('liest Einrichtungen nach Name sortiert', async () => {
    await FirestoreService.getFacilities();
    expect(orderByMock).toHaveBeenCalledWith('name');
  });

  it('liest Dokumente optional je Einrichtung', async () => {
    await FirestoreService.getDocuments();
    expect(whereMock).not.toHaveBeenCalled();

    await FirestoreService.getDocuments('f1');
    expect(whereMock).toHaveBeenCalledWith('facilityId', '==', 'f1');
  });

  it('liest Audit-Logs mit Limit und Benutzer sortiert', async () => {
    await FirestoreService.getAuditLogs(25);
    expect(limitMock).toHaveBeenCalledWith(25);

    await FirestoreService.getUsers();
    expect(orderByMock).toHaveBeenCalledWith('displayName');
  });
});
