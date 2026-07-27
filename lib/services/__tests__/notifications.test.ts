import { beforeEach, describe, expect, it, vi } from 'vitest';
import { harness, firestoreModuleMock, ts } from './helpers/firestoreHarness';

/**
 * Benachrichtigungen. Zwei Anforderungen: Mandantentrennung bei JEDER Abfrage
 * und ein sauberer Gelesen-/Ungelesen-Zustand.
 */

vi.mock('@/lib/firebase', () => ({ db: {}, getDb: vi.fn(() => ({})) }));
vi.mock('@/lib/utils/companyId', () => ({
  getCompanyIdFromAuth: vi.fn(async () => 'firmaA'),
}));
vi.mock('firebase/firestore', () => firestoreModuleMock());

const lade = async () => (await import('../notifications')).notificationService;

const hinweis = (id: string, daten: Record<string, unknown> = {}) => ({
  id,
  data: {
    title: 'Neuer Einsatz',
    message: 'Morgen 06:00 Uhr',
    type: 'info',
    read: false,
    important: false,
    userId: 'u1',
    companyId: 'firmaA',
    createdAt: ts(new Date(2026, 6, 20)),
    updatedAt: ts(new Date(2026, 6, 20)),
    ...daten,
  },
});

beforeEach(async () => {
  vi.clearAllMocks();
  harness.reset();
  const { getCompanyIdFromAuth } = await import('@/lib/utils/companyId');
  vi.mocked(getCompanyIdFromAuth).mockResolvedValue('firmaA');
});

describe('notificationService.getAll', () => {
  it('liest die Benachrichtigungen eines Nutzers', async () => {
    harness.setDocs([hinweis('n1'), hinweis('n2', { read: true })]);
    const service = await lade();
    const result = await service.getAll('u1');

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: 'n1', title: 'Neuer Einsatz', read: false });
    expect(result[0].createdAt).toBeInstanceOf(Date);
  });

  it('filtert nach companyId und userId', async () => {
    harness.setDocs([hinweis('n1')]);
    const service = await lade();
    await service.getAll('u1');
    expect(harness.hatWhere('companyId', 'firmaA')).toBe(true);
    expect(harness.hatWhere('userId', 'u1')).toBe(true);
  });

  it('liefert ohne companyId eine leere Liste', async () => {
    const { getCompanyIdFromAuth } = await import('@/lib/utils/companyId');
    vi.mocked(getCompanyIdFromAuth).mockResolvedValue(null);
    const service = await lade();
    expect(await service.getAll('u1')).toEqual([]);
  });

  it('setzt Standardwerte für fehlende Felder', async () => {
    harness.setDocs([{ id: 'n1', data: { title: 'T', message: 'M', userId: 'u1' } }]);
    const service = await lade();
    const [hin] = await service.getAll('u1');
    expect(hin.type).toBe('info');
    expect(hin.read).toBe(false);
    expect(hin.important).toBe(false);
    expect(hin.createdAt).toBeInstanceOf(Date);
  });
});

describe('notificationService.create', () => {
  it('legt eine Benachrichtigung mit companyId an', async () => {
    const service = await lade();
    const id = await service.create({
      title: 'T',
      message: 'M',
      type: 'info',
      userId: 'u1',
      companyId: 'firmaA',
    } as never);

    expect(id).toBe('neu1');
    expect(harness.writes.find(w => w.art === 'add')?.daten).toMatchObject({
      companyId: 'firmaA',
      read: false,
      important: false,
    });
  });

  it('ergänzt die companyId aus dem Nutzerdokument', async () => {
    harness.setDoc({ id: 'u1', data: { companyId: 'firmaAusUser' } });
    const service = await lade();
    await service.create({ title: 'T', message: 'M', type: 'info', userId: 'u1' } as never);
    expect(harness.writes.find(w => w.art === 'add')?.daten).toMatchObject({
      companyId: 'firmaAusUser',
    });
  });

  it('wirft ohne ermittelbare companyId', async () => {
    const { getCompanyIdFromAuth } = await import('@/lib/utils/companyId');
    vi.mocked(getCompanyIdFromAuth).mockResolvedValue(null);
    harness.setDoc(null);
    const service = await lade();
    await expect(
      service.create({ title: 'T', message: 'M', type: 'info' } as never)
    ).rejects.toThrow(/companyId/);
  });
});

