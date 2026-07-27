import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Konfiguration geplanter Berichte (Admin): CRUD über die API-Routen und das
 * manuelle Auslösen. Die companyId setzt die API aus dem Token.
 */

const authZustand = vi.hoisted(() => ({
  currentUser: null as null | { getIdToken: () => Promise<string> },
}));

vi.mock('@/lib/firebase', () => ({
  auth: {
    get currentUser() {
      return authZustand.currentUser;
    },
  },
}));

import { scheduledReportConfigService } from '../scheduledReportConfigService';

const fetchMock = vi.fn();

const konfiguration = {
  id: 'cfg1',
  name: 'Monatsbericht',
  companyId: 'firmaA',
  frequency: 'monthly',
  recipients: ['info@aufabruf.eu'],
};

beforeEach(() => {
  vi.clearAllMocks();
  authZustand.currentUser = { getIdToken: async () => 'token-123' };
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ items: [konfiguration] }) });
});

describe('list', () => {
  it('lädt die Konfigurationen mit Bearer-Token', async () => {
    const liste = await scheduledReportConfigService.list();

    expect(liste).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/scheduled-reports', {
      headers: expect.objectContaining({ Authorization: 'Bearer token-123' }),
    });
  });

  it('liefert eine leere Liste, wenn die API kein items-Feld schickt', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    await expect(scheduledReportConfigService.list()).resolves.toEqual([]);
  });

  it('verlangt eine Anmeldung', async () => {
    authZustand.currentUser = null;
    await expect(scheduledReportConfigService.list()).rejects.toThrow(/angemeldet/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('meldet Server-Fehler mit der API-Meldung', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ message: 'Datenbank nicht erreichbar' }),
    });
    await expect(scheduledReportConfigService.list()).rejects.toThrow('Datenbank nicht erreichbar');
  });

  it('meldet einen Standardtext, wenn die API keine Meldung liefert', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error('kein JSON');
      },
    });
    await expect(scheduledReportConfigService.list()).rejects.toThrow('Fehler beim Laden');
  });
});

describe('getById', () => {
  it('liefert eine einzelne Konfiguration', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => konfiguration });
    await expect(scheduledReportConfigService.getById('cfg1')).resolves.toMatchObject({
      id: 'cfg1',
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/scheduled-reports/cfg1', expect.anything());
  });

  it('liefert null, wenn die Konfiguration nicht existiert', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
    await expect(scheduledReportConfigService.getById('weg')).resolves.toBeNull();
  });

  it('meldet andere Fehler', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ message: 'Keine Berechtigung' }),
    });
    await expect(scheduledReportConfigService.getById('cfg1')).rejects.toThrow('Keine Berechtigung');
  });
});

describe('create / update / delete', () => {
  it('legt eine Konfiguration an und liefert die ID', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => ({ id: 'cfg9' }) });
    await expect(
      scheduledReportConfigService.create({ name: 'Wochenbericht' } as never)
    ).resolves.toEqual({ id: 'cfg9' });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/scheduled-reports',
      expect.objectContaining({ method: 'POST', body: expect.stringContaining('Wochenbericht') })
    );
  });

  it('aktualisiert per PATCH', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    await scheduledReportConfigService.update('cfg1', { name: 'Neu' } as never);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/scheduled-reports/cfg1',
      expect.objectContaining({ method: 'PATCH' })
    );
  });

  it('löscht per DELETE', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    await scheduledReportConfigService.delete('cfg1');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/scheduled-reports/cfg1',
      expect.objectContaining({ method: 'DELETE' })
    );
  });

  it('meldet Fehler beim Anlegen, Aktualisieren und Löschen', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ message: 'Empfänger fehlt' }),
    });
    await expect(scheduledReportConfigService.create({} as never)).rejects.toThrow('Empfänger fehlt');
    await expect(scheduledReportConfigService.update('cfg1', {} as never)).rejects.toThrow(
      'Empfänger fehlt'
    );
    await expect(scheduledReportConfigService.delete('cfg1')).rejects.toThrow('Empfänger fehlt');
  });
});

describe('runNow', () => {
  it('löst die Ausführung über den Proxy aus', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
    await expect(scheduledReportConfigService.runNow()).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/scheduled-reports/run',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('nimmt Erfolg an, wenn die API kein ok-Feld liefert', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    await expect(scheduledReportConfigService.runNow()).resolves.toEqual({ ok: true });
  });

  it('meldet einen Fehlschlag der Ausführung', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ message: 'Cloud Function nicht erreichbar' }),
    });
    await expect(scheduledReportConfigService.runNow()).rejects.toThrow(
      'Cloud Function nicht erreichbar'
    );
  });
});
