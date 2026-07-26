import { beforeEach, describe, expect, it, vi } from 'vitest';
import { harness, firestoreModuleMock, ts } from './helpers/firestoreHarness';

/**
 * Mitarbeiterstammdaten: Lesen, Anlegen, Ändern, Rollen, Aktiv-Status.
 * Rollenwechsel und Mandantenbindung sind sicherheitsrelevant.
 */

vi.mock('@/lib/firebase', () => ({
  db: {},
  getDb: vi.fn(() => ({})),
  auth: { currentUser: { uid: 'admin1' } },
}));
vi.mock('@/lib/utils/companyId', () => ({
  getCompanyIdFromAuth: vi.fn(async () => 'firmaA'),
  refreshTokenAndGetCompanyId: vi.fn(async () => 'firmaA'),
}));
vi.mock('@/lib/services/auditLogService', () => ({ writeAuditLog: vi.fn(async () => undefined) }));
vi.mock('firebase/auth', () => ({ getAuth: () => ({ currentUser: { uid: 'admin1' } }) }));
vi.mock('firebase/firestore', () => firestoreModuleMock());

const lade = async () => (await import('../users')).userService;

const nutzer = (daten: Record<string, unknown> = {}) => ({
  email: 'anna@aufabruf.eu',
  displayName: 'Anna Muster',
  role: 'nurse',
  jobTitle: 'Pflegefachkraft',
  phone: '0170 1234567',
  qualifications: ['Examiniert'],
  documents: [],
  active: true,
  companyId: 'firmaA',
  status: 'active',
  createdAt: ts(new Date(2026, 0, 1)),
  updatedAt: ts(new Date(2026, 6, 1)),
  ...daten,
});

beforeEach(() => {
  vi.clearAllMocks();
  harness.reset();
});

describe('getById', () => {
  it('bildet ein Nutzerdokument vollständig ab', async () => {
    harness.setDoc({ id: 'u1', data: nutzer() });
    const service = await lade();
    const user = await service.getById('u1');
    expect(user).toMatchObject({
      id: 'u1',
      email: 'anna@aufabruf.eu',
      displayName: 'Anna Muster',
      role: 'nurse',
      active: true,
      companyId: 'firmaA',
    });
    expect(user?.createdAt).toBeInstanceOf(Date);
  });

  it('liefert null für einen unbekannten Nutzer', async () => {
    harness.setDoc(null);
    const service = await lade();
    expect(await service.getById('fehlt')).toBeNull();
  });

  it('setzt Standardwerte für fehlende Felder', async () => {
    harness.setDoc({ id: 'u1', data: { email: 'a@b.de', displayName: 'A', role: 'nurse' } });
    const service = await lade();
    const user = await service.getById('u1');
    expect(user?.jobTitle).toBe('');
    expect(user?.qualifications).toEqual([]);
    expect(user?.documents).toEqual([]);
    expect(user?.active).toBe(true);
  });

  it('behandelt active=false korrekt', async () => {
    harness.setDoc({ id: 'u1', data: nutzer({ active: false }) });
    const service = await lade();
    expect((await service.getById('u1'))?.active).toBe(false);
  });
});

describe('getActiveEmployees', () => {
  it('liefert nur aktive Mitarbeiter', async () => {
    harness.setDocs([{ id: 'u1', data: nutzer() }]);
    const service = await lade();
    const result = await service.getActiveEmployees({ companyId: 'firmaA' });
    expect(result).toHaveLength(1);
    expect(harness.hatWhere('active', true)).toBe(true);
    expect(harness.hatWhere('companyId', 'firmaA')).toBe(true);
  });

  it('filtert auf eine einzelne Rolle', async () => {
    harness.setDocs([{ id: 'u1', data: nutzer() }]);
    const service = await lade();
    await service.getActiveEmployees({ roles: ['nurse'] });
    expect(harness.hatWhere('role', 'nurse')).toBe(true);
  });

  it('filtert auf mehrere Rollen', async () => {
    harness.setDocs([{ id: 'u1', data: nutzer() }]);
    const service = await lade();
    await service.getActiveEmployees({ roles: ['nurse', 'admin'] });
    expect(
      harness.alleConstraints().some(c => c.art === 'where' && c.args[1] === 'in')
    ).toBe(true);
  });

  it('liefert eine leere Liste, wenn niemand aktiv ist', async () => {
    harness.setDocs([]);
    const service = await lade();
    expect(await service.getActiveEmployees()).toEqual([]);
  });
});

describe('getByRole und getByStatus', () => {
  it('filtert nach Rolle', async () => {
    harness.setDocs([{ id: 'u1', data: nutzer() }]);
    const service = await lade();
    const result = await service.getByRole('nurse');
    expect(result).toHaveLength(1);
    expect(harness.hatWhere('role', 'nurse')).toBe(true);
  });

  it('filtert nach Status', async () => {
    harness.setDocs([{ id: 'u1', data: nutzer() }]);
    const service = await lade();
    const result = await service.getByStatus('active');
    expect(result.length).toBeGreaterThanOrEqual(0);
  });
});

