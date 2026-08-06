/**
 * E-Mail-Outbox: zuverlässiger, ereignisgesteuerter Bestätigungsmail-Versand.
 *
 * Muster:
 * 1. Firestore-Trigger erkennen Zustandswechsel (Einsatz angenommen/abgelehnt,
 *    Zeiterfassung eingereicht) und legen ein Outbox-Dokument mit
 *    DETERMINISTISCHER ID an (create() → Doppelversand unmöglich).
 * 2. Ein Worker-Trigger versendet beim Anlegen über sendTemplatedEmail und
 *    protokolliert Status (queued → sent/failed) samt Versuchszähler.
 * 3. Ein stündlicher Retry-Job versucht fehlgeschlagene Mails erneut
 *    (max. MAX_ATTEMPTS Versuche).
 *
 * Die Collection emailOutbox ist rein serverseitig (Firestore-Rules: deny all;
 * der Admin-SDK der Functions umgeht die Rules).
 */
import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import { sendTemplatedEmail } from './email';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const OUTBOX = 'emailOutbox';
const MAX_ATTEMPTS = 5;
/** Zentrale als fester Mit-Empfänger (überschreibbar per ENV). */
const CENTRAL_EMAIL = process.env.CENTRAL_EMAIL || 'info@aufabruf.eu';

/* ── Gebrandetes Basis-Template (analog brandedPdf: Teal, Firmen-Fußzeile) ── */

export function renderBrandedEmail(opts: {
  title: string;
  greeting?: string;
  bodyHtml: string;
}): string {
  return `
  <div style="margin:0;padding:24px 12px;background:#f5f5f4;font-family:Arial,Helvetica,sans-serif;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e7e5e4;">
      <div style="padding:18px 24px;border-bottom:3px solid #0f766e;">
        <span style="font-size:18px;font-weight:bold;color:#1c1917;">AufAbruf</span>
        <span style="font-size:12px;color:#78716c;"> · Personaldienstleistungs GmbH</span>
      </div>
      <div style="padding:24px;">
        <h2 style="margin:0 0 12px;font-size:18px;color:#1c1917;">${opts.title}</h2>
        ${opts.greeting ? `<p style="margin:0 0 12px;color:#1c1917;">${opts.greeting}</p>` : ''}
        <div style="color:#1c1917;font-size:14px;line-height:1.6;">${opts.bodyHtml}</div>
      </div>
      <div style="padding:14px 24px;border-top:1px solid #e7e5e4;background:#fafaf9;">
        <p style="margin:0;font-size:11px;color:#78716c;">
          AufAbruf GmbH · Herner Straße 134 · 45699 Herten · Tel. 02366 58 292 58 · info@aufabruf.eu<br/>
          Diese Nachricht wurde automatisch von Schichtklar erstellt.
        </p>
      </div>
    </div>
  </div>`;
}

