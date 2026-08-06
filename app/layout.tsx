import { MUIThemeProviderWrapper } from '@/components/ThemeProvider';
import { ThemeModeProvider } from '@/contexts/ThemeModeContext';
import { EmotionRegistry } from '@/components/EmotionRegistry';
import { ConditionalHeader } from '@/components/layout/ConditionalHeader';
import { InstallPrompt } from '@/components/pwa/InstallPrompt';
import { CookieBanner } from '@/components/legal/CookieBanner';
import { PluginInit } from '@/components/PluginInit';
// import BottomNav from '@/components/layout/BottomNavigation';
import { AuthProvider } from '@/contexts/AuthContext';
import { PermissionsProvider } from '@/contexts/PermissionsContext';
import { QueryProvider } from '@/lib/providers/QueryProvider';
import { GlobalErrorBoundary } from '@/components/errors/GlobalErrorBoundary';
import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
  preload: true,
});

export const metadata: Metadata = {
  title: 'Schichtklar - Zeitarbeits-App',
  description: 'DSGVO-konforme Zeitarbeits-App für medizinisches Personal',
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon.ico', sizes: 'any', type: 'image/x-icon' },
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-96.png', sizes: '96x96', type: 'image/png' },
      { url: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png' },
    ],
    shortcut: '/favicon.svg',
    apple: [{ url: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png' }],
  },
  other: {
    'font-display': 'swap',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
};

// Verhindert statische Prerender-Fehler (webpack-runtime .call) bei "/"
export const dynamic = 'force-dynamic';

// Firebase-Config für Service Worker als JSON (wird ins data-Attribut geschrieben, nicht ins Script).
// Verhindert "Invalid or unexpected token" durch Sonderzeichen in Env-Werten im gebündelten layout.js.
const FIREBASE_CONFIG_JSON =
  typeof process !== 'undefined' && process.env
    ? JSON.stringify({
        apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? '',
        authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
        projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? '',
        storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? '',
        messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '',
        appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? '',
      })
    : '{}';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de" suppressHydrationWarning data-scroll-behavior="smooth">
      <head>
        {/* Emotion Insertion Point zur stabilen Style-Reihenfolge (SSR/Client) */}
        <meta name="emotion-insertion-point" content="" />
        {/* PWA Manifest */}
        <link rel="manifest" href="/manifest.webmanifest" />
        <meta name="theme-color" content="#0f766e" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="Schichtklar" />
        {/* Service Worker Registration - nur in Production */}
        <script
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                var logger = { info: console.log, warn: console.warn, error: console.error };
                if (typeof window === 'undefined') return;
                if ('serviceWorker' in navigator) {
                  var isDevelopment = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
                  if (isDevelopment) {
                    navigator.serviceWorker.getRegistrations().then(function(registrations) {
                      if (registrations.length > 0) {
                        logger.info('🔧 [SW] Deactivating Service Workers in development mode');
                        registrations.forEach(function(registration) {
                          registration.unregister().then(function(success) {
                            if (success) logger.info('✅ [SW] Service Worker unregistered successfully');
                          }).catch(function(error) {
                            logger.warn('⚠️ [SW] Error unregistering service worker', error && error.message ? error.message : String(error));
                          });
                        });
                        if ('caches' in window) {
                          caches.keys().then(function(cacheNames) {
                            cacheNames.forEach(function(cacheName) { caches.delete(cacheName); });
                          });
                        }
                      }
                    });
                  } else {
                    var initServiceWorkers = function() {
                      var raw = document.body ? document.body.getAttribute('data-firebase-config') : null;
                      var firebaseConfig = {};
                      try { if (raw) firebaseConfig = JSON.parse(raw); } catch (e) {}
                      var sendFirebaseConfig = function(registration) {
                        var sendConfig = function(target) {
                          if (target) {
                            try {
                              target.postMessage({ type: 'FIREBASE_CONFIG', config: firebaseConfig });
                              logger.info('✅ [SW] Firebase config sent to service worker');
                            } catch (err) {
                              logger.warn('⚠️ [SW] Failed to send Firebase config', err && err.message ? err.message : String(err));
                            }
                          }
                        };
                        if (registration.active) sendConfig(registration.active);
                        else if (registration.installing) {
                          registration.installing.addEventListener('statechange', function() {
                            if (this.state === 'activated' && registration.active) sendConfig(registration.active);
                          });
                        } else if (registration.waiting) sendConfig(registration.waiting);
                      };
                      navigator.serviceWorker.register('/sw.js')
                        .then(function(registration) {
                          logger.info('✅ [SW] Registered', { scope: registration && registration.scope });
                          registration.addEventListener('updatefound', function() {
                            var newWorker = registration.installing;
                            if (newWorker) {
                              newWorker.addEventListener('statechange', function() {
                                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                                  logger.info('🔄 [SW] New service worker available');
                                }
                              });
                            }
                          });
                        })
                        .catch(function(error) {
                          logger.error('❌ [SW] Registration failed', error && error.message ? error.message : String(error));
                        });
                      var registerFirebaseSW = function(retryCount) {
                        retryCount = retryCount || 0;
                        var maxRetries = 3, retryDelay = 1000 * (retryCount + 1);
                        // WICHTIG: Eigener Scope. Beide SW-Skripte liegen im Root; ohne
                        // eigenen Scope registrieren beide auf '/' und der zweite ERSETZT
                        // den ersten – die PWA-/Offline-Logik aus sw.js wäre tot.
                        navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/firebase-cloud-messaging-push-scope' })
                          .then(function(registration) {
                            logger.info('✅ [SW] Firebase messaging SW registered', { scope: registration && registration.scope });
                            var waitForActivation = function() {
                              if (registration.active) sendFirebaseConfig(registration);
                              else if (registration.installing) {
                                registration.installing.addEventListener('statechange', function() {
                                  if (this.state === 'activated') sendFirebaseConfig(registration);
                                });
                              } else if (registration.waiting) {
                                registration.waiting.postMessage({ type: 'SKIP_WAITING' });
                                sendFirebaseConfig(registration);
                              } else {
                                setTimeout(function() {
                                  if (registration.active) sendFirebaseConfig(registration);
                                }, 500);
                              }
                            };
                            waitForActivation();
                          })
                          .catch(function(registrationError) {
                            if (retryCount < maxRetries) {
                              logger.warn('⚠️ [SW] Firebase messaging SW registration failed, retrying...', { attempt: retryCount + 1, maxRetries: maxRetries });
                              setTimeout(function() { registerFirebaseSW(retryCount + 1); }, retryDelay);
                            } else {
                              logger.error('❌ [SW] Firebase messaging SW registration failed after retries', registrationError && registrationError.message ? registrationError.message : String(registrationError));
                            }
                          });
                      };
                      registerFirebaseSW();
                    };
                    if (document.readyState === 'complete' || document.readyState === 'interactive') {
                      setTimeout(initServiceWorkers, 0);
                    } else {
                      window.addEventListener('load', initServiceWorkers);
                    }
                  }
                } else {
                  logger.warn('⚠️ [SW] Service Workers werden von diesem Browser nicht unterstützt');
                }
              })();
            `,
          }}
        />
        {/* WebSocket Error Suppression für Browser-Erweiterungen und HMR */}
        <script
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                // Unterdrücke WebSocket-Fehler von Browser-Erweiterungen und HMR
                const originalError = console.error;
                const originalWarn = console.warn;
                
                // Hilfsfunktion: alle Argumente zu einem Suchtext (inkl. Error.stack)
                function toSearchText(a) {
                  if (a && typeof a === 'object' && a.message !== undefined)
                    return (a.message || '') + ' ' + (a.stack || '');
                  return String(a);
                }
                // Prüft, ob es sich um einen HMR-WebSocket-Fehler handelt (Next.js Dev)
                function isHmrWebSocketError(text) {
                  if (!text || typeof text !== 'string') return false;
                  const hasWebSocket = text.includes('WebSocket');
                  const hasHMR = text.includes('webpack-hmr') || text.includes('_next/webpack-hmr') || text.includes('ws://localhost') || text.includes('use-websocket');
                  return hasWebSocket && (hasHMR || text.includes('localhost:3000'));
                }
                // Verbesserte Fehler-Unterdrückung für HMR WebSocket
                console.error = function(...args) {
                  const fullText = args.map(toSearchText).join(' ');
                  if (isHmrWebSocketError(fullText)) return;
                  originalError.apply(console, args);
                };
                // Auch Warnungen für WebSocket unterdrücken
                console.warn = function(...args) {
                  const fullText = args.map(toSearchText).join(' ');
                  if (isHmrWebSocketError(fullText)) return;
                  originalWarn.apply(console, args);
                };
                
                // Globaler Error Handler für WebSocket-Fehler (früher abfangen)
                const originalErrorHandler = window.onerror;
                window.onerror = function(message, source, lineno, colno, error) {
                  const errorMessage = String(message || '');
                  const errorSource = String(source || '');
                  const errorStack = error?.stack || '';
                  const allErrorText = errorMessage + ' ' + errorSource + ' ' + errorStack;
                  
                  // Unterdrücke WebSocket-Fehler für HMR
                  if ((allErrorText.includes('WebSocket') || allErrorText.includes('use-websocket')) &&
                      (allErrorText.includes('webpack-hmr') || allErrorText.includes('_next/webpack-hmr') ||
                       allErrorText.includes('ws://localhost:3000'))) {
                    // Verhindere, dass der Fehler weiter propagiert wird
                    return true;
                  }
                  
                  // Weiterleiten an ursprünglichen Handler, falls vorhanden
                  if (originalErrorHandler) {
                    return originalErrorHandler(message, source, lineno, colno, error);
                  }
                  
                  return false;
                };
                
                // Event Listener für Fehler (zusätzliche Absicherung)
                window.addEventListener('error', function(event) {
                  const errorMessage = event.message || '';
                  const errorSource = event.filename || '';
                  const errorStack = event.error?.stack || '';
                  const allErrorText = errorMessage + ' ' + errorSource + ' ' + errorStack;
                  
                  // Unterdrücke WebSocket-Fehler für HMR
                  if ((allErrorText.includes('WebSocket') || allErrorText.includes('use-websocket')) &&
                      (allErrorText.includes('webpack-hmr') || allErrorText.includes('_next/webpack-hmr') ||
                       allErrorText.includes('ws://localhost:3000'))) {
                    event.preventDefault();
                    event.stopPropagation();
                    event.stopImmediatePropagation();
                    return false;
                  }
                }, true);
                
                // Unterdrücke unhandled promise rejections für WebSocket
                window.addEventListener('unhandledrejection', function(event) {
                  const reason = event.reason?.message || event.reason?.toString() || '';
                  const reasonStack = event.reason?.stack || '';
                  const allReasonText = reason + ' ' + reasonStack;
                  
                  if ((allReasonText.includes('WebSocket') || allReasonText.includes('use-websocket')) &&
                      (allReasonText.includes('webpack-hmr') || allReasonText.includes('_next/webpack-hmr') ||
                       allReasonText.includes('ws://localhost:3000'))) {
                    event.preventDefault();
                    event.stopPropagation();
                    return false;
                  }
                }, true);
              })();
            `,
          }}
        />
      </head>
      <body
        className={`${inter.className} ${inter.variable}`}
        data-e2e-test={process.env.NEXT_PUBLIC_E2E_TEST === 'true' ? 'true' : 'false'}
        data-firebase-config={FIREBASE_CONFIG_JSON}
        suppressHydrationWarning
      >
        <EmotionRegistry>
          <GlobalErrorBoundary showDetails={process.env.NODE_ENV === 'development'}>
            <QueryProvider>
              <AuthProvider>
                <PermissionsProvider>
                <ThemeModeProvider>
                  <MUIThemeProviderWrapper>
                    <ConditionalHeader />
                    <PluginInit />
                    {children}
                    <InstallPrompt />
                    <CookieBanner />
                  </MUIThemeProviderWrapper>
                </ThemeModeProvider>
                </PermissionsProvider>
              </AuthProvider>
            </QueryProvider>
          </GlobalErrorBoundary>
        </EmotionRegistry>

        {/* E2E-Test-Flag aus data-Attribut (keine Env-Injection ins Script) */}
        <script
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                if (typeof document !== 'undefined' && document.body && document.body.getAttribute('data-e2e-test') === 'true') {
                  window.__E2E_TEST_MODE__ = true;
                  window.__SCHICHTKLAR_E2E_TEST = true;
                }
              })();
            `,
          }}
        />
        {/* In Development: Unbehandelte Fehler in Konsole ausgeben (F12), wenn die App „abricht“ */}
        {process.env.NODE_ENV === 'development' && (
          <script
            suppressHydrationWarning
            dangerouslySetInnerHTML={{
              __html: `
                (function() {
                  if (typeof window === 'undefined') return;
                  window.onerror = function(msg, url, line, col, err) {
                    console.error('[Schichtklar] Unbehandelter Fehler:', msg, url, line, col, err);
                  };
                  window.addEventListener('unhandledrejection', function(e) {
                    console.error('[Schichtklar] Unbehandelte Promise-Ablehnung:', e.reason);
                  });
                })();
              `,
            }}
          />
        )}
      </body>
    </html>
  );
}
