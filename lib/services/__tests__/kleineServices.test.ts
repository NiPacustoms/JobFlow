import { beforeEach, describe, expect, it, vi } from 'vitest';
import { harness, firestoreModuleMock, ts } from './helpers/firestoreHarness';

/**
 * Sammel-Suite für die kleineren Dienste: Personalgruppen, Einladungen,
 * Dokumenttypen, Kategorien, Firmen und der Benachrichtigungs-Kerndienst.
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

describe('staffGroupService', () => {
  const lade = async () => (await import('../staffGroups')).staffGroupService;
  const gruppe = (id: string, daten: Record<string, unknown> = {}) => ({
    id,
    data: {
      name: 'Nachtdienst',
      description: '',
      color: '#0f766e',
      members: ['u1'],
      permissions: [],
      createdAt: ts(new Date(2026, 0, 1)),
      updatedAt: ts(new Date(2026, 6, 1)),
      ...daten,
    },
  });

  it('legt eine Gruppe an', async () => {
    const service = await lade();
    const g = await service.create({
      name: 'Nachtdienst',
      description: '',
      color: '#0f766e',
      members: [],
      permissions: [],
    });
    expect(g.id).toBe('neu1');
    expect(harness.writes.find(w => w.art === 'add')?.daten).toMatchObject({ name: 'Nachtdienst' });
  });

  it('liest alle Gruppen', async () => {
    harness.setDocs([gruppe('g1'), gruppe('g2', { name: 'Wochenende' })]);
    const service = await lade();
    expect(await service.getAll()).toHaveLength(2);
  });

  it('liest eine Gruppe anhand der ID', async () => {
    harness.setDoc(gruppe('g1'));
    const service = await lade();
    expect(await service.getById('g1')).toMatchObject({ id: 'g1', name: 'Nachtdienst' });
  });

  it('liefert null für eine unbekannte Gruppe', async () => {
    harness.setDoc(null);
    const service = await lade();
    expect(await service.getById('fehlt')).toBeNull();
  });

  it('ändert und löscht eine Gruppe', async () => {
    const service = await lade();
    await service.update('g1', { name: 'Umbenannt' });
    expect(harness.writes.find(w => w.art === 'update')?.daten).toMatchObject({ name: 'Umbenannt' });

    harness.reset();
    await service.delete('g1');
    expect(harness.writes.some(w => w.art === 'delete')).toBe(true);
  });

  it('fügt ein Mitglied hinzu und entfernt es wieder', async () => {
    harness.setDoc(gruppe('g1', { members: [] }));
    const service = await lade();
    await service.addMember('g1', 'u2');
    expect(harness.writes.some(w => w.art === 'update')).toBe(true);

    harness.reset();
    harness.setDoc(gruppe('g1', { members: ['u2'] }));
    await service.removeMember('g1', 'u2');
    expect(harness.writes.some(w => w.art === 'update')).toBe(true);
  });

  it('liefert die Gruppen eines Mitarbeiters', async () => {
    harness.setDocs([gruppe('g1', { members: ['u1'] })]);
    const service = await lade();
    const result = await service.getGroupsForUser('u1');
    expect(Array.isArray(result)).toBe(true);
    expect(harness.hatWhere('members', 'u1')).toBe(true);
  });

  it('fügt ein bereits vorhandenes Mitglied nicht doppelt hinzu', async () => {
    harness.setDoc(gruppe('g1', { members: ['u2'] }));
    const service = await lade();
    await service.addMember('g1', 'u2');
    expect(harness.writes.some(w => w.art === 'update')).toBe(false);
  });

  it('hängt ein neues Mitglied an die Liste an', async () => {
    harness.setDoc(gruppe('g1', { members: ['u1'] }));
    const service = await lade();
    await service.addMember('g1', 'u2');

    const update = harness.writes.find(w => w.art === 'update')?.daten as Record<string, unknown>;
    expect(update.members).toEqual(['u1', 'u2']);
  });

  it('entfernt genau ein Mitglied und behält die übrigen', async () => {
    harness.setDoc(gruppe('g1', { members: ['u1', 'u2', 'u3'] }));
    const service = await lade();
    await service.removeMember('g1', 'u2');

    const update = harness.writes.find(w => w.art === 'update')?.daten as Record<string, unknown>;
    expect(update.members).toEqual(['u1', 'u3']);
  });

  it('wirft, wenn die Gruppe für die Mitgliederpflege fehlt', async () => {
    harness.setDoc(null);
    const service = await lade();
    await expect(service.addMember('weg', 'u2')).rejects.toThrow('not found');
    await expect(service.removeMember('weg', 'u2')).rejects.toThrow('not found');
  });

  it('liefert die Mitglieder mit Namen und Rolle', async () => {
    // 1. getDoc: Gruppe, danach je Mitglied ein Nutzerdokument
    harness.setDoc(gruppe('g1', { members: ['u1'] }));
    const service = await lade();
    const spy = vi.spyOn(service, 'getById').mockResolvedValue({
      id: 'g1',
      name: 'Nachtdienst',
      members: ['u1', 'weg'],
    } as never);
    harness.setDoc({
      id: 'u1',
      data: { displayName: 'Anna Muster', email: 'anna@aufabruf.eu', role: 'nurse' },
    });

    const mitglieder = await service.getGroupMembers('g1');
    // Der Harness liefert für beide Abfragen dasselbe Dokument – beide Mitglieder
    // werden also aufgelöst; entscheidend ist die Feldabbildung.
    expect(mitglieder[0]).toMatchObject({
      userId: 'u1',
      displayName: 'Anna Muster',
      email: 'anna@aufabruf.eu',
      role: 'nurse',
    });
    expect(mitglieder[0].addedAt).toBeInstanceOf(Date);
    spy.mockRestore();
  });

  it('liefert eine leere Mitgliederliste für eine unbekannte Gruppe', async () => {
    harness.setDoc(null);
    const service = await lade();
    await expect(service.getGroupMembers('weg')).resolves.toEqual([]);
  });

  it('überspringt gelöschte Mitglieder', async () => {
    const service = await lade();
    const spy = vi.spyOn(service, 'getById').mockResolvedValue({
      id: 'g1',
      name: 'Nachtdienst',
      members: ['weg'],
    } as never);
    harness.setDoc(null);

    await expect(service.getGroupMembers('g1')).resolves.toEqual([]);
    spy.mockRestore();
  });
});

describe('invitationService', () => {
  const lade = async () => (await import('../invitations')).invitationService;

  it('legt eine Einladung mit Token und 24h-Ablauf an', async () => {
    harness.setDocs([]);
    const service = await lade();
    const einladung = await service.create('firmaA', 'neu@aufabruf.eu', 'admin1');
    expect(einladung.token).toBeTruthy();
    expect(einladung.token.length).toBeGreaterThan(20);
    expect(einladung.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(harness.writes.find(w => w.art === 'add')?.daten).toMatchObject({
      companyId: 'firmaA',
      email: 'neu@aufabruf.eu',
      acceptedAt: null,
    });
  });

  it('verwendet eine offene Einladung wieder, statt zu doppeln', async () => {
    harness.setDocs([
      {
        id: 'inv1',
        data: {
          companyId: 'firmaA',
          email: 'neu@aufabruf.eu',
          token: 'vorhandener-token',
          expiresAt: ts(new Date(Date.now() + 3600_000)),
          acceptedAt: null,
          createdByUserId: 'admin1',
          createdAt: ts(new Date()),
        },
      },
    ]);
    const service = await lade();
    const einladung = await service.create('firmaA', 'neu@aufabruf.eu', 'admin1');
    expect(einladung.id).toBe('inv1');
    expect(einladung.token).toBe('vorhandener-token');
    expect(harness.writes.filter(w => w.art === 'add')).toHaveLength(0);
  });

  it('ignoriert bereits angenommene Einladungen bei der Duplikatsuche', async () => {
    harness.setDocs(
      [
        {
          id: 'alt',
          data: {
            companyId: 'firmaA',
            email: 'neu@aufabruf.eu',
            token: 'alt',
            acceptedAt: ts(new Date()),
          },
        },
      ],
      []
    );
    const service = await lade();
    const einladung = await service.create('firmaA', 'neu@aufabruf.eu', 'admin1');
    expect(einladung.id).toBe('neu1');
  });

  it('liest eine Einladung anhand des Tokens', async () => {
    harness.setDocs([
      {
        id: 'inv1',
        data: {
          companyId: 'firmaA',
          email: 'neu@aufabruf.eu',
          token: 'token-x',
          expiresAt: ts(new Date(Date.now() + 3600_000)),
          createdByUserId: 'admin1',
          createdAt: ts(new Date()),
        },
      },
    ]);
    const service = await lade();
    const einladung = await service.getByToken('token-x');
    expect(einladung).toMatchObject({ id: 'inv1', token: 'token-x' });
  });

  it('liefert null für einen unbekannten Token', async () => {
    harness.setDocs([]);
    const service = await lade();
    expect(await service.getByToken('unbekannt')).toBeNull();
  });

  it('markiert eine Einladung als angenommen', async () => {
    const einladungsDoc = {
      id: 'inv1',
      data: {
        companyId: 'firmaA',
        email: 'x@y.de',
        token: 'token-x',
        expiresAt: ts(new Date(Date.now() + 3600_000)),
        acceptedAt: null,
      },
    };
    harness.setDocs([einladungsDoc]);
    harness.setDoc(einladungsDoc); // Transaktions-Read
    const service = await lade();
    await service.markAcceptedByToken('token-x');
    expect(harness.writes.some(w => w.art === 'update')).toBe(true);
  });
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

describe('companyService', () => {
  const lade = async () => (await import('../companies')).companyService;

  it('legt eine Firma an', async () => {
    const service = await lade();
    const firma = await service.create('AufAbruf GmbH', 'admin1');
    expect(firma.id).toBe('neu1');
    expect(harness.writes.find(w => w.art === 'add')?.daten).toMatchObject({
      name: 'AufAbruf GmbH',
      createdByUserId: 'admin1',
    });
  });

  it('legt eine Firma mit fester ID an', async () => {
    const service = await lade();
    await service.setWithId('firmaA', 'AufAbruf GmbH', 'admin1');
    expect(harness.writes.find(w => w.art === 'set')?.daten).toMatchObject({ name: 'AufAbruf GmbH' });
  });

  it('liest eine Firma', async () => {
    harness.setDoc({ id: 'firmaA', data: { name: 'AufAbruf GmbH', createdByUserId: 'admin1', createdAt: ts(new Date()) } });
    const service = await lade();
    expect(await service.getById('firmaA')).toMatchObject({ id: 'firmaA', name: 'AufAbruf GmbH' });
  });

  it('liefert null für eine unbekannte Firma', async () => {
    harness.setDoc(null);
    const service = await lade();
    expect(await service.getById('fehlt')).toBeNull();
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
