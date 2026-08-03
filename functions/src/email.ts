import * as functions from 'firebase-functions/v1';

let cachedTransporter: import('nodemailer').Transporter | null = null;

function getSmtpConfig() {
  const smtpHost = process.env.SMTP_HOST;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const smtpFrom = process.env.SMTP_FROM || smtpUser;
  const smtpPort = Number(process.env.SMTP_PORT || 587);
  const smtpSecure = !!process.env.SMTP_SECURE;

  return {
    host: smtpHost,
    user: smtpUser,
    pass: smtpPass,
    from: smtpFrom,
    port: smtpPort,
    secure: smtpSecure,
  };
}

async function getTransporter(): Promise<import('nodemailer').Transporter | null> {
  if (cachedTransporter) return cachedTransporter;
  const config = getSmtpConfig();
  if (!config.host || !config.user || !config.pass || !config.from) {
    return null;
  }
  const nodemailer = await import('nodemailer');
  cachedTransporter = nodemailer.default.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass },
  });

  return cachedTransporter;
}

export interface SendTemplatedEmailPayload {
  to: string;
  subject: string;
  html: string;
  text?: string;
  headers?: Record<string, string>;
}

export async function sendTemplatedEmail(
  payload: SendTemplatedEmailPayload
): Promise<{ success: boolean; fallback?: boolean }> {
  const transporter = await getTransporter();
  const config = getSmtpConfig();

  if (!transporter || !config.from) {
    console.log('[Email:FALLBACK] sendTemplatedEmail', payload);
    return { success: false, fallback: true };
  }

  await transporter.sendMail({
    from: config.from,
    to: payload.to,
    subject: payload.subject,
    html: payload.html,
    text: payload.text,
    headers: payload.headers,
  });

  return { success: true };
}

interface InviteEmailPayload {
  to: string;
  companyName: string;
  acceptLink: string;
}

function renderInviteEmailHtml(payload: InviteEmailPayload): string {
  return `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111;">
      <h2>Einladung zu Schichtklar</h2>
      <p>Sie wurden von <strong>${payload.companyName}</strong> eingeladen, Schichtklar beizutreten.</p>
      <p>Bitte klicken Sie innerhalb von 24 Stunden auf den folgenden Link, um Ihr Konto zu erstellen:</p>
      <p>
        <a href="${payload.acceptLink}" style="display:inline-block;background:#3b82f6;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;">
          Einladung annehmen
        </a>
      </p>
      <p>Falls der Button nicht funktioniert, nutzen Sie diesen Link: <br/>
        <a href="${payload.acceptLink}">${payload.acceptLink}</a>
      </p>
      <p>Wenn Sie diese Einladung nicht erwartet haben, ignorieren Sie diese E-Mail.</p>
    </div>
  `;
}

/** Sendet die Einladungs-E-Mail (ohne Auth – für HTTP-Aufruf aus der API). */
export async function sendInvitationEmailInternal(
  data: InviteEmailPayload
): Promise<{ success: boolean; fallback?: boolean }> {
  const { to, companyName, acceptLink } = data || {} as InviteEmailPayload;
  if (!to || !acceptLink) {
    return { success: false };
  }
  const company = companyName || 'Ihre Firma';
  const html = renderInviteEmailHtml({ to, companyName: company, acceptLink });
  const text = [
    `Sie wurden von ${company} eingeladen, Schichtklar zu nutzen.`,
    `Bitte öffnen Sie innerhalb von 24 Stunden folgenden Link: ${acceptLink}`,
  ].join('\n\n');

  const result = await sendTemplatedEmail({
    to,
    subject: 'Einladung zu Schichtklar',
    html,
    text,
  });
  return { success: !result.fallback, fallback: result.fallback };
}

/** Handler for lazy-load from index (avoids loading nodemailer at deploy). */
export async function sendInvitationEmailHandler(
  data: InviteEmailPayload,
  context: { auth?: { uid: string }; authType?: string }
): Promise<{ success: boolean; fallback?: boolean }> {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
  }
  return sendInvitationEmailInternal(data);
}

export const sendInvitationEmailCF = functions.https.onCall(sendInvitationEmailHandler);

/** HTTP-Variante von sendInvitationEmailHttp ist in index.ts definiert (lazy load). */

export interface RenderFacilityAssignmentTakenPayload {
  employeeName: string;
  facilityName: string;
  dateStr: string;
  timeStr: string;
  contact?: string;
}

