/**
 * Serverseitiger E-Mail-Versand für Einladungen.
 * Ruft die Firebase Cloud Function sendInvitationEmailHttp auf, die per
 * SMTP (nodemailer, functions/.env) versendet.
 *
 * Env: FIREBASE_INVITATION_EMAIL_URL + INVITATION_EMAIL_SECRET.
 */

import { logger } from '@/lib/logging';

export interface InviteEmailPayload {
  to: string;
  companyName: string;
  acceptLink: string;
}

/**
 * Sendet die Einladungs-E-Mail über die Firebase HTTP Function (SMTP).
 */
export async function sendInvitationEmailServer(
  payload: InviteEmailPayload
): Promise<{ sent: boolean; error?: string }> {
  const companyName = payload.companyName || 'Ihre Firma';
  const url = process.env.FIREBASE_INVITATION_EMAIL_URL?.trim();
  const secret = process.env.INVITATION_EMAIL_SECRET?.trim();
  if (!url || !secret) {
    logger.warn(
      '[Email] FIREBASE_INVITATION_EMAIL_URL/INVITATION_EMAIL_SECRET nicht gesetzt',
      {},
      { to: payload.to }
    );
    return { sent: false };
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({
        to: payload.to,
        companyName,
        acceptLink: payload.acceptLink,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      logger.error('[Email] Firebase Function Fehler', new Error(`${res.status}: ${text}`), { to: payload.to });
      return { sent: false, error: `${res.status}: ${text}` };
    }

    const data = (await res.json().catch(() => ({}))) as { success?: boolean; fallback?: boolean };
    const sent = data?.success === true && data?.fallback !== true;
    if (sent) {
      logger.info('[Email] Einladung versendet (Firebase)', {}, { to: payload.to });
    } else {
      logger.warn('[Email] Einladung nicht versendet (Function/SMTP)', {}, { to: payload.to });
    }
    return { sent };
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    logger.error('[Email] Einladungs-Versand fehlgeschlagen', err, { to: payload.to });
    return { sent: false, error: err.message };
  }
}
