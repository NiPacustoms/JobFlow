import { NextRequest, NextResponse } from 'next/server';
import {
  verifyIdToken,
  adminDb,
  getRoleFromToken,
  resolveCompanyId,
} from '@/lib/server/firebaseAdmin';
import {
  createAuthErrorResponse,
  createErrorResponse,
  createNotFoundErrorResponse,
  createValidationErrorResponse,
} from '@/lib/errors/apiErrorResponse';
import { ErrorCode } from '@/lib/errors/ErrorTypes';
import { logger, errorHandler, isAppError } from '@/lib/errors';
import type { ScheduledReportConfigUpdate } from '@/lib/types/scheduledReportConfig';

export const runtime = 'nodejs';

const ROUTE = '/api/admin/scheduled-reports/[configId]';
const COLLECTION = 'scheduledReportConfigs';

/**
 * GET /api/admin/scheduled-reports/[configId]
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ configId: string }> }) {
  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return createAuthErrorResponse('UNAUTHENTICATED', ROUTE);
    }

    const decoded = await verifyIdToken(authHeader);
    if (!decoded || !adminDb) {
      return createAuthErrorResponse('UNAUTHENTICATED', ROUTE);
    }

    const role = getRoleFromToken(decoded);
    const isAdmin = role === 'admin';
    if (!isAdmin) {
      return createAuthErrorResponse('UNAUTHORIZED', ROUTE);
    }

    const companyId = await resolveCompanyId(decoded);
    if (!companyId) {
      return createValidationErrorResponse(
        'companyId konnte nicht ermittelt werden',
        ErrorCode.VALIDATION_REQUIRED_FIELD,
        ROUTE
      );
    }
    const { configId } = await params;
    if (!configId) {
      return createValidationErrorResponse('configId fehlt.', ErrorCode.VALIDATION_REQUIRED_FIELD, ROUTE);
    }

    const doc = await adminDb.collection(COLLECTION).doc(configId).get();
    if (!doc.exists) {
      return createNotFoundErrorResponse('Konfiguration nicht gefunden.', ROUTE);
    }

    const data = doc.data();
    if (data?.companyId !== companyId) {
      return createAuthErrorResponse('UNAUTHORIZED', ROUTE);
    }

    return NextResponse.json({ id: doc.id, ...data });
  } catch (error: unknown) {
    const appError = isAppError(error)
      ? error
      : errorHandler.handleFirebaseError(
          error,
          { route: ROUTE },
          { component: 'GET /api/admin/scheduled-reports/[configId]' }
        );
    logger.error('Error getting scheduled report config', appError);
    return createErrorResponse(appError);
  }
}

/**
 * PATCH /api/admin/scheduled-reports/[configId]
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ configId: string }> }
) {
  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return createAuthErrorResponse('UNAUTHENTICATED', ROUTE);
    }

    const decoded = await verifyIdToken(authHeader);
    if (!decoded || !adminDb) {
      return createAuthErrorResponse('UNAUTHENTICATED', ROUTE);
    }

    const role = getRoleFromToken(decoded);
    const isAdmin = role === 'admin';
    if (!isAdmin) {
      return createAuthErrorResponse('UNAUTHORIZED', ROUTE);
    }

    const companyId = await resolveCompanyId(decoded);
    if (!companyId) {
      return createValidationErrorResponse(
        'companyId konnte nicht ermittelt werden',
        ErrorCode.VALIDATION_REQUIRED_FIELD,
        ROUTE
      );
    }
    const { configId } = await params;
    if (!configId) {
      return createValidationErrorResponse('configId fehlt.', ErrorCode.VALIDATION_REQUIRED_FIELD, ROUTE);
    }

    const docRef = adminDb.collection(COLLECTION).doc(configId);
    const doc = await docRef.get();
    if (!doc.exists) {
      return createNotFoundErrorResponse('Konfiguration nicht gefunden.', ROUTE);
    }

    const data = doc.data();
    if (data?.companyId !== companyId) {
      return createAuthErrorResponse('UNAUTHORIZED', ROUTE);
    }

    const body = (await req.json().catch(() => ({}))) as ScheduledReportConfigUpdate;
    const updates: Record<string, unknown> = {};

    const allowedTypes = ['timesheet', 'shifts', 'summary'];
    const allowedPeriods = ['current-month', 'last-month', 'current-quarter', 'current-year'];
    const allowedFormats = ['pdf', 'excel', 'csv'];
    const allowedSchedules = ['daily', 'monthly'];

    if (body.type !== undefined) {
      if (!allowedTypes.includes(body.type)) {
        return createValidationErrorResponse('Ungültiger type.', ErrorCode.VALIDATION_INVALID_FORMAT, ROUTE);
      }
      updates.type = body.type;
    }
    if (body.period !== undefined) {
      if (!allowedPeriods.includes(body.period)) {
        return createValidationErrorResponse('Ungültiger period.', ErrorCode.VALIDATION_INVALID_FORMAT, ROUTE);
      }
      updates.period = body.period;
    }
    if (body.format !== undefined) {
      if (!allowedFormats.includes(body.format)) {
        return createValidationErrorResponse('Ungültiges format.', ErrorCode.VALIDATION_INVALID_FORMAT, ROUTE);
      }
      updates.format = body.format;
    }
    if (body.schedule !== undefined) {
      if (!allowedSchedules.includes(body.schedule)) {
        return createValidationErrorResponse('Ungültiger schedule.', ErrorCode.VALIDATION_INVALID_FORMAT, ROUTE);
      }
      updates.schedule = body.schedule;
    }
    if (body.recipientEmails !== undefined) {
      const emails = Array.isArray(body.recipientEmails)
        ? body.recipientEmails.filter(
            (e: unknown) => typeof e === 'string' && (e as string).trim().length > 0
          )
        : [];
      if (emails.length === 0) {
        return createValidationErrorResponse(
          'Mindestens eine E-Mail-Adresse erforderlich.',
          ErrorCode.VALIDATION_REQUIRED_FIELD,
          ROUTE
        );
      }
      updates.recipientEmails = emails;
    }

    if (Object.keys(updates).length === 0) {
      return createValidationErrorResponse('Keine Änderungen.', ErrorCode.VALIDATION_REQUIRED_FIELD, ROUTE);
    }

    await docRef.update(updates);
    return NextResponse.json({ message: 'Konfiguration aktualisiert.' });
  } catch (error: unknown) {
    const appError = isAppError(error)
      ? error
      : errorHandler.handleFirebaseError(
          error,
          { route: ROUTE },
          { component: 'PATCH /api/admin/scheduled-reports/[configId]' }
        );
    logger.error('Error updating scheduled report config', appError);
    return createErrorResponse(appError);
  }
}

/**
 * DELETE /api/admin/scheduled-reports/[configId]
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ configId: string }> }
) {
  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return createAuthErrorResponse('UNAUTHENTICATED', ROUTE);
    }

    const decoded = await verifyIdToken(authHeader);
    if (!decoded || !adminDb) {
      return createAuthErrorResponse('UNAUTHENTICATED', ROUTE);
    }

    const role = getRoleFromToken(decoded);
    const isAdmin = role === 'admin';
    if (!isAdmin) {
      return createAuthErrorResponse('UNAUTHORIZED', ROUTE);
    }

    const companyId = await resolveCompanyId(decoded);
    if (!companyId) {
      return createValidationErrorResponse(
        'companyId konnte nicht ermittelt werden',
        ErrorCode.VALIDATION_REQUIRED_FIELD,
        ROUTE
      );
    }
    const { configId } = await params;
    if (!configId) {
      return createValidationErrorResponse('configId fehlt.', ErrorCode.VALIDATION_REQUIRED_FIELD, ROUTE);
    }

    const doc = await adminDb.collection(COLLECTION).doc(configId).get();
    if (!doc.exists) {
      return createNotFoundErrorResponse('Konfiguration nicht gefunden.', ROUTE);
    }

    if (doc.data()?.companyId !== companyId) {
      return createAuthErrorResponse('UNAUTHORIZED', ROUTE);
    }

    await adminDb.collection(COLLECTION).doc(configId).delete();
    return NextResponse.json({ message: 'Konfiguration gelöscht.' });
  } catch (error: unknown) {
    const appError = isAppError(error)
      ? error
      : errorHandler.handleFirebaseError(
          error,
          { route: ROUTE },
          { component: 'DELETE /api/admin/scheduled-reports/[configId]' }
        );
    logger.error('Error deleting scheduled report config', appError);
    return createErrorResponse(appError);
  }
}