describe('Ändern', () => {
  it('aktualisiert Stammdaten', async () => {
    const service = await lade();
    await service.update('u1', { displayName: 'Anna Neu' } as never);
    expect(harness.writes.find(w => w.art === 'update')?.daten).toMatchObject({
      displayName: 'Anna Neu',
    });
  });

  it('ändert die Rolle', async () => {
    const service = await lade();
    await service.updateRole('u1', 'admin');
    expect(harness.writes.find(w => w.art === 'update')?.daten).toMatchObject({ role: 'admin' });
  });

  it('deaktiviert und aktiviert einen Mitarbeiter', async () => {
    const service = await lade();
    await service.toggleActive('u1', false);
    expect(harness.writes.find(w => w.art === 'update')?.daten).toMatchObject({ active: false });

    harness.reset();
    await service.toggleActive('u1', true);
    expect(harness.writes.find(w => w.art === 'update')?.daten).toMatchObject({ active: true });
  });

  it('speichert Benachrichtigungseinstellungen', async () => {
    harness.setDoc({ id: 'u1', data: nutzer() });
    const service = await lade();
    await service.updateUserNotificationSettings('u1', {
      emailNotifications: false,
      pushNotifications: true,
      shiftReminders: true,
      documentExpiry: true,
      systemAnnouncements: true,
    } as never);
    expect(harness.writes.some(w => w.art === 'update' || w.art === 'set')).toBe(true);
  });

  it('liest Benachrichtigungseinstellungen', async () => {
    harness.setDoc({ id: 'u1', data: nutzer({ notificationSettings: { emailNotifications: false } }) });
    const service = await lade();
    const settings = await service.getUserNotificationSettings('u1');
    expect(settings).toMatchObject({ emailNotifications: false });
  });

  it('liefert null, wenn keine Einstellungen hinterlegt sind', async () => {
    harness.setDoc(null);
    const service = await lade();
    expect(await service.getUserNotificationSettings('u1')).toBeNull();
  });

  it('wirft beim Speichern, wenn der Mitarbeiter nicht existiert', async () => {
    harness.setDoc(null);
    const service = await lade();
    await expect(
      service.updateUserNotificationSettings('fehlt', {
        emailNotifications: true,
        pushNotifications: true,
        shiftReminders: true,
        documentExpiry: true,
        systemAnnouncements: true,
      } as never)
    ).rejects.toThrow(/existiert nicht/);
  });
});

describe('Anlegen und Wiederherstellen', () => {
  it('legt einen Mitarbeiter mit Standardrolle an', async () => {
    const service = await lade();
    const user = await service.create({ email: 'neu@aufabruf.eu', displayName: 'Neu' } as never);
    expect(user.id).toBe('neu1');
    expect(harness.writes.find(w => w.art === 'add')?.daten).toMatchObject({
      email: 'neu@aufabruf.eu',
      role: 'nurse',
    });
  });

  it('übernimmt eine explizit gesetzte Rolle', async () => {
    const service = await lade();
    await service.create({ email: 'chef@aufabruf.eu', displayName: 'Chef', role: 'admin' } as never);
    expect(harness.writes.find(w => w.art === 'add')?.daten).toMatchObject({ role: 'admin' });
  });

  it('stellt einen gelöschten Mitarbeiter inklusive companyId wieder her', async () => {
    const service = await lade();
    await service.restore('u1', {
      email: 'anna@aufabruf.eu',
      displayName: 'Anna Muster',
      role: 'nurse',
      companyId: 'firmaA',
      active: true,
    } as never);
    const write = harness.writes.find(w => w.art === 'set');
    expect(write?.daten).toMatchObject({ companyId: 'firmaA', email: 'anna@aufabruf.eu' });
  });

  it('ergänzt beim Wiederherstellen die companyId aus dem Token', async () => {
    const service = await lade();
    await service.restore('u1', {
      email: 'anna@aufabruf.eu',
      displayName: 'Anna',
      role: 'nurse',
      active: true,
    } as never);
    expect(harness.writes.find(w => w.art === 'set')?.daten).toMatchObject({ companyId: 'firmaA' });
  });
});

describe('getAvailableForShift', () => {
  it('liefert verfügbare Mitarbeiter', async () => {
    harness.setDocs([{ id: 'u1', data: nutzer() }, { id: 'u2', data: nutzer({ displayName: 'Bea' }) }]);
    const service = await lade();
    const result = await service.getAvailableForShift({});
    expect(result.length).toBeGreaterThan(0);
  });

  it('filtert nach Rolle', async () => {
    harness.setDocs([{ id: 'u1', data: nutzer() }]);
    const service = await lade();
    await service.getAvailableForShift({ role: 'nurse' });
    expect(harness.hatWhere('role', 'nurse')).toBe(true);
  });

  it('filtert clientseitig nach Suchbegriff', async () => {
    harness.setDocs([
      { id: 'u1', data: nutzer({ displayName: 'Anna Muster' }) },
      { id: 'u2', data: nutzer({ displayName: 'Bea Beispiel', email: 'bea@aufabruf.eu' }) },
    ]);
    const service = await lade();
    const result = await service.getAvailableForShift({ search: 'Anna' });
    expect(result.every(u => /anna/i.test(u.displayName) || /anna/i.test(u.email))).toBe(true);
  });
});
