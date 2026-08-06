import { beforeEach, describe, expect, it, vi } from 'vitest';
import { harness, firestoreModuleMock, ts } from './helpers/firestoreHarness';

/**
 * Mitarbeiter-Benachrichtigungen (Posteingang der Pflegekraft):
 * Filter, Lesestatus, Markieren, Archivieren, Sammelaktionen.
 */

vi.mock('@/lib/firebase', () => ({ db: {}, getDb: vi.fn(() => ({})) }));
vi.mock('firebase/firestore', () => firestoreModuleMock());

const lade = async () => (await import('../employeeNotifications')).employeeNotificationsService;

const hinweis = (id: string, daten: Record<string, unknown> = {}) => ({
  id,
  data: {
    userId: 'u1',
    title: 'Neue Schicht',
    message: 'Morgen 06:00',
    type: 'shift',
    priority: 'medium',
    read: false,
    starred: false,
    archived: false,
    createdAt: ts(new Date(2026, 6, 20)),
    updatedAt: ts(new Date(2026, 6, 20)),
    ...daten,
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  harness.reset();
});

describe('getAll', () => {
  it('liest die Benachrichtigungen eines Mitarbeiters', async () => {
    harness.setDocs([hinweis('n1'), hinweis('n2', { read: true })]);
    const service = await lade();
    const result = await service.getAll('u1');
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: 'n1', type: 'shift', priority: 'medium' });
  });

  it('filtert zusätzlich nach companyId, wenn übergeben', async () => {
    harness.setDocs([hinweis('n1')]);
    const service = await lade();
    await service.getAll('u1', 'firmaA');
    expect(harness.hatWhere('companyId', 'firmaA')).toBe(true);
    expect(harness.hatWhere('userId', 'u1')).toBe(true);
  });

  it('filtert ohne companyId nur nach userId (Migration)', async () => {
    harness.setDocs([hinweis('n1')]);
    const service = await lade();
    await service.getAll('u1');
    expect(harness.hatWhere('userId', 'u1')).toBe(true);
    expect(harness.hatWhere('companyId')).toBe(false);
  });

  it('setzt Standardwerte für fehlende Felder', async () => {
    harness.setDocs([{ id: 'n1', data: { userId: 'u1', title: 'T', message: 'M', type: 'info' } }]);
    const service = await lade();
    const [hin] = await service.getAll('u1');
    expect(hin.priority).toBe('medium');
    expect(hin.read).toBe(false);
    expect(hin.starred).toBe(false);
    expect(hin.archived).toBe(false);
  });

  it('wirft ohne Benutzer-ID', async () => {
    const service = await lade();
    await expect(service.getAll(undefined)).rejects.toThrow();
  });
});

describe('Lesestatus und Markierungen', () => {
  it.each([
    ['markAsRead', { read: true }],
    ['markAsUnread', { read: false }],
    ['starNotification', { starred: true }],
    ['unstarNotification', { starred: false }],
    ['archiveNotification', { archived: true }],
    ['unarchiveNotification', { archived: false }],
  ] as const)('%s schreibt den erwarteten Zustand', async (methode, erwartet) => {
    const service = await lade();
    await (service as unknown as Record<string, (id: string) => Promise<void>>)[methode]('n1');
    expect(harness.writes.find(w => w.art === 'update')?.daten).toMatchObject(erwartet);
  });

  it('markiert alle Benachrichtigungen als gelesen', async () => {
    harness.setDocs([hinweis('n1'), hinweis('n2')]);
    const service = await lade();
    await service.markAllAsRead('u1');
    expect(harness.writes.filter(w => w.art === 'update')).toHaveLength(2);
  });
});

describe('Löschen', () => {
  it('löscht eine Benachrichtigung', async () => {
    const service = await lade();
    await service.deleteNotification('n1');
    expect(harness.writes.filter(w => w.art === 'delete')).toHaveLength(1);
  });

  it('löscht alle Benachrichtigungen eines Mitarbeiters', async () => {
    harness.setDocs([hinweis('n1'), hinweis('n2')]);
    const service = await lade();
    await service.deleteAllNotifications('u1');
    expect(harness.writes.filter(w => w.art === 'delete')).toHaveLength(2);
  });
});

describe('Filter und Zähler', () => {
  it('zählt ungelesene Benachrichtigungen', async () => {
    harness.setDocs([hinweis('n1'), hinweis('n2')]);
    const service = await lade();
    expect(await service.getUnreadCount('u1')).toBe(2);
    expect(harness.hatWhere('read', false)).toBe(true);
  });

  it('filtert nach Typ', async () => {
    harness.setDocs([hinweis('n1', { type: 'shift' })]);
    const service = await lade();
    const result = await service.getByType('shift', 'u1');
    expect(result).toHaveLength(1);
    expect(harness.hatWhere('type', 'shift')).toBe(true);
  });

  it('filtert nach Priorität', async () => {
    harness.setDocs([hinweis('n1', { priority: 'high' })]);
    const service = await lade();
    const result = await service.getByPriority('high', 'u1');
    expect(result).toHaveLength(1);
    expect(harness.hatWhere('priority', 'high')).toBe(true);
  });

  it('liefert eine Statistik', async () => {
    harness.setDocs([
      hinweis('n1', { read: false, starred: true }),
      hinweis('n2', { read: true }),
      hinweis('n3', { read: false, archived: true }),
    ]);
    const service = await lade();
    const stats = await service.getStats('u1');
    expect(stats.total).toBe(3);
    expect(stats.unread).toBeGreaterThan(0);
  });
});