export function renderFacilityAssignmentTakenEmail(payload: RenderFacilityAssignmentTakenPayload): string {
  const { employeeName, facilityName, dateStr, timeStr, contact } = payload;
  return `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111;">
      <h2>Einsatz übernommen</h2>
      <p>Guten Tag,</p>
      <p><strong>${employeeName}</strong> übernimmt Ihren Einsatz bei <strong>${facilityName}</strong>.</p>
      ${dateStr ? `<p><strong>Datum:</strong> ${dateStr}</p>` : ''}
      ${timeStr ? `<p><strong>Zeit:</strong> ${timeStr}</p>` : ''}
      ${contact ? `<p><strong>Kontakt:</strong> ${contact}</p>` : ''}
      <p>Vielen Dank!</p>
    </div>
  `;
}

interface AssignmentSignatureEmailPayload {
  to: string;
  employeeName: string;
  assignmentId: string;
  pdfUrl: string;
  facilityName?: string;
  shiftDate?: string;
  recipientType: 'employee' | 'admin' | 'facility';
}

function renderAssignmentSignatureEmailHtml(payload: AssignmentSignatureEmailPayload): string {
  const greeting = payload.employeeName ? `Hallo ${payload.employeeName},` : 'Guten Tag,';
  const recipientText = 
    payload.recipientType === 'employee' 
      ? 'Ihre Zeiterfassung mit allen Unterschriften wurde erfolgreich erstellt.'
      : payload.recipientType === 'admin'
      ? `Die Zeiterfassung für ${payload.employeeName} mit allen Unterschriften wurde erfolgreich erstellt.`
      : `Die Zeiterfassung für ${payload.employeeName} wurde erfolgreich abgeschlossen.`;

  return `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111;">
      <h2>Zeiterfassung mit Unterschriften</h2>
      <p>${greeting}</p>
      <p>${recipientText}</p>
      ${payload.facilityName ? `<p><strong>Einrichtung:</strong> ${payload.facilityName}</p>` : ''}
      ${payload.shiftDate ? `<p><strong>Datum:</strong> ${payload.shiftDate}</p>` : ''}
      <p>Das PDF-Dokument mit allen Unterschriften steht zum Download bereit:</p>
      <p>
        <a href="${payload.pdfUrl}" style="display:inline-block;background:#3b82f6;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;">
          PDF herunterladen
        </a>
      </p>
      <p>Falls der Button nicht funktioniert, nutzen Sie diesen Link: <br/>
        <a href="${payload.pdfUrl}">${payload.pdfUrl}</a>
      </p>
      <p>Vielen Dank!</p>
    </div>
  `;
}

export const sendAssignmentSignatureEmailCF = functions.https.onCall(async (data: AssignmentSignatureEmailPayload, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
  }

  const { to, employeeName, assignmentId, pdfUrl, facilityName, shiftDate, recipientType } = data || {} as AssignmentSignatureEmailPayload;
  if (!to || !employeeName || !assignmentId || !pdfUrl) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing required fields');
  }

  const subject = recipientType === 'employee' 
    ? 'Ihre Zeiterfassung mit Unterschriften'
    : recipientType === 'admin'
    ? `Zeiterfassung mit Unterschriften - ${employeeName}`
    : `Zeiterfassung abgeschlossen - ${employeeName}`;

  const html = renderAssignmentSignatureEmailHtml({ 
    to, 
    employeeName, 
    assignmentId, 
    pdfUrl, 
    facilityName, 
    shiftDate,
    recipientType 
  });

  const result = await sendTemplatedEmail({
    to,
    subject,
    html,
    text: [
      recipientType === 'employee' 
        ? `Hallo ${employeeName},`
        : `Guten Tag,`,
      recipientType === 'employee' 
        ? 'Ihre Zeiterfassung mit allen Unterschriften wurde erfolgreich erstellt.'
        : recipientType === 'admin'
        ? `Die Zeiterfassung für ${employeeName} mit allen Unterschriften wurde erfolgreich erstellt.`
        : `Die Zeiterfassung für ${employeeName} wurde erfolgreich abgeschlossen.`,
      facilityName ? `Einrichtung: ${facilityName}` : '',
      shiftDate ? `Datum: ${shiftDate}` : '',
      `PDF-Download: ${pdfUrl}`,
    ].filter(Boolean).join('\n\n'),
  });

  return { success: true, fallback: result.fallback };
});