describe('notificationService – Lesestatus', () => {
  it('markiert eine Benachrichtigung als gelesen', async () => {
    const service = await lade();
    await service.markAsRead('n1');
    expect(harness.writes.find(w => w.art === 'update')?.daten).toMatchObject({ read: true });
  });

  it('markiert eine Benachrichtigung als ungelesen', async () => {
    const service = await lade();
    await service.markAsUnread('n1');
    expect(harness.writes.find(w => w.art === 'update')?.daten).toMatchObject({ read: false });
  });

  it('markiert alle ungelesenen Benachrichtigungen als gelesen', async () => {
    harness.setDocs([hinweis('n1'), hinweis('n2')]);
    const service = await lade();
    await service.markAllAsRead('u1');
    expect(harness.writes.filter(w => w.art === 'update')).toHaveLength(2);
    expect(harness.hatWhere('read', false)).toBe(true);
  });

  it('tut ohne companyId nichts, statt fremde Daten anzufassen', async () => {
    const { getCompanyIdFromAuth } = await import('@/lib/utils/companyId');
    vi.mocked(getCompanyIdFromAuth).mockResolvedValue(null);
    const service = await lade();
    await service.markAllAsRead('u1');
    expect(harness.writes).toHaveLength(0);
  });
});

describe('notificationService – Löschen', () => {
  it('löscht eine einzelne Benachrichtigung', async () => {
    const service = await lade();
    await service.delete('n1');
    expect(harness.writes.filter(w => w.art === 'delete')).toHaveLength(1);
  });

  it('löscht alle Benachrichtigungen eines Nutzers', async () => {
    harness.setDocs([hinweis('n1'), hinweis('n2'), hinweis('n3')]);
    const service = await lade();
    await service.deleteAll('u1');
    expect(harness.writes.filter(w => w.art === 'delete')).toHaveLength(3);
    expect(harness.hatWhere('companyId', 'firmaA')).toBe(true);
  });

  it('löscht ohne companyId nichts', async () => {
    const { getCompanyIdFromAuth } = await import('@/lib/utils/companyId');
    vi.mocked(getCompanyIdFromAuth).mockResolvedValue(null);
    const service = await lade();
    await service.deleteAll('u1');
    expect(harness.writes).toHaveLength(0);
  });
});

describe('notificationService – Einstellungen', () => {
  it('liefert Standardeinstellungen, wenn nichts hinterlegt ist', async () => {
    harness.setDoc(null);
    const service = await lade();
    const settings = await service.getSettings('u1');
    expect(settings.emailEnabled).toBe(true);
    expect(settings.smsEnabled).toBe(false);
    expect(settings.quietHours).toMatchObject({ enabled: false, start: '22:00', end: '06:00' });
  });

  it('liest hinterlegte Einstellungen', async () => {
    harness.setDoc({
      id: 'u1',
      data: {
        emailEnabled: false,
        smsEnabled: true,
        channels: { app: false, email: true, sms: true },
        preferredLocale: 'en',
      },
    });
    const service = await lade();
    const settings = await service.getSettings('u1');
    expect(settings.emailEnabled).toBe(false);
    expect(settings.smsEnabled).toBe(true);
    expect(settings.channels.app).toBe(false);
  });

  it('speichert geänderte Einstellungen', async () => {
    const service = await lade();
    await service.updateSettings('u1', { emailEnabled: false } as never);
    expect(harness.writes.some(w => w.art === 'set' || w.art === 'update')).toBe(true);
  });
});

