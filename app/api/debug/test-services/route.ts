import { NextResponse } from 'next/server';
import { createNotFoundErrorResponse } from '@/lib/errors/apiErrorResponse';

export const runtime = 'nodejs';

const ROUTE = '/api/debug/test-services';

export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return createNotFoundErrorResponse('Not available in production', ROUTE);
  }

  const results: Record<string, unknown> = {};

  try {
    // Dynamisch importieren, um serverseitige Import-Fehler zu vermeiden
    const { userService } = await import('@/lib/services/users');
    const { adminSettingsService } = await import('@/lib/services/adminSettings');

    // Test userService.getAll
    try {
      const users = await userService.getAll(1, 1, {});
      results.userService = { success: true, data: users };
    } catch (error) {
      results.userService = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      };
    }

    // Test adminSettingsService.getSettings
    try {
      const settings = await adminSettingsService.getSettings();
      results.adminSettingsService = { success: true, data: settings };
    } catch (error) {
      results.adminSettingsService = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      };
    }


    return NextResponse.json({
      success: true,
      results,
      environment: {
        isServer: typeof window === 'undefined',
        nodeEnv: process.env.NODE_ENV,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        message: 'Error during import or execution',
      },
      { status: 500 }
    );
  }
}
