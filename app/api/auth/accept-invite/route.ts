import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/server/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { checkRateLimit, addRateLimitHeaders } from '@/lib/middleware/rateLimit';
import { validateRequest, acceptInviteSchema } from '@/lib/validations';
import {
  createErrorResponse,
  createNotFoundErrorResponse,
  createValidationErrorResponse,
} from '@/lib/errors/apiErrorResponse';
import { createAppError, ErrorCode } from '@/lib/errors/ErrorTypes';
import { logger } from '@/lib/logging';

export const runtime = 'nodejs';

const ROUTE = '/api/auth/accept-invite';

/**
 * Betriebsmodell: Eingeladene Mitarbeiter erhalten Rolle nurse und die
 * companyId der einladenden Firma. Beides wird hier serverseitig per Admin-SDK
 * gesetzt – inklusive Custom Claims (role, companyId) direkt bei Annahme, damit
 * der Mitarbeiter sofort mandantenrichtig eingeordnet ist (kein Warten auf
 * sync-claims). Siehe docs/ROLLEN-UND-EINLADUNGEN.md.
 */
// POST /api/auth/accept-invite
// Body: { token: string, password: string, firstName?, lastName? }
export async function POST(req: NextRequest) {
  try {
    const rateLimitResponse = checkRateLimit(req);
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    const validation = await validateRequest(req, acceptInviteSchema);
    if (!validation.success) {
      return validation.response;
    }
    const { token, password, firstName, lastName } = validation.data;
    const displayName = firstName && lastName ? `${firstName} ${lastName}` : undefined;

    if (!adminAuth || !adminDb) {
      return createErrorResponse(
        createAppError(new Error('Firebase Admin nicht konfiguriert.'), ErrorCode.INTERNAL_ERROR, {
          route: ROUTE,
        })
      );
    }

    // 0) Einladung per Admin-SDK laden
    const inviteSnap = await adminDb
      .collection('invitations')
      .where('token', '==', token)
      .limit(1)
      .get();
    if (inviteSnap.empty) return createNotFoundErrorResponse('Einladung nicht gefunden.', ROUTE);
    const inviteRef = inviteSnap.docs[0].ref;

    // 1) Einladung ATOMAR entwerten, bevor irgendetwas angelegt wird.
    // Vorher wurde acceptedAt erst am Ende gesetzt: zwei parallele Anfragen mit
    // demselben Token liefen beide durch die Prüfung, und ein Abbruch nach dem
    // Anlegen des Auth-Kontos ließ eine "offene" Einladung zurück, die nie mehr
    // einlösbar war (jeder Folgeversuch scheiterte an email-already-exists).
    type ClaimResult =
      | { ok: true; email: string; companyId: string }
      | { ok: false; grund: 'verwendet' | 'abgelaufen' };
    const claim = await adminDb.runTransaction<ClaimResult>(async transaction => {
      const snap = await transaction.get(inviteRef);
      const invite = snap.data() as {
        email: string;
        companyId: string;
        acceptedAt?: unknown;
        expiresAt?: { toDate?: () => Date } | string | number | null;
      };
      if (invite.acceptedAt) return { ok: false, grund: 'verwendet' };
      const exp =
        (invite.expiresAt as { toDate?: () => Date })?.toDate?.() ??
        (invite.expiresAt ? new Date(invite.expiresAt as string | number) : null);
      if (exp && Date.now() > exp.getTime()) return { ok: false, grund: 'abgelaufen' };

      transaction.update(inviteRef, { acceptedAt: FieldValue.serverTimestamp() });
      return {
        ok: true,
        email: String(invite.email).trim().toLowerCase(),
        companyId: invite.companyId,
      };
    });

    if (!claim.ok) {
      if (claim.grund === 'verwendet') {
        return createValidationErrorResponse(
          'Einladung bereits verwendet.',
          ErrorCode.VALIDATION_DUPLICATE_VALUE,
          ROUTE
        );
      }
      return createErrorResponse(
        createAppError(new Error('Einladung abgelaufen.'), ErrorCode.INVITATION_EXPIRED, {
          route: ROUTE,
        })
      );
    }

    const { email, companyId } = claim;

    // Schlägt das Anlegen fehl, wird die Entwertung zurückgenommen, damit der
    // Mitarbeiter es erneut versuchen kann.
    const einladungFreigeben = async () => {
      try {
        await inviteRef.update({ acceptedAt: null });
      } catch (releaseError) {
        logger.error(
          'Einladung konnte nach Fehler nicht wieder freigegeben werden',
          releaseError instanceof Error ? releaseError : new Error(String(releaseError)),
          { route: ROUTE }
        );
      }
    };

    // 2) Firebase-Auth-Benutzer per Admin-SDK anlegen
    let uid: string;
    try {
      const created = await adminAuth.createUser({
        email,
        password,
        displayName: displayName || email.split('@')[0] || 'Mitarbeiter',
        emailVerified: false,
      });
      uid = created.uid;
    } catch (createError) {
      await einladungFreigeben();
      throw createError;
    }

    try {
      // 3) Custom Claims (Rolle + Mandant) sofort setzen
      await adminAuth.setCustomUserClaims(uid, { role: 'nurse', companyId });

      // 4) Firestore-User-Dokument per Admin-SDK anlegen
      await adminDb.collection('users').doc(uid).set(
      {
        id: uid,
        email,
        displayName: displayName || email.split('@')[0] || 'Mitarbeiter',
        role: 'nurse',
        companyId,
        active: true,
        qualifications: [],
        documents: [],
        address: {},
        contact: {},
        emergencyContact: {},
        bankAccount: {},
        education: {},
        driversLicense: {},
        notificationSettings: {
          emailNotifications: true,
          pushNotifications: true,
          shiftReminders: true,
          documentExpiry: true,
          systemAnnouncements: true,
        },
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
        { merge: true }
      );
    } catch (setupError) {
      // Auth-Konto wieder entfernen, damit ein erneuter Versuch nicht an
      // email-already-exists scheitert.
      try {
        await adminAuth.deleteUser(uid);
      } catch (cleanupError) {
        logger.error(
          'Auth-Konto konnte nach Fehler nicht entfernt werden',
          cleanupError instanceof Error ? cleanupError : new Error(String(cleanupError)),
          { route: ROUTE }
        );
      }
      await einladungFreigeben();
      throw setupError;
    }

    // email an den Client zurückgeben, damit er sich direkt anmelden kann
    const response = NextResponse.json({ userId: uid, companyId, email }, { status: 201 });
    return addRateLimitHeaders(response, req);
  } catch (e: unknown) {
    const err = e instanceof Error ? e : new Error(String(e));
    const code = (e as { code?: string })?.code;
    if (code === 'auth/email-already-exists') {
      return createValidationErrorResponse(
        'Für diese E-Mail existiert bereits ein Konto. Bitte melden Sie sich an.',
        ErrorCode.VALIDATION_DUPLICATE_VALUE,
        ROUTE
      );
    }
    logger.error('Error in accept-invite', err, { route: ROUTE }, {
      component: 'POST /api/auth/accept-invite',
    });
    return createErrorResponse(createAppError(err, ErrorCode.INTERNAL_ERROR, { route: ROUTE }));
  }
}
