import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/server/firebaseAdmin';
import { requireAuthContext, HttpError } from '@/lib/server/requestContext';
import { sendAssignmentFormEmailServer } from '@/lib/server/email';

export const runtime = 'nodejs';

/**
 * Erinnerungs-Job für offene Einsatz-Formulare.
 *
 * Zugriff nur über EINEN der beiden Wege:
 *  1) System-/Scheduler-Aufruf mit gültigem `x-cron-secret` (== CRON_SECRET) →
 *     läuft mandantenübergreifend (Betriebs-Job, keine Nutzerdaten in Antwort).
 *  2) Angemeldeter Admin (Bearer-Token) → läuft NUR für die eigene Company.
 *
 * Nutzt durchgängig das Admin-SDK (das Client-SDK funktioniert serverseitig nicht).
 */
export async function POST(request: NextRequest) {
  try {
    if (!adminDb) {
      return NextResponse.json({ ok: false, error: 'DB nicht initialisiert' }, { status: 500 });
    }

    const cronSecret = process.env.CRON_SECRET;
    const providedSecret = request.headers.get('x-cron-secret') || undefined;
    const isCron = !!cronSecret && providedSecret === cronSecret;

    // Ohne gültiges Cron-Secret ist ein Admin-Token erforderlich; dann wird der
    // Job auf dessen Company beschränkt.
    let scopedCompanyId: string | null = null;
    if (!isCron) {
      const ctx = await requireAuthContext(request, { role: 'admin' });
      scopedCompanyId = ctx.companyId;
    }

    const url = new URL(request.url);
    const origin = `${url.protocol}//${url.host}`;
    const cutoff = Timestamp.fromDate(new Date(Date.now() - 24 * 60 * 60 * 1000));

    let q = adminDb
      .collection('assignments')
      .where('status', '==', 'assigned')
      .where('assignedAt', '<=', cutoff);
    if (scopedCompanyId) {
      q = q.where('companyId', '==', scopedCompanyId);
    }
    const assignmentsSnap = await q.get();

    let sent = 0;
    for (const assignmentDoc of assignmentsSnap.docs) {
      const data = assignmentDoc.data() as { formStatus?: string; userId: string };
      if (data.formStatus === 'acknowledged' || data.formStatus === 'declined') continue;

      const userSnap = await adminDb.collection('users').doc(data.userId).get();
      const user = userSnap.exists
        ? (userSnap.data() as { email?: string; displayName?: string })
        : null;
      const email = user?.email;
      if (!email) continue;

      const formLink = `${origin}/employee/formulare/einsaetze/${assignmentDoc.id}`;
      const result = await sendAssignmentFormEmailServer({
        to: email,
        employeeName: user?.displayName,
        formLink,
      });
      if (result.sent) sent += 1;
    }

    return NextResponse.json({ ok: true, sent });
  } catch (e) {
    if (e instanceof HttpError) return e.response;
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'unknown' },
      { status: 500 }
    );
  }
}
