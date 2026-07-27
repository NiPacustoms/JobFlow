import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Serverseitiger Einladungs-Versand: bevorzugt Resend, sonst die
 * Firebase-HTTP-Function, sonst ehrliches "nicht versendet".
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
  vi.stubEnv('RESEND_API_KEY', '');
  vi.stubEnv('RESEND_FROM', '');
  vi.stubEnv('FIREBASE_INVITATION_EMAIL_URL', '');
  vi.stubEnv('INVITATION_EMAIL_SECRET', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Resend-Pfad', () => {
  beforeEach(() => {
    vi.stubEnv('RESEND_API_KEY', 'resend-123');
  });

  it('versendet über die Resend-API mit HTML und Textfassung', async () => {
    fetchMock.mockResolvedValue({ ok: true });
    await expect(sendInvitationEmailServer(einladung)).resolves.toEqual({ sent: true });

    const [url, optionen] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(optionen.headers.Authorization).toBe('Bearer resend-123');
    const body = JSON.parse(optionen.body as string);
    expect(body.to).toBe('anna@aufabruf.eu');
    expect(body.subject).toBe('Einladung zu Schichtklar');
    expect(body.html).toContain('AufAbruf GmbH');
    expect(body.html).toContain(einladung.acceptLink);
    expect(body.text).toContain(einladung.acceptLink);
  });

  it('übernimmt einen konfigurierten Absender', async () => {
    vi.stubEnv('RESEND_FROM', 'AufAbruf <noreply@aufabruf.eu>');
    fetchMock.mockResolvedValue({ ok: true });
    await sendInvitationEmailServer(einladung);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.from).toBe('AufAbruf <noreply@aufabruf.eu>');
  });

  it('meldet API-Fehler mit Statuscode', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 422, text: async () => 'invalid to' });
    await expect(sendInvitationEmailServer(einladung)).resolves.toEqual({
      sent: false,
      error: '422: invalid to',
    });
  });

  it('fängt Netzwerkfehler ab', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    await expect(sendInvitationEmailServer(einladung)).resolves.toEqual({
      sent: false,
      error: 'offline',
    });
  });

  it('nutzt einen Fallback-Firmennamen', async () => {
    fetchMock.mockResolvedValue({ ok: true });
    await sendInvitationEmailServer({ ...einladung, companyName: '' });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.html).toContain('Ihre Firma');
  });
});

describe('Firebase-Function-Fallback', () => {
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
