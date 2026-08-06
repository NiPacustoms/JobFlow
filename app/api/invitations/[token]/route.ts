import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/server/firebaseAdmin';
import { maskEmail } from '@/lib/utils/authz';
import { createValidationErrorResponse, createNotFoundErrorResponse, createErrorResponse } from '@/lib/errors/apiErrorResponse';
import { createAppError, ErrorCode } from '@/lib/errors/ErrorTypes';
import { checkRateLimit } from '@/lib/middleware/rateLimit';

export const runtime = 'nodejs';

const ROUTE = '/api/invitations/[token]';

// GET /api/invitations/[token]
// Öffentlich per Token erreichbar → IP-Rate-Limit gegen Token-Enumeration.
// WICHTIG: Serverseitig ausschließlich Admin SDK – das früher genutzte
// Client-SDK lief ohne Auth in die Firestore-Rules (default deny) und die
// Vorschau schlug für JEDE Einladung fehl.
export async function GET(req: NextRequest, context: { params: Promise<{ token?: string }> }) {
  try {
    const rateLimitResponse = checkRateLimit(req);
    if (rateLimitResponse) {
      return rateLimitResponse;
    }
    const params = await context.params;
    const { token } = params || {};
    if (!token) return createValidationErrorResponse('token erforderlich.', ErrorCode.VALIDATION_REQUIRED_FIELD, ROUTE);

    if (!adminDb) {
      throw new Error('Firebase Admin ist nicht konfiguriert.');
    }

    const snapshot = await adminDb
      .collection('invitations')
      .where('token', '==', token)
      .limit(1)
      .get();
    if (snapshot.empty) return createNotFoundErrorResponse('Einladung nicht gefunden.', ROUTE);

    const invite = snapshot.docs[0].data() as {
      email: string;
      companyId: string;
      acceptedAt?: FirebaseFirestore.Timestamp | null;
      expiresAt?: FirebaseFirestore.Timestamp | null;
    };

    if (invite.acceptedAt)
      return createValidationErrorResponse('Einladung bereits verwendet.', ErrorCode.VALIDATION_DUPLICATE_VALUE, ROUTE);
    const exp = invite.expiresAt?.toMillis?.() || 0;
    if (exp && Date.now() > exp)
      return createErrorResponse(createAppError(new Error('Einladung abgelaufen.'), ErrorCode.INVITATION_EXPIRED, { route: ROUTE }));

    let companyName = 'Ihre Firma';
    if (invite.companyId) {
      const companyDoc = await adminDb.collection('companies').doc(invite.companyId).get();
      if (companyDoc.exists) companyName = companyDoc.data()?.name || companyName;
    }

    return NextResponse.json({ emailMasked: maskEmail(invite.email), companyName }, { status: 200 });
  } catch (e: unknown) {
    const appError = createAppError(e instanceof Error ? e : new Error('Internal error'), ErrorCode.INTERNAL_ERROR, { route: ROUTE });
    return createErrorResponse(appError);
  }
}
