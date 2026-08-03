import { beforeEach, describe, expect, it, vi } from 'vitest';
import { harness, firestoreModuleMock, ts } from './helpers/firestoreHarness';

/**
 * Sammel-Suite für die kleineren Dienste: Dokumenttypen, Kategorien
 * und der Benachrichtigungs-Kerndienst.
 */

vi.mock('@/lib/firebase', () => ({
  db: {},
  getDb: vi.fn(() => ({})),
  auth: { currentUser: { uid: 'admin1' } },
}));
vi.mock('@/lib/utils/companyId', () => ({
  getCompanyIdFromAuth: vi.fn(async () => 'firmaA'),
}));
vi.mock('firebase/firestore', () => firestoreModuleMock());

beforeEach(() => {
  vi.clearAllMocks();
  harness.reset();
});

describe('documentTypeService', () => {
  const lade = async () => (await import('../documentTypes')).documentTypeService;
  const typ = (id: string, daten: Record<string, unknown> = {}) => ({
    id,
    data: {
      name: 'Führungszeugnis',
      isActive: true,
      required: true,
      createdAt: ts(new Date(2026, 0, 1)),
      updatedAt: ts(new Date(2026, 0, 1)),
      ...daten,
    },
  });

  it('liest die aktiven Typen', async () => {
    harness.setDocs([typ('d1')]);
    const service = await lade();
    const typen = await service.getActiveTypes();
    expect(typen).toHaveLength(1);
  });

  it('liest alle Typen', async () => {
    harness.setDocs([typ('d1'), typ('d2', { isActive: false })]);
    const service = await lade();
    expect(await service.getAllTypes()).toHaveLength(2);
  });

  it('legt einen Typ an', async () => {
    const service = await lade();
    const neu = await service.createType({ name: 'Impfnachweis' } as never);
    expect(neu.id).toBe('neu1');
  });

  it('ändert, deaktiviert und löscht einen Typ', async () => {
    const service = await lade();
    await service.updateType('d1', { name: 'Neu' } as never);
    expect(harness.writes.find(w => w.art === 'update')?.daten).toMatchObject({ name: 'Neu' });

    harness.reset();
    await service.deactivateType('d1');
    expect(harness.writes.find(w => w.art === 'update')?.daten).toMatchObject({ isActive: false });

    harness.reset();
    await service.deleteType('d1');
    expect(harness.writes.some(w => w.art === 'delete')).toBe(true);
  });

  it('legt Standardtypen an, wenn noch keine existieren', async () => {
    harness.setDocs([]);
    const service = await lade();
    await service.initializeDefaultTypes('admin1');
    expect(harness.writes.filter(w => w.art === 'add').length).toBeGreaterThan(0);
  });
});

describe('categoriesService', () => {
  const lade = async () => (await import('../categories')).categoriesService;

  it('legt Standardkategorien an, wenn das Dokument fehlt', async () => {
    harness.setDoc(null);
    const service = await lade();
    const kategorien = await service.get();
    expect(kategorien.roles).toContain('nurse');
    expect(kategorien.jobTitles).toContain('Pflegefachkraft');
    expect(harness.writes.some(w => w.art === 'set')).toBe(true);
  });

  it('liest hinterlegte Kategorien', async () => {
    harness.setDoc({
      id: 'kategorien',
      data: {
        roles: ['nurse'],
        groups: ['Intensiv'],
        qualifications: ['Beatmung'],
        jobTitles: ['Fachkraft'],
        updatedAt: ts(new Date(2026, 6, 1)),
      },
    });
    const service = await lade();
    const kategorien = await service.get();
    expect(kategorien.groups).toEqual(['Intensiv']);
  });

  it('normalisiert kaputte Felder zu Listen', async () => {
    harness.setDoc({ id: 'kategorien', data: { roles: 'kein-array' } });
    const service = await lade();
    const kategorien = await service.get();
    expect(kategorien.roles).toEqual([]);
  });

  it('speichert und aktualisiert Kategorien', async () => {
    const service = await lade();
    await service.set({ roles: ['nurse'], groups: [], qualifications: [], jobTitles: [], updatedAt: new Date() });
    expect(harness.writes.some(w => w.art === 'set')).toBe(true);

    harness.reset();
    await service.update({ groups: ['Neu'] });
    expect(harness.writes.find(w => w.art === 'update')?.daten).toMatchObject({ groups: ['Neu'] });
  });
});

describe('notificationService (Kerndienst)', () => {
  const lade = async () => (await import('../notificationService')).notificationService;
  const hinweis = (id: string, daten: Record<string, unknown> = {}) => ({
    id,
    data: {
      userId: 'u1',
      title: 'Neuer Einsatz',
      body: 'Morgen 06:00',
      type: 'info',
      category: 'assignment',
      read: false,
      createdAt: ts(new Date(2026, 6, 20)),
      ...daten,
    },
  });

  it('legt eine Benachrichtigung an', async () => {
    const service = await lade();
    const id = await service.create({ userId: 'u1', title: 'T', body: 'B', type: 'info' } as never);
    expect(id).toBe('neu1');
  });

  it('liest die Benachrichtigungen eines Nutzers', async () => {
    harness.setDocs([hinweis('n1'), hinweis('n2')]);
    const service = await lade();
    expect(await service.getByUserId('u1')).toHaveLength(2);
    expect(harness.hatWhere('userId', 'u1')).toBe(true);
  });

  it('liest nur ungelesene Benachrichtigungen', async () => {
    harness.setDocs([hinweis('n1')]);
    const service = await lade();
    await service.getUnreadByUserId('u1');
    expect(harness.hatWhere('read', false)).toBe(true);
  });

  it('zählt ungelesene Benachrichtigungen', async () => {
    harness.setDocs([hinweis('n1'), hinweis('n2')]);
    const service = await lade();
    expect(await service.getUnreadCount('u1')).toBe(2);
  });

  it('markiert einzeln und gesammelt als gelesen', async () => {
    const service = await lade();
    await service.markAsRead('n1');
    expect(harness.writes.find(w => w.art === 'update')?.daten).toMatchObject({ read: true });

    harness.reset();
    harness.setDocs([hinweis('n1'), hinweis('n2')]);
    await service.markAllAsRead('u1');
    expect(harness.writes.filter(w => w.art === 'update').length).toBe(2);
  });

  it('löscht einzeln und für einen Nutzer gesammelt', async () => {
    const service = await lade();
    await service.delete('n1');
    expect(harness.writes.filter(w => w.art === 'delete')).toHaveLength(1);

    harness.reset();
    harness.setDocs([hinweis('n1'), hinweis('n2')]);
    await service.deleteAllForUser('u1');
    expect(harness.writes.filter(w => w.art === 'delete').length).toBe(2);
  });

  it('legt mehrere Benachrichtigungen als Stapel an', async () => {
    const service = await lade();
    const ids = await service.createBulk([
      { userId: 'u1', title: 'A', body: 'a', type: 'info' },
      { userId: 'u2', title: 'B', body: 'b', type: 'info' },
    ] as never);
    expect(ids.length).toBe(2);
  });

  it('filtert nach Typ und Kategorie', async () => {
    harness.setDocs([hinweis('n1')]);
    const service = await lade();
    await service.getByType('u1', 'info' as never);
    expect(harness.hatWhere('type', 'info')).toBe(true);

    harness.reset();
    harness.setDocs([hinweis('n1')]);
    await service.getByCategory('u1', 'assignment' as never);
    expect(harness.hatWhere('category', 'assignment')).toBe(true);
  });
});
