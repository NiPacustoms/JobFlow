import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest, NextResponse } from 'next/server';

/**
 * Rate-Limiting der API-Routen: Pfad-Typen, IP- vs. Nutzer-Schlüssel und die
 * 429-Antwort mit den üblichen Headern.
 */

const checkMock = vi.fn();
const getRateLimiter = vi.fn(() => ({ check: checkMock }));
vi.mock('@/lib/utils/rateLimit', () => ({
  getRateLimiter: (...a: unknown[]) => getRateLimiter(...a),
}));

import { checkRateLimit, addRateLimitHeaders, RATE_LIMIT_CONFIGS } from '../rateLimit';

const anfrage = (pfad: string, header: Record<string, string> = {}): NextRequest =>
  ({
    nextUrl: { pathname: pfad },
    headers: new Headers(header),
  }) as unknown as NextRequest;

beforeEach(() => {
  vi.clearAllMocks();
  checkMock.mockReturnValue({ allowed: true, remaining: 4, retryAfterSeconds: 0 });
});

describe('checkRateLimit', () => {
  it('lässt erlaubte Anfragen ohne Antwort durch', () => {
    expect(checkRateLimit(anfrage('/api/auth/login'))).toBeNull();
    expect(getRateLimiter).toHaveBeenCalledWith({ windowMs: 60_000, max: 5 });
  });

  it('bildet IP-Schlüssel aus x-forwarded-for bzw. x-real-ip', () => {
    checkRateLimit(anfrage('/api/auth/login', { 'x-forwarded-for': '10.0.0.1, 10.0.0.2' }));
    expect(checkMock).toHaveBeenCalledWith('auth:ip:10.0.0.1');

    checkRateLimit(anfrage('/api/health', { 'x-real-ip': '10.0.0.3' }));
    expect(checkMock).toHaveBeenCalledWith('health:ip:10.0.0.3');

    checkRateLimit(anfrage('/api/auth/login'));
    expect(checkMock).toHaveBeenCalledWith('auth:ip:unknown');
  });

  it('nutzt für Admin- und Vorlagen-Routen den Nutzer-Schlüssel', () => {
    checkRateLimit(anfrage('/api/admin/users'), 'admin1');
    expect(checkMock).toHaveBeenCalledWith('admin:user:admin1');
    expect(getRateLimiter).toHaveBeenLastCalledWith({ windowMs: 60_000, max: 30 });

    checkRateLimit(anfrage('/api/templates/render'), 'admin1');
    expect(checkMock).toHaveBeenCalledWith('templates:user:admin1');
  });

  it('fällt für unbekannte Pfade auf die Standardkonfiguration zurück', () => {
    checkRateLimit(anfrage('/api/sonstiges'));
    expect(getRateLimiter).toHaveBeenLastCalledWith({
      windowMs: RATE_LIMIT_CONFIGS.default.windowMs,
      max: RATE_LIMIT_CONFIGS.default.max,
    });
    expect(checkMock).toHaveBeenCalledWith('default:ip:unknown');
  });

  it('antwortet bei Überschreitung mit 429 und Rate-Limit-Headern', async () => {
    checkMock.mockReturnValue({ allowed: false, remaining: 0, retryAfterSeconds: 30 });
    const antwort = checkRateLimit(anfrage('/api/auth/login')) as NextResponse;

    expect(antwort).not.toBeNull();
    expect(antwort.status).toBe(429);
    expect(antwort.headers.get('X-RateLimit-Limit')).toBe('5');
    expect(antwort.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(antwort.headers.get('Retry-After')).toBe('30');
    await expect(antwort.json()).resolves.toMatchObject({ retryAfter: 30 });
  });
});

describe('addRateLimitHeaders', () => {
  it('ergänzt Informations-Header auf erfolgreichen Antworten', async () => {
    checkMock.mockReturnValue({ allowed: true, remaining: 27, retryAfterSeconds: 12 });
    const { NextResponse } = await import('next/server');
    const antwort = NextResponse.json({ ok: true });

    const ergebnis = addRateLimitHeaders(antwort, anfrage('/api/admin/users'), 'admin1');
    expect(ergebnis.headers.get('X-RateLimit-Limit')).toBe('30');
    expect(ergebnis.headers.get('X-RateLimit-Remaining')).toBe('27');
    expect(ergebnis.headers.get('X-RateLimit-Reset')).toBeTruthy();
  });
});
