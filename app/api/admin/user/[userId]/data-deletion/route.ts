import { NextRequest, NextResponse } from 'next/server';
import { adminDb, adminAuth } from '@/lib/server/firebaseAdmin';
import { ChunkedBatch } from '@/lib/server/firestoreBatch';
import { requireAuthContext, HttpError } from '@/lib/server/requestContext';
import {
  createAuthErrorResponse,
  createValidationErrorResponse,
} from '@/lib/errors/apiErrorResponse';
import { ErrorCode } from '@/lib/errors/ErrorTypes';
import { logger, errorHandler, createErrorResponse, isAppError } from '@/lib/errors';

export const runtime = 'nodejs';

const ROUTE = '/api/admin/user/[userId]/data-deletion';

/**
 * POST /api/admin/user/[userId]/data-deletion
 *
 * DSGVO Art. 17: Admin löst Datenlöschung/Anonymisierung für einen Nutzer aus.
 * Nur admin darf für andere User auslösen.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  let ctx;
  try {
    ctx = await requireAuthContext(req, { role: 'admin' });
  } catch (e) {
    if (e instanceof HttpError) return e.response;
    throw e;
  }
  const decoded = { uid: ctx.uid };

  try {
    if (!adminDb || !adminAuth) {
      return createAuthErrorResponse('UNAUTHENTICATED', ROUTE);
    }

    const { userId } = await params;
    if (!userId) {
      return createValidationErrorResponse('userId fehlt.', ErrorCode.VALIDATION_REQUIRED_FIELD, ROUTE);
    }

    // Mandantenisolation: Ziel-User muss zur Company des Admins gehören.
    const targetSnap = await adminDb.collection('users').doc(userId).get();
    if (!targetSnap.exists) {
      return createValidationErrorResponse('Benutzer nicht gefunden.', ErrorCode.VALIDATION_REQUIRED_FIELD, ROUTE);
    }
    const targetCompanyId = (targetSnap.data() as { companyId?: string } | undefined)?.companyId;
    if (targetCompanyId !== ctx.companyId) {
      return createAuthErrorResponse('UNAUTHORIZED', ROUTE);
    }

    const body = await req.json().catch(() => ({}));
    const { confirmDeletion, reason } = body as {
      confirmDeletion?: boolean;
      reason?: string;
    };

    if (!confirmDeletion) {
      return createValidationErrorResponse(
        'Bestätigung erforderlich. Bitte setzen Sie confirmDeletion auf true.',
        ErrorCode.VALIDATION_REQUIRED_FIELD,
        ROUTE
      );
    }

    await adminDb.collection('dataDeletionLogs').add({
      userId,
      requestedAt: new Date(),
      reason: reason || 'Admin-Request',
      status: 'pending',
      requestedBy: decoded.uid,
    });

    const timesheetsSnapshot = await adminDb
      .collection('timesheets')
      .where('userId', '==', userId)
      .get();

    const batch = new ChunkedBatch(adminDb);
    let deleteCount = 0;
    let anonymizeCount = 0;

    for (const doc of timesheetsSnapshot.docs) {
      const data = doc.data();
      if (data.status === 'approved' || data.status === 'submitted') {
        batch.update(doc.ref, {
          userId: `[ANONYMISIERT-${userId.substring(0, 8)}]`,
          anonymized: true,
          anonymizedAt: new Date(),
        });
        anonymizeCount++;
      } else {
        batch.delete(doc.ref);
        deleteCount++;
      }
    }

    const assignmentsSnapshot = await adminDb
      .collection('assignments')
      .where('userId', '==', userId)
      .get();
    assignmentsSnapshot.docs.forEach(doc => batch.delete(doc.ref));
    deleteCount += assignmentsSnapshot.docs.length;

    const documentsSnapshot = await adminDb
      .collection('documents')
      .where('userId', '==', userId)
      .get();
    documentsSnapshot.docs.forEach(doc => batch.delete(doc.ref));
    deleteCount += documentsSnapshot.docs.length;

    const notificationsSnapshot = await adminDb
      .collection('notifications')
      .where('userId', '==', userId)
      .get();
    notificationsSnapshot.docs.forEach(doc => batch.delete(doc.ref));
    deleteCount += notificationsSnapshot.docs.length;

    const fcmTokensSnapshot = await adminDb
      .collection('fcmTokens')
      .where('userId', '==', userId)
      .get();
    fcmTokensSnapshot.docs.forEach(doc => batch.delete(doc.ref));
    deleteCount += fcmTokensSnapshot.docs.length;

    const userRef = adminDb.collection('users').doc(userId);
    batch.update(userRef, {
      email: `anonymisiert-${userId.substring(0, 8)}@deleted.local`,
      displayName: '[ANONYMISIERT]',
      firstName: '[ANONYMISIERT]',
      lastName: '[ANONYMISIERT]',
      phone: null,
      photoURL: null,
      deleted: true,
      deletedAt: new Date(),
      anonymized: true,
    });

    await batch.commit();

    try {
      await adminAuth.updateUser(userId, {
        email: `anonymisiert-${userId.substring(0, 8)}@deleted.local`,
        displayName: '[ANONYMISIERT]',
        disabled: true,
      });
    } catch (authError) {
      logger.error(
        'Error updating auth user',
        authError instanceof Error ? authError : new Error(String(authError))
      );
    }

    await adminDb.collection('dataDeletionLogs').add({
      userId,
      completedAt: new Date(),
      status: 'completed',
      deletedCount: deleteCount,
      anonymizedCount: anonymizeCount,
      reason: reason || 'Admin-Request',
      requestedBy: decoded.uid,
    });

    return NextResponse.json({
      success: true,
      message: 'Daten wurden gelöscht oder anonymisiert',
      deletedCount: deleteCount,
      anonymizedCount: anonymizeCount,
      note: 'GoBD-konforme Daten wurden anonymisiert statt gelöscht (10 Jahre Aufbewahrungspflicht).',
    });
  } catch (error: unknown) {
    const appError = isAppError(error)
      ? error
      : errorHandler.handleFirebaseError(
          error,
          { route: '/api/admin/user/[userId]/data-deletion' },
          { component: 'POST /api/admin/user/[userId]/data-deletion' }
        );
    logger.error('Error deleting user data (admin)', appError);
    return createErrorResponse(appError);
  }
}
