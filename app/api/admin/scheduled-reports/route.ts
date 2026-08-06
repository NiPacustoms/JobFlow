import { NextRequest, NextResponse } from 'next/server';
import {
  verifyIdToken,
  adminDb,
  getRoleFromToken,
  resolveCompanyId,
} from '@/lib/server/firebaseAdmin';
import {
  logger,
  errorHandler,
  createErrorResponse,
  createAuthErrorResponse,
  createValidationErrorResponse,
  isAppError,
} from '@/lib/errors';
import type { ScheduledReportConfigCreate } from '@/lib/types/scheduledReportConfig';

export const runtime = 'nodejs';

const COLLECTION = 'scheduledReportConfigs';

/**
 * GET /api/admin/scheduled-reports
 * Liste aller geplanten Berichte der Firma (nur admin).
 */
export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return createAuthErrorResponse('UNAUTHENTICATED', '/api/admin/scheduled-reports');
    }

    const decoded = await verifyIdToken(authHeader);
    if (!decoded || !adminDb) {
      return createAuthErrorResponse('UNAUTHORIZED', '/api/admin/scheduled-reports');
    }

    const role = getRoleFromToken(decoded);
    if (role !== 'admin') {
      return createAuthErrorResponse('UNAUTHORIZED', '/api/admin/scheduled-reports');
    }

    const companyId = await resolveCompanyId(decoded);
    if (!companyId) {
      return createValidationErrorResponse(
        'companyId konnte nicht ermittelt werden',
        undefined,
        '/api/admin/scheduled-reports'
      );
    }
    const snapshot = await adminDb.collection(COLLECTION).where('companyId', '==', companyId).get();

    const items = snapshot.docs
      .map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          createdAt: data.createdAt,
          lastRunAt: data.lastRunAt ?? null,
        };
      })
      .sort((a, b) => {
        const aTime = a.createdAt?.toDate?.() ?? a.createdAt;
        const bTime = b.createdAt?.toDate?.() ?? b.createdAt;
        const aMs = aTime instanceof Date ? aTime.getTime() : 0;
        const bMs = bTime instanceof Date ? bTime.getTime() : 0;
        return bMs - aMs;
      });

    return NextResponse.json({ items });
  } catch (error: unknown) {
    const appError = isAppError(error)
      ? error
      : errorHandler.handleFirebaseError(
          error,
          { route: '/api/admin/scheduled-reports' },
          { component: 'GET /api/admin/scheduled-reports' }
        );
    logger.error('Error listing scheduled reports', appError);
    return createErrorResponse(appError);
  }
}

/**
 * POST /api/admin/scheduled-reports
 * Neuen geplanten Bericht anlegen (nur admin).
 */
export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return createAuthErrorResponse('UNAUTHENTICATED', '/api/admin/scheduled-reports');
    }

    const decoded = await verifyIdToken(authHeader);
    if (!decoded || !adminDb) {
      return createAuthErrorResponse('UNAUTHORIZED', '/api/admin/scheduled-reports');
    }

    const role = getRoleFromToken(decoded);
    if (role !== 'admin') {
      return createAuthErrorResponse('UNAUTHORIZED', '/api/admin/scheduled-reports');
    }

    const companyId = await resolveCompanyId(decoded);
    if (!companyId) {
      return createValidationErrorResponse(
        'companyId konnte nicht ermittelt werden',
        undefined,
        '/api/admin/scheduled-reports'
      );
    }
    const body = (await req.json().catch(() => ({}))) as Partial<ScheduledReportConfigCreate>;

    const { type, period, format, recipientEmails, schedule } = body;

    if (
      !type ||
      !period ||
      !format ||
      !Array.isArray(recipientEmails) ||
      recipientEmails.length === 0 ||
      !schedule
    ) {
      return createValidationErrorResponse(
        'type, period, format, schedule und mindestens eine recipientEmails-Adresse sind erforderlich.',
        undefined,
        '/api/admin/scheduled-reports'
      );
    }

    const allowedTypes = ['timesheet', 'shifts', 'summary'];
    const allowedPeriods = ['current-month', 'last-month', 'current-quarter', 'current-year'];
    const allowedFormats = ['pdf', 'excel', 'csv'];
    const allowedSchedules = ['daily', 'monthly'];

    if (
      !allowedTypes.includes(type) ||
      !allowedPeriods.includes(period) ||
      !allowedFormats.includes(format) ||
      !allowedSchedules.includes(schedule)
    ) {
      return createValidationErrorResponse(
        'Ungültige Werte für type/period/format/schedule.',
        undefined,
        '/api/admin/scheduled-reports'
      );
    }

    const emails = recipientEmails.filter(e => typeof e === 'string' && e.trim().length > 0);
    if (emails.length === 0) {
      return createValidationErrorResponse(
        'Mindestens eine gültige E-Mail-Adresse erforderlich.',
        undefined,
        '/api/admin/scheduled-reports'
      );
    }

    const docRef = await adminDb.collection(COLLECTION).add({
      companyId,
      type,
      period,
      format,
      recipientEmails: emails,
      schedule,
      createdBy: decoded.uid,
      createdAt: new Date(),
    });

    return NextResponse.json({ id: docRef.id, message: 'Geplanter Bericht angelegt.' });
  } catch (error: unknown) {
    const appError = isAppError(error)
      ? error
      : errorHandler.handleFirebaseError(
          error,
          { route: '/api/admin/scheduled-reports' },
          { component: 'POST /api/admin/scheduled-reports' }
        );
    logger.error('Error creating scheduled report', appError);
    return createErrorResponse(appError);
  }
}
