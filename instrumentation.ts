// Next.js Instrumentation Hook: lädt die Sentry-Server-/Edge-Konfiguration.
// Ohne diese Datei wird Sentry.init serverseitig nie aufgerufen.
// https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

// Fehler aus Server Components / Route Handlern an Sentry melden
export const onRequestError = Sentry.captureRequestError;
