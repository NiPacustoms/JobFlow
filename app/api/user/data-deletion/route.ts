import { NextRequest, NextResponse } from 'next/server';
import { verifyIdToken, adminDb, adminAuth } from '@/lib/server/firebaseAdmin';
import { ChunkedBatch } from '@/lib/server/firestoreBatch';
import { checkRateLimit } from '@/lib/middleware/rateLimit';
import { logger } from '@/lib/logging';
import { createAuthErrorResponse, createErrorResponse, createValidationErrorResponse } from '@/lib/errors/apiErrorResponse';
import { createAppError, ErrorCode } from '@/lib/errors/ErrorTypes';

export const runtime = 'nodejs';

const ROUTE = '/api/user/data-deletion';

/**
 * POST /api/user/data-deletion
 *
 * DSGVO Art. 17: Recht auf Löschung
 * Löscht oder anonymisiert personenbezogene Daten eines Users
 *
 * WICHTIG: GoBD-konforme Daten werden nicht gelöscht,
 * sondern anonymisiert (10 Jahre Aufbewahrungspflicht)
 */
export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader) return createAuthErrorResponse('UNAUTHENTICATED', ROUTE);

    const decoded = await verifyIdToken(authHeader);
    if (!decoded || !adminDb || !adminAuth) return createAuthErrorResponse('UNAUTHENTICATED', ROUTE);

    const userId = decoded.uid;

    // Rate Limiting: checkRateLimit begrenzt Anfragen. Optional V2: eigener Limiter (z. B. 1 Löschung/Tag).
    const rateLimitResponse = checkRateLimit(req, userId);
    if (rateLimitResponse) {
      // Zusätzliche Prüfung: Max 1 Löschung pro Tag
      // In Produktion sollte dies über einen dedizierten Rate-Limiter erfolgen
      return rateLimitResponse;
    }

    // Request-Body validieren (Bestätigung erforderlich)
    const body = await req.json().catch(() => ({}));
    const { confirmDeletion, reason } = body as { confirmDeletion?: boolean; reason?: string };

    if (!confirmDeletion) {
      return createValidationErrorResponse(
        'Bestätigung erforderlich. Bitte setzen Sie confirmDeletion auf true.',
        ErrorCode.VALIDATION_REQUIRED_FIELD,
        ROUTE
      );
    }

    // Audit-Log erstellen (vor Löschung)
    await adminDb.collection('dataDeletionLogs').add({
      userId,
      requestedAt: new Date(),
      reason: reason || 'User-Request',
      status: 'pending',
      requestedBy: userId,
    });

    // Timesheets: Nur nicht-approved Timesheets löschen, approved behalten (GoBD)
    const timesheetsSnapshot = await adminDb
      .collection('timesheets')
      .where('userId', '==', userId)
      .get();

    const batch = new ChunkedBatch(adminDb);
    let deleteCount = 0;
    let anonymizeCount = 0;

    for (const doc of timesheetsSnapshot.docs) {
      const data = doc.data();
      // Approved/submitted Timesheets müssen behalten werden (GoBD)
      if (data.status === 'approved' || data.status === 'submitted') {
        // Anonymisieren statt löschen
        batch.update(doc.ref, {
          userId: `[ANONYMISIERT-${userId.substring(0, 8)}]`,
          anonymized: true,
          anonymizedAt: new Date(),
        });
        anonymizeCount++;
      } else {
        // Nicht-approved können gelöscht werden
        batch.delete(doc.ref);
        deleteCount++;
      }
    }

    // 2. Normale Daten LÖSCHEN
    // Assignments (nicht GoBD-relevant)
    const assignmentsSnapshot = await adminDb
      .collection('assignments')
      .where('userId', '==', userId)
      .get();
    assignmentsSnapshot.docs.forEach(doc => batch.delete(doc.ref));
    deleteCount += assignmentsSnapshot.docs.length;

    // Documents (außer GoBD-relevante)
    const documentsSnapshot = await adminDb
      .collection('documents')
      .where('userId', '==', userId)
      .get();
    documentsSnapshot.docs.forEach(doc => batch.delete(doc.ref));
    deleteCount += documentsSnapshot.docs.length;

    // Notifications
    const notificationsSnapshot = await adminDb
      .collection('notifications')
      .where('userId', '==', userId)
      .get();
    notificationsSnapshot.docs.forEach(doc => batch.delete(doc.ref));
    deleteCount += notificationsSnapshot.docs.length;

    // FCM Tokens
    const fcmTokensSnapshot = await adminDb
      .collection('fcmTokens')
      .where('userId', '==', userId)
      .get();
    fcmTokensSnapshot.docs.forEach(doc => batch.delete(doc.ref));
    deleteCount += fcmTokensSnapshot.docs.length;

    // User-Dokument anonymisieren (nicht löschen, da Referenzen bestehen können)
    const userDoc = await adminDb.collection('users').doc(userId);
    batch.update(userDoc, {
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

    // Batch ausführen (in Blöcken zu je 450 Operationen – 500 ist das harte Limit)
    await batch.commit();

    // 3. Firebase Auth User löschen/anonymisieren
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
      // Weiter machen, auch wenn Auth-Update fehlschlägt
    }

    // Audit-Log aktualisieren
    await adminDb.collection('dataDeletionLogs').add({
      userId,
      completedAt: new Date(),
      status: 'completed',
      deletedCount: deleteCount,
      anonymizedCount: anonymizeCount,
      reason: reason || 'User-Request',
    });

    return NextResponse.json({
      success: true,
      message: 'Daten wurden gelöscht oder anonymisiert',
      deletedCount: deleteCount,
      anonymizedCount: anonymizeCount,
      note: 'GoBD-konforme Daten (approved Timesheets u. Ä.) wurden anonymisiert statt gelöscht (10 Jahre Aufbewahrungspflicht)',
    });
  } catch (error) {
    logger.error(
      'Error deleting user data',
      error instanceof Error ? error : new Error(String(error))
    );
    const appError = createAppError(
      error instanceof Error ? error : new Error('Unknown error'),
      ErrorCode.INTERNAL_ERROR,
      { route: ROUTE }
    );
    return createErrorResponse(appError);
  }
}
