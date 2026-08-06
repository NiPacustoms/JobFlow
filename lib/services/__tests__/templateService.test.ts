import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Vorlagen-Verwaltung (Benachrichtigungs-/E-Mail-Templates) über die
 * /api/templates-Routen mit Bearer-Token.
 */

const zustand = vi.hoisted(() => ({
  currentUser: null as null | { getIdToken: () => Promise<string> },
}));

vi.mock('@/lib/firebase', () => ({
  auth: {
    get currentUser() {
      return zustand.currentUser;
    },
  },
}));

import { templateService } from '../templateService';

const fetchMock = vi.fn();

const templateAntwort = (overrides: Record<string, unknown> = {}) => ({
  id: 'tpl1',
  key: 'shift-assigned',
  channel: 'email',
  name: 'Einsatz zugewiesen',
  status: 'active',
  createdAt: '2026-07-01T10:00:00.000Z',
  updatedAt: '2026-07-20T10:00:00.000Z',
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  zustand.currentUser = { getIdToken: async () => 'token-123' };
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ data: [templateAntwort()] }),
  });
});

describe('list', () => {
  it('lädt Vorlagen mit Auth-Header und wandelt Zeitstempel um', async () => {
    const vorlagen = await templateService.list();

    expect(fetchMock).toHaveBeenCalledWith('/api/templates', {
      method: 'GET',
      headers: expect.objectContaining({ Authorization: 'Bearer token-123' }),
    });
    expect(vorlagen[0].createdAt).toBeInstanceOf(Date);
    expect(vorlagen[0].updatedAt.getFullYear()).toBe(2026);
  });

  it('baut die Filter als Query-String', async () => {
    await templateService.list({
      channel: 'email' as never,
      status: 'active' as never,
      locale: 'de',
      key: 'shift-assigned',
      search: 'Einsatz',
    });
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/api/templates?');
    expect(url).toContain('channel=email');
    expect(url).toContain('status=active');
    expect(url).toContain('locale=de');
    expect(url).toContain('search=Einsatz');
  });

  it('wirft die Fehlermeldung des Servers', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ message: 'Keine Berechtigung' }),
    });
    await expect(templateService.list()).rejects.toThrow('Keine Berechtigung');
  });

  it('wirft einen HTTP-Fehler, wenn der Server keine Meldung liefert', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error('kein JSON');
      },
    });
    await expect(templateService.list()).rejects.toThrow('HTTP 500');
  });

  it('verlangt einen angemeldeten Benutzer', async () => {
    zustand.currentUser = null;
    await expect(templateService.list()).rejects.toThrow('Kein authentifizierter Benutzer');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('get / create / update / remove', () => {
  it('lädt eine einzelne Vorlage', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: templateAntwort() }) });
    const vorlage = await templateService.get('tpl1');
    expect(fetchMock).toHaveBeenCalledWith('/api/templates/tpl1', expect.objectContaining({ method: 'GET' }));
    expect(vorlage.id).toBe('tpl1');
  });

  it('verlangt eine Template-ID', async () => {
    await expect(templateService.get('')).rejects.toThrow('Template-ID fehlt');
    await expect(templateService.update('', {})).rejects.toThrow('Template-ID fehlt');
    await expect(templateService.remove('')).rejects.toThrow('Template-ID fehlt');
  });

  it('legt eine Vorlage per POST an', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: templateAntwort() }) });
    await templateService.create({
      key: 'shift-assigned',
      channel: 'email' as never,
      name: 'Einsatz zugewiesen',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/templates',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('shift-assigned'),
      })
    );
  });

  it('aktualisiert per PATCH und löscht per DELETE', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ data: templateAntwort() }) });
    await templateService.update('tpl1', { name: 'Neu' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/templates/tpl1',
      expect.objectContaining({ method: 'PATCH' })
    );

    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    await templateService.remove('tpl1');
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/templates/tpl1',
      expect.objectContaining({ method: 'DELETE' })
    );
  });

  it('meldet Fehler beim Anlegen und Löschen', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ message: 'Schlüssel existiert bereits' }),
    });
    await expect(
      templateService.create({ key: 'x', channel: 'email' as never, name: 'X' })
    ).rejects.toThrow('Schlüssel existiert bereits');
    await expect(templateService.remove('tpl1')).rejects.toThrow('Schlüssel existiert bereits');
  });
});
