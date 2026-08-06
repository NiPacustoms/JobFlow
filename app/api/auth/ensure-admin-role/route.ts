import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb, verifyIdToken } from '@/lib/server/firebaseAdmin';
import {
  logger,
  errorHandler,
  createErrorResponse,
  createAuthErrorResponse,
  createAppError,
  ErrorCode,
  isAppError,
} from '@/lib/errors';
import { SINGLE_COMPANY_ID } from '@/lib/constants/company';
import { FieldValue } from 'firebase-admin/firestore';
import { checkRateLimit } from '@/lib/middleware/rateLimit';

export const runtime = 'nodejs';

/** Standard-Admin für Entwicklung: admin@schichtklar.test = Admin, nurse1@schichtklar.test = Nurse. */
const DEFAULT_ADMIN_BOOTSTRAP_EMAIL = 'admin@schichtklar.test';

/**
 * Bootstrap: Setzt Rolle auf admin, wenn E-Mail der konfigurierten Bootstrap-E-Mail entspricht.
 * Nur für Dev/erste Einrichtung. Im Betrieb: Admin = register-admin, Nurse = accept-invite.
 * Siehe docs/ROLLEN-UND-EINLADUNGEN.md.
 */
export async function POST(req: NextRequest) {
  try {
    const route = '/api/auth/ensure-admin-role';
    const rateLimitResponse = checkRateLimit(req);
    if (rateLimitResponse) {
      return rateLimitResponse;
    }
    if (!adminAuth || !adminDb) {
      return createErrorResponse(
        createAppError(
          new Error('Firebase Admin ist nicht konfiguriert.'),
          ErrorCode.INTERNAL_ERROR,
          { route }
        )
      );
    }

    const isDev = process.env.NODE_ENV === 'development';
    const bootstrapEnabled =
      process.env.ENABLE_ADMIN_BOOTSTRAP === 'true' || (isDev && process.env.ENABLE_ADMIN_BOOTSTRAP !== 'false');
    const allowedEmail = (
      process.env.ADMIN_BOOTSTRAP_EMAIL ||
      (isDev ? DEFAULT_ADMIN_BOOTSTRAP_EMAIL : '')
    )
      .trim()
      .toLowerCase();
    if (!bootstrapEnabled || !allowedEmail) {
      return createAuthErrorResponse('UNAUTHORIZED', route);
    }

    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return createAuthErrorResponse('UNAUTHENTICATED', route);
    }

    const decoded = await verifyIdToken(authHeader);
    if (!decoded) {
      return createAuthErrorResponse('UNAUTHENTICATED', route);
    }

    const email = (decoded.email || '').toLowerCase();
    if (email !== allowedEmail) {
      return createAuthErrorResponse('UNAUTHORIZED', route);
    }

    const uid = decoded.uid;
    const userRef = adminDb.collection('users').doc(uid);
    const userDoc = await userRef.get();

    const existingData = userDoc.exists
      ? (userDoc.data() as { companyId?: string; displayName?: string; role?: string } | undefined)
      : undefined;
    const companyId = existingData?.companyId || SINGLE_COMPANY_ID;
    const currentFirestoreRole = existingData?.role;
    const currentClaimsRole = (decoded as { role?: string }).role;

    // Bereits Admin in Firestore und im Token → keine Änderung, kein Log
    if (currentFirestoreRole === 'admin' && currentClaimsRole === 'admin') {
      return NextResponse.json({
        success: true,
        message: 'Bereits Admin.',
      });
    }

    await userRef.set(
      {
        id: uid,
        email: decoded.email || email,
        displayName: existingData?.displayName || decoded.name || email.split('@')[0] || 'Admin',
        role: 'admin',
        companyId,
        active: true,
        qualifications: [],
        documents: [],
        notificationSettings: {
          emailNotifications: true,
          pushNotifications: true,
          shiftReminders: true,
          documentExpiry: true,
          systemAnnouncements: true,
        },
        updatedAt: FieldValue.serverTimestamp(),
        ...(userDoc.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
      },
      { merge: true }
    );

    await adminAuth.setCustomUserClaims(uid, { role: 'admin', companyId });

    logger.info('ensure-admin-role: Rolle auf admin gesetzt', undefined, { uid, email });
    return NextResponse.json({
      success: true,
      message: 'Rolle auf Admin gesetzt. Bitte Seite neu laden.',
    });
  } catch (error: unknown) {
    const appError = isAppError(error)
      ? error
      : errorHandler.handleFirebaseError(
          error,
          { route: '/api/auth/ensure-admin-role' },
          { component: 'POST /api/auth/ensure-admin-role' }
        );
    logger.error('ensure-admin-role failed', appError, {
      component: 'api:auth/ensure-admin-role',
      action: 'POST',
    });
    return createErrorResponse(appError);
  }
}