/** Datentabelle für Mail-Inhalte (Label/Wert-Zeilen). */
function detailRows(rows: Array<[string, string]>): string {
  const tr = rows
    .filter(([, v]) => !!v)
    .map(
      ([label, value]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#78716c;white-space:nowrap;">${label}</td><td style="padding:4px 0;color:#1c1917;"><strong>${value}</strong></td></tr>`
    )
    .join('');
  return `<table style="border-collapse:collapse;margin:8px 0 4px;">${tr}</table>`;
}

/* ── Outbox-Kern ─────────────────────────────────────────────────────────── */

interface QueueEmailInput {
  to: string;
  subject: string;
  html: string;
  event: string;
  refId: string;
}

/**
 * Legt ein Outbox-Dokument idempotent an. Die ID kodiert Ereignis + Empfänger,
 * create() schlägt bei existierendem Dokument fehl → kein Doppelversand.
 */
async function queueEmail(id: string, input: QueueEmailInput): Promise<void> {
  try {
    await db
      .collection(OUTBOX)
      .doc(id)
      .create({
        ...input,
        status: 'queued',
        attempts: 0,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
  } catch (e) {
    const code = (e as { code?: number | string }).code;
    // 6 = ALREADY_EXISTS → Ereignis wurde bereits eingereiht, alles gut
    if (code !== 6 && code !== 'already-exists') throw e;
  }
}

async function attemptSend(ref: admin.firestore.DocumentReference): Promise<void> {
  const snap = await ref.get();
  if (!snap.exists) return;
  const data = snap.data() as QueueEmailInput & { status: string; attempts: number };
  if (data.status === 'sent') return;
  if (data.attempts >= MAX_ATTEMPTS) return;

  try {
    const result = await sendTemplatedEmail({
      to: data.to,
      subject: data.subject,
      html: data.html,
    });
    if (result.success) {
      await ref.update({
        status: 'sent',
        attempts: admin.firestore.FieldValue.increment(1),
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } else {
      // Fallback (kein SMTP konfiguriert): als failed markieren, Retry-Job versucht später erneut
      await ref.update({
        status: 'failed',
        attempts: admin.firestore.FieldValue.increment(1),
        lastError: 'SMTP nicht konfiguriert (Fallback-Log)',
      });
    }
  } catch (e) {
    functions.logger.error('emailOutbox: Versand fehlgeschlagen', { id: ref.id, error: String(e) });
    await ref.update({
      status: 'failed',
      attempts: admin.firestore.FieldValue.increment(1),
      lastError: e instanceof Error ? e.message : String(e),
    });
  }
}

/** Worker: versendet neu eingereihte Mails sofort. */
export const processEmailOutbox = functions.firestore
  .document(`${OUTBOX}/{id}`)
  .onCreate(async snap => {
    await attemptSend(snap.ref);
  });

/** Retry-Job: stündlich fehlgeschlagene Mails erneut versuchen. */
export const retryFailedEmails = functions.pubsub
  .schedule('every 1 hours')
  .timeZone('Europe/Berlin')
  .onRun(async () => {
    const failed = await db
      .collection(OUTBOX)
      .where('status', '==', 'failed')
      .where('attempts', '<', MAX_ATTEMPTS)
      .limit(50)
      .get();
    // Hängengebliebene 'queued'-Mails (Function-Timeout/Crash VOR dem
    // Statuswechsel) nach 1h ebenfalls erneut versuchen.
    const staleCutoff = admin.firestore.Timestamp.fromMillis(Date.now() - 60 * 60 * 1000);
    const staleQueued = await db
      .collection(OUTBOX)
      .where('status', '==', 'queued')
      .where('createdAt', '<', staleCutoff)
      .limit(50)
      .get();
    for (const doc of [...failed.docs, ...staleQueued.docs]) {
      await attemptSend(doc.ref);
    }
    functions.logger.info(
      `emailOutbox: Retry-Lauf über ${failed.size} fehlgeschlagene + ${staleQueued.size} hängende Mails`
    );
  });

/* ── Hilfsdaten laden ───────────────────────────────────────────────────── */

interface AssignmentContext {
  employeeName: string;
  employeeEmail: string | null;
  employeeWantsEmail: boolean;
  facilityName: string;
  shiftDate: string;
  shiftTimes: string;
}

function formatDateDE(value: unknown): string {
  const d =
    value instanceof admin.firestore.Timestamp
      ? value.toDate()
      : typeof value === 'string' || value instanceof Date
        ? new Date(value)
        : null;
  if (!d || Number.isNaN(d.getTime())) return '–';
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

async function loadAssignmentContext(assignment: FirebaseFirestore.DocumentData): Promise<AssignmentContext> {
  const [userSnap, shiftSnap] = await Promise.all([
    assignment.userId ? db.collection('users').doc(assignment.userId).get() : null,
    assignment.shiftId ? db.collection('shifts').doc(assignment.shiftId).get() : null,
  ]);
  const user = userSnap?.exists ? userSnap.data() : null;
  const shift = shiftSnap?.exists ? shiftSnap!.data() : null;

  let facilityName = '';
  if (shift?.facilityId) {
    const facilitySnap = await db.collection('facilities').doc(shift.facilityId).get();
    if (facilitySnap.exists) facilityName = facilitySnap.data()?.name || '';
  }

  const endDateSuffix = shift?.endDate ? ` (bis ${formatDateDE(shift.endDate)})` : '';
  return {
    employeeName: user?.displayName || user?.email || 'Unbekannt',
    employeeEmail: user?.email || null,
    employeeWantsEmail: user?.notificationSettings?.emailNotifications !== false,
    facilityName,
    shiftDate: formatDateDE(shift?.date),
    shiftTimes: shift?.startTime && shift?.endTime ? `${shift.startTime} – ${shift.endTime} Uhr${endDateSuffix}` : '',
  };
}

/* ── Trigger: Einsatz angenommen / abgelehnt ────────────────────────────── */

export const onAssignmentStatusEmail = functions.firestore
  .document('assignments/{assignmentId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();
    if (before.status === after.status) return;
    if (after.status !== 'accepted' && after.status !== 'declined') return;

    const assignmentId = context.params.assignmentId as string;
    const revision = change.after.updateTime?.toMillis() ?? 0;
    const ctx = await loadAssignmentContext(after);
    const accepted = after.status === 'accepted';

    const rows = detailRows([
      ['Mitarbeiter/in', ctx.employeeName],
      ['Einsatzort', ctx.facilityName],
      ['Datum', ctx.shiftDate],
      ['Zeiten', ctx.shiftTimes],
    ]);

    // Bestätigung an Mitarbeiter/in (respektiert E-Mail-Einstellungen)
    if (ctx.employeeEmail && ctx.employeeWantsEmail) {
      await queueEmail(`${assignmentId}_${after.status}_${revision}_employee`, {
        to: ctx.employeeEmail,
        subject: accepted
          ? `Einsatz bestätigt – ${ctx.shiftDate}${ctx.facilityName ? ` · ${ctx.facilityName}` : ''}`
          : `Einsatz abgelehnt – ${ctx.shiftDate}`,
        html: renderBrandedEmail({
          title: accepted ? 'Einsatz bestätigt' : 'Ablehnung erfasst',
          greeting: `Hallo ${ctx.employeeName},`,
          bodyHtml: accepted
            ? `<p>dein Einsatz ist verbindlich bestätigt:</p>${rows}<p>Die Einsatzmitteilung findest du in der App unter „Meine Einsätze“.</p>`
            : `<p>deine Ablehnung des folgenden Einsatzes wurde erfasst:</p>${rows}<p>Die Zentrale wurde informiert.</p>`,
        }),
        event: `assignment_${after.status}`,
        refId: assignmentId,
      });
    }

    // Kopie an die Zentrale
    await queueEmail(`${assignmentId}_${after.status}_${revision}_central`, {
      to: CENTRAL_EMAIL,
      subject: accepted
        ? `Einsatz angenommen: ${ctx.employeeName} – ${ctx.shiftDate}`
        : `Einsatz abgelehnt: ${ctx.employeeName} – ${ctx.shiftDate}`,
      html: renderBrandedEmail({
        title: accepted ? 'Einsatz angenommen' : 'Einsatz abgelehnt',
        bodyHtml: `<p>${ctx.employeeName} hat den folgenden Einsatz ${accepted ? 'angenommen' : 'abgelehnt'}:</p>${rows}`,
      }),
      event: `assignment_${after.status}`,
      refId: assignmentId,
    });
  });

/* ── Trigger: Zeiterfassung eingereicht ─────────────────────────────────── */

export const onTimesheetSubmittedEmail = functions.firestore
  .document('timesheets/{timesheetId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();
    if (before.status === after.status || after.status !== 'submitted') return;

    const timesheetId = context.params.timesheetId as string;
    const revision = change.after.updateTime?.toMillis() ?? 0;
    const userSnap = after.userId ? await db.collection('users').doc(after.userId).get() : null;
    const user = userSnap?.exists ? userSnap.data() : null;
    if (!user?.email || user?.notificationSettings?.emailNotifications === false) return;

    const hours =
      typeof after.totalHours === 'number'
        ? after.totalHours.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : '–';

    await queueEmail(`${timesheetId}_submitted_${revision}_employee`, {
      to: user.email,
      subject: `Zeiterfassung eingereicht – ${formatDateDE(after.date)}`,
      html: renderBrandedEmail({
        title: 'Zeiterfassung eingereicht',
        greeting: `Hallo ${user.displayName || ''},`,
        bodyHtml: `<p>deine Zeiterfassung wurde erfolgreich eingereicht und serverseitig geprüft:</p>${detailRows([
          ['Datum', formatDateDE(after.date)],
          ['Zeiten', after.startTime && after.endTime ? `${after.startTime} – ${after.endTime} Uhr` : ''],
          ['Pause', typeof after.breakMinutes === 'number' ? `${after.breakMinutes} Min` : ''],
          ['Gesamt', `${hours} h`],
        ])}<p>Du wirst benachrichtigt, sobald die Freigabe erfolgt ist.</p>`,
      }),
      event: 'timesheet_submitted',
      refId: timesheetId,
    });
  });
