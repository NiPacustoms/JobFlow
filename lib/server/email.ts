/**
 * Serverseitiger E-Mail-Versand für Einladungen und Einsatz-Formulare.
 * Ruft die Firebase Cloud Functions sendInvitationEmailHttp bzw.
 * sendAssignmentFormEmailHttp auf, die per SMTP (nodemailer, functions/.env)
 * versenden.
 *
 * Env: FIREBASE_INVITATION_EMAIL_URL, FIREBASE_FORM_EMAIL_URL,
 * INVITATION_EMAIL_SECRET (gemeinsames Secret beider Functions).
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

export interface AssignmentFormEmailServerPayload {
  to: string;
  formLink: string;
  employeeName?: string;
  shiftInfo?: string;
}

/**
 * Sendet die Einsatz-Formular-E-Mail über die Firebase HTTP Function (SMTP).
 * Für serverseitige Aufrufer wie den Erinnerungs-Job /api/forms/reminders.
 */
export async function sendAssignmentFormEmailServer(
  payload: AssignmentFormEmailServerPayload
): Promise<{ sent: boolean; error?: string }> {
  const url = process.env.FIREBASE_FORM_EMAIL_URL?.trim();
  const secret = process.env.INVITATION_EMAIL_SECRET?.trim();
  if (!url || !secret) {
    logger.warn(
      '[Email] FIREBASE_FORM_EMAIL_URL/INVITATION_EMAIL_SECRET nicht gesetzt',
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
        formLink: payload.formLink,
        employeeName: payload.employeeName,
        shiftInfo: payload.shiftInfo,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      logger.error('[Email] Firebase Function Fehler (Formular)', new Error(`${res.status}: ${text}`), { to: payload.to });
      return { sent: false, error: `${res.status}: ${text}` };
    }

    const data = (await res.json().catch(() => ({}))) as { success?: boolean; fallback?: boolean };
    const sent = data?.success === true && data?.fallback !== true;
    if (sent) {
      logger.info('[Email] Formular-E-Mail versendet (Firebase)', {}, { to: payload.to });
    } else {
      logger.warn('[Email] Formular-E-Mail nicht versendet (Function/SMTP)', {}, { to: payload.to });
    }
    return { sent };
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    logger.error('[Email] Formular-E-Mail-Versand fehlgeschlagen', err, { to: payload.to });
    return { sent: false, error: err.message };
  }
}
