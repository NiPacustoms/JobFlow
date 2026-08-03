import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Serverseitiger Einladungs-Versand: über die Firebase-HTTP-Function
 * (SMTP), sonst ehrliches "nicht versendet".
 */

vi.mock('@/lib/logging', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { sendInvitationEmailServer } from '../email';

const fetchMock = vi.fn();

const einladung = {
  to: 'anna@aufabruf.eu',
  companyName: 'AufAbruf GmbH',
  acceptLink: 'https://schichtklar.example/invite/abc',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('FIREBASE_INVITATION_EMAIL_URL', '');
  vi.stubEnv('INVITATION_EMAIL_SECRET', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Firebase-Function-Versand', () => {
  beforeEach(() => {
    vi.stubEnv('FIREBASE_INVITATION_EMAIL_URL', 'https://cf.example/sendInvitationEmailHttp');
    vi.stubEnv('INVITATION_EMAIL_SECRET', 'geheim-1');
  });

  it('versendet über die Cloud Function', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    await expect(sendInvitationEmailServer(einladung)).resolves.toEqual({ sent: true });

    const [url, optionen] = fetchMock.mock.calls[0];
    expect(url).toBe('https://cf.example/sendInvitationEmailHttp');
    expect(optionen.headers.Authorization).toBe('Bearer geheim-1');
    const body = JSON.parse(optionen.body as string);
    expect(body.to).toBe('anna@aufabruf.eu');
    expect(body.companyName).toBe('AufAbruf GmbH');
    expect(body.acceptLink).toBe(einladung.acceptLink);
  });

  it('nutzt einen Fallback-Firmennamen', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    await sendInvitationEmailServer({ ...einladung, companyName: '' });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.companyName).toBe('Ihre Firma');
  });

  it('meldet "nicht versendet", wenn die Function nur den Fallback nutzte', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, fallback: true }),
    });
    await expect(sendInvitationEmailServer(einladung)).resolves.toEqual({ sent: false });
  });

  it('meldet Function-Fehler mit Statuscode', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, text: async () => 'bad secret' });
    await expect(sendInvitationEmailServer(einladung)).resolves.toEqual({
      sent: false,
      error: '401: bad secret',
    });
  });

  it('fängt Netzwerkfehler der Function ab', async () => {
    fetchMock.mockRejectedValue(new Error('timeout'));
    await expect(sendInvitationEmailServer(einladung)).resolves.toEqual({
      sent: false,
      error: 'timeout',
    });
  });
});

describe('ohne Konfiguration', () => {
  it('meldet ehrlich, dass nichts versendet wurde', async () => {
    await expect(sendInvitationEmailServer(einladung)).resolves.toEqual({ sent: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