describe('notificationService – Versand', () => {
  it('verschickt eine Benachrichtigung an einen Nutzer', async () => {
    harness.setDoc({ id: 'u1', data: { companyId: 'firmaA' } });
    const service = await lade();
    const id = await service.sendNotification('u1', {
      title: 'Neuer Einsatz',
      message: 'Morgen',
      type: 'info',
    } as never);
    expect(id).toBe('neu1');
    expect(harness.writes.find(w => w.art === 'add')?.daten).toMatchObject({
      userId: 'u1',
      read: false,
      companyId: 'firmaA',
    });
  });

  it('verschickt an mehrere Nutzer', async () => {
    harness.setDoc({ id: 'u1', data: { companyId: 'firmaA' } });
    const service = await lade();
    const ids = await service.sendBulkNotification(['u1', 'u2', 'u3'], {
      title: 'Info',
      message: 'An alle',
      type: 'info',
    } as never);
    expect(ids).toHaveLength(3);
    expect(harness.writes.filter(w => w.art === 'add')).toHaveLength(3);
  });

  it('liefert bei leerer Empfängerliste ein leeres Ergebnis', async () => {
    const service = await lade();
    expect(await service.sendBulkNotification([], { title: 'x', message: 'y', type: 'info' } as never)).toEqual(
      []
    );
  });
});

describe('notificationService.getPaginated', () => {
  it('liefert eine Seite mit Gesamtzahl und hasMore-Kennzeichen', async () => {
    harness.setDocs([hinweis('n1'), hinweis('n2')]);
    harness.count = 7;
    const service = await lade();

    const seite = await service.getPaginated(2);
    expect(seite.notifications).toHaveLength(2);
    expect(seite.hasMore).toBe(true); // Seite ist voll
    expect(seite.totalCount).toBe(7);
  });

  it('meldet hasMore=false bei nicht voller Seite', async () => {
    harness.setDocs([hinweis('n1')]);
    harness.count = 1;
    const service = await lade();

    const seite = await service.getPaginated(20);
    expect(seite.hasMore).toBe(false);
  });

  it('blättert mit einem Cursor weiter', async () => {
    harness.setDocs([hinweis('n3')]);
    harness.count = 3;
    const service = await lade();

    const seite = await service.getPaginated(2, { id: 'n2' });
    expect(seite.notifications[0].id).toBe('n3');
  });

  it('liefert ohne companyId eine leere Seite', async () => {
    const { getCompanyIdFromAuth } = await import('@/lib/utils/companyId');
    vi.mocked(getCompanyIdFromAuth).mockResolvedValue(null);
    const service = await lade();

    await expect(service.getPaginated()).resolves.toEqual({
      notifications: [],
      hasMore: false,
      totalCount: 0,
    });
  });
});

describe('notificationService.getSettings – Kanalzuordnung', () => {
  it('bildet Kanäle und Typ-Kanäle mit sicheren Standardwerten ab', async () => {
    harness.setDoc({
      id: 'u1',
      data: {
        smsEnabled: true,
        channels: { app: false, sms: true },
        typeChannels: {
          schicht: { email: false, sms: true },
          kaputt: 'kein-objekt',
        },
        preferredLocale: 'en',
      },
    });
    const service = await lade();

    const einstellungen = await service.getSettings('u1');
    expect(einstellungen.channels).toEqual({ app: false, email: true, sms: true });
    expect(einstellungen.typeChannels).toEqual({
      schicht: { app: true, email: false, sms: true },
    });
    expect(einstellungen.preferredLocale).toBe('en');
  });
});

describe('notificationService.getStats', () => {
  it('zählt gesamt, ungelesen und wichtig über Server-Counts', async () => {
    harness.count = 4;
    const service = await lade();

    const stats = await service.getStats();
    // Der Harness liefert für alle Count-Abfragen denselben Zähler
    expect(stats).toEqual({ total: 4, unread: 4, read: 0, important: 4 });
  });
});
