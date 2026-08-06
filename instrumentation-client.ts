// Sentry-Konfiguration für Next.js (Client)
// Wird von Next.js automatisch beim App-Start im Browser geladen
// (instrumentation-client.ts, Next >= 15.3).

import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  
  // Performance-Monitoring
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  
  // Environment
  environment: process.env.NODE_ENV || 'development',
  
  // Release-Tracking
  release: process.env.NEXT_PUBLIC_APP_VERSION || '1.0.0',
  
  // Sensitive Daten entfernen
  beforeSend(event) {
    // E-Mail-Adressen entfernen
    if (event.user) {
      delete event.user.email;
    }
    
    // Sensitive Felder aus Extra-Daten entfernen
    if (event.extra) {
      delete event.extra.password;
      delete event.extra.token;
      delete event.extra.apiKey;
    }
    
    return event;
  },
  
  // Ignorierte URLs/Errors
  ignoreErrors: [
    'ResizeObserver loop limit exceeded',
    'Non-Error promise rejection captured',
  ],
  
  // URLs ignorieren
  denyUrls: [
    /chrome-extension:/,
    /moz-extension:/,
  ],
});

// Navigations-Spans für das Performance-Monitoring (Sentry v10)
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