describe('Anlegen und Sammelaktionen', () => {
  it('legt eine Benachrichtigung an', async () => {
    const service = await lade();
    const id = await service.createNotification({
      userId: 'u1',
      title: 'T',
      message: 'M',
      type: 'info',
      priority: 'low',
      read: false,
    } as never);
    expect(id).toBe('neu1');
  });

  it('markiert mehrere Benachrichtigungen als gelesen', async () => {
    const service = await lade();
    await service.bulkMarkAsRead(['n1', 'n2', 'n3']);
    expect(harness.writes.filter(w => w.art === 'update')).toHaveLength(3);
  });

  it('löscht mehrere Benachrichtigungen', async () => {
    const service = await lade();
    await service.bulkDelete(['n1', 'n2']);
    expect(harness.writes.filter(w => w.art === 'delete')).toHaveLength(2);
  });

  it('archiviert mehrere Benachrichtigungen', async () => {
    const service = await lade();
    await service.bulkArchive(['n1', 'n2']);
    expect(harness.writes.filter(w => w.art === 'update')).toHaveLength(2);
  });
});

describe('Einstellungen', () => {
  it('liefert Standardeinstellungen, wenn keine hinterlegt sind', async () => {
    harness.setDocs([]);
    const service = await lade();
    const settings = await service.getSettings('u1');
    expect(settings).toMatchObject({
      emailNotifications: true,
      smsNotifications: false,
      emailFrequency: 'immediate',
      quietHoursStart: '22:00',
      quietHoursEnd: '07:00',
    });
  });

  it('liest hinterlegte Einstellungen', async () => {
    harness.setDocs([
      { id: 's1', data: { userId: 'u1', emailNotifications: false, smsNotifications: true } },
    ]);
    const service = await lade();
    const settings = await service.getSettings('u1');
    expect(settings.emailNotifications).toBe(false);
    expect(settings.smsNotifications).toBe(true);
    expect(settings.pushNotifications).toBe(true);
  });

  it('legt ein Einstellungsdokument an, wenn noch keines existiert', async () => {
    harness.setDocs([]);
    const service = await lade();
    await service.updateSettings('u1', { emailNotifications: false } as never);
    expect(harness.writes.find(w => w.art === 'add')?.daten).toMatchObject({
      userId: 'u1',
      emailNotifications: false,
    });
  });

  it('aktualisiert ein vorhandenes Einstellungsdokument', async () => {
    harness.setDocs([{ id: 's1', data: { userId: 'u1' } }]);
    const service = await lade();
    await service.updateSettings('u1', { emailNotifications: false } as never);
    expect(harness.writes.find(w => w.art === 'update')?.daten).toMatchObject({
      emailNotifications: false,
    });
  });
});

describe('Einzelne Zustandsänderungen', () => {
  it.each([
    ['markAsRead', { read: true }],
    ['markAsUnread', { read: false }],
    ['starNotification', { starred: true }],
    ['unstarNotification', { starred: false }],
    ['archiveNotification', { archived: true }],
    ['unarchiveNotification', { archived: false }],
  ])('%s schreibt das erwartete Feld', async (methode, erwartet) => {
    const service = await lade();
    await (service as unknown as Record<string, (id: string) => Promise<void>>)[methode]('n1');

    const update = harness.writes.find(w => w.art === 'update')?.daten as Record<string, unknown>;
    expect(update).toMatchObject(erwartet);
    expect(update.updatedAt).toBe('SERVER_TIMESTAMP');
  });

  it('reicht Schreibfehler weiter', async () => {
    const firestore = await import('firebase/firestore');
    vi.mocked(firestore.updateDoc).mockRejectedValueOnce(new Error('Rules verweigern'));
    const service = await lade();
    await expect(service.markAsRead('n1')).rejects.toThrow('Rules verweigern');
  });
});

describe('sendNotification', () => {
  it('legt eine Benachrichtigung mit Standardwerten an', async () => {
    const service = await lade();
    const id = await service.sendNotification({
      userId: 'u1',
      title: 'Neue Schicht',
      message: 'Morgen 06:00',
      type: 'shift',
    });

    expect(typeof id).toBe('string');
    const daten = harness.writes.find(w => w.art === 'add')?.daten as Record<string, unknown>;
    expect(daten).toMatchObject({
      userId: 'u1',
      priority: 'medium',
      read: false,
      starred: false,
      archived: false,
    });
  });

  it('übernimmt eine ausdrücklich gesetzte Priorität und Zusatzangaben', async () => {
    const service = await lade();
    await service.sendNotification({
      userId: 'u1',
      title: 'Dringend',
      message: 'Bitte melden',
      type: 'alert',
      priority: 'high',
      details: 'Rückruf erbeten',
      actionUrl: '/schedule',
      metadata: { shiftId: 's1' },
    });

    const daten = harness.writes.find(w => w.art === 'add')?.daten as Record<string, unknown>;
    expect(daten).toMatchObject({
      priority: 'high',
      details: 'Rückruf erbeten',
      actionUrl: '/schedule',
      metadata: { shiftId: 's1' },
    });
  });

  it('reicht Fehler beim Anlegen weiter', async () => {
    const firestore = await import('firebase/firestore');
    vi.mocked(firestore.addDoc).mockRejectedValueOnce(new Error('Rules verweigern'));
    const service = await lade();
    await expect(
      service.sendNotification({ userId: 'u1', title: 'x', message: 'y', type: 'info' })
    ).rejects.toThrow('Rules verweigern');
  });
});
