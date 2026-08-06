const path = require('path');

const IS_DEV = process.env.NODE_ENV !== 'production';
// Nur in Dev/Emulator-Betrieb: lokale Emulator-Hosts (http) für connect-src erlauben.
const EMULATOR_CONNECT = IS_DEV
  ? ' http://127.0.0.1:8080 http://127.0.0.1:9099 http://127.0.0.1:9199 http://localhost:8080 http://localhost:9099 ws://127.0.0.1:* ws://localhost:*'
  : '';

/** @type {import('next').NextConfig} */
const ContentSecurityPolicy = `
  default-src 'self';
  script-src 'self' 'unsafe-inline'${IS_DEV ? " 'unsafe-eval'" : ''} https://www.googletagmanager.com;
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
  img-src 'self' data: blob: https://firebasestorage.googleapis.com https://lh3.googleusercontent.com;
  font-src 'self' https://fonts.gstatic.com;
  connect-src 'self' https://firestore.googleapis.com https://firebase.googleapis.com https://firebasestorage.googleapis.com https://firebasedynamiclinks.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firebaseinstallations.googleapis.com https://fcmregistrations.googleapis.com https://fcm.googleapis.com https://*.cloudfunctions.net https://www.google-analytics.com https://*.ingest.sentry.io https://*.ingest.us.sentry.io https://*.ingest.de.sentry.io wss:${EMULATOR_CONNECT};
  media-src 'self' https://firebasestorage.googleapis.com;
  frame-ancestors 'none';
  base-uri 'self';
  form-action 'self';
  worker-src 'self';
  object-src 'none';${IS_DEV ? '' : `
  upgrade-insecure-requests;`}
`.replace(/\s{2,}/g, ' ').trim();

const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: ContentSecurityPolicy,
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  {
    key: 'X-Frame-Options',
    value: 'DENY',
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    key: 'Referrer-Policy',
    value: 'no-referrer',
  },
  {
    key: 'Permissions-Policy',
    value:
      'camera=(), microphone=(), autoplay=(self), clipboard-read=(self), clipboard-write=(self)',
  },
  {
    key: 'X-XSS-Protection',
    value: '1; mode=block',
  },
  {
    key: 'Cross-Origin-Opener-Policy',
    value: 'same-origin',
  },
  {
    key: 'Cross-Origin-Resource-Policy',
    value: 'same-origin',
  },
  {
    key: 'Cross-Origin-Embedder-Policy',
    value: 'unsafe-none',
  },
];

const nextConfig = {
  // output: 'standalone' deaktiviert: Verursacht bei Next.js 15 während "Collecting page data"
  // MODULE_NOT_FOUND für Server-Chunks (z. B. ./7992.js). Normaler Build + Deploy funktioniert.
  // Für Firebase Hosting: Standard-Build nutzen (kein Standalone nötig).

  // Absolute minimale Konfiguration für Next.js 15/16 Stabilität
  transpilePackages: ['recharts'],
  // Turbopack (Next 16): absoluter Projektroot, damit next/package.json gefunden wird
  turbopack: {
    root: path.resolve(__dirname),
  },
  // TypeScript-Fehler während Build prüfen
  typescript: {
    ignoreBuildErrors: false,
  },
  // Image Optimization Konfiguration für Firebase Storage
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'firebasestorage.googleapis.com',
        pathname: '/v0/b/**',
      },
      {
        protocol: 'https',
        hostname: '*.firebasestorage.app',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
        pathname: '/**',
      },
    ],
  },
  // WebSocket HMR Konfiguration (entfernt - nicht mehr unterstützt in Next.js 15)
  // webSocketServer wurde entfernt, da es in Next.js 15 nicht mehr unterstützt wird
  webpack: (config, { dev, isServer }) => {
    config.resolve = config.resolve || {};
    config.resolve.alias = config.resolve.alias || {};
    // Erzwinge Alias '@' → Projektroot für CI/Hosting Builder
    config.resolve.alias['@'] = path.resolve(__dirname);
    
    // Performance-Optimierungen für Development
    if (dev) {
      // Optimiere Watch-Optionen, um unnötige Rebuilds zu vermeiden
      config.watchOptions = {
        ...config.watchOptions,
        // Ignoriere node_modules und .next Verzeichnisse
        ignored: [
          '**/node_modules/**',
          '**/.next/**',
          '**/.git/**',
          '**/functions/**',
          '**/coverage/**',
          '**/dist/**',
          '**/build/**',
        ],
        // Aggregiere Änderungen für 300ms, bevor ein Rebuild ausgelöst wird
        aggregateTimeout: 300,
        // Polling nur als Fallback, wenn native Watch nicht funktioniert
        poll: false,
      };
      
      // Optimiere Cache für schnellere Rebuilds (ohne config als buildDependency,
      // um falsche "next.config.js changed" Neustarts beim ersten Kompilieren von / zu vermeiden)
      config.cache = {
        ...config.cache,
        type: 'filesystem',
      };
      
      // WebSocket-Fehler in Development unterdrücken (von Browser-Erweiterungen)
      if (!isServer) {
        config.ignoreWarnings = [
          ...(config.ignoreWarnings || []),
          {
            module: /use-websocket/,
            message: /WebSocket connection failed/,
          },
        ];
      }
    }
    
    // Firebase Hosting: .next/export-marker.json anlegen, falls Next.js 15 (App Router) sie nicht erzeugt.
    // firebase-tools liest sie in usesNextImage(); fehlt sie, kommt ENOENT.
    if (!dev && isServer) {
      const fs = require('fs');
      config.plugins.push({
        apply: (compiler) => {
          compiler.hooks.afterEmit.tap('EnsureExportMarkerPlugin', () => {
            const markerPath = path.join(__dirname, '.next', 'export-marker.json');
            if (fs.existsSync(markerPath)) return;
            try {
              const dir = path.dirname(markerPath);
              if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
              fs.writeFileSync(markerPath, JSON.stringify({ isNextImageImported: false }, null, 2), 'utf8');
            } catch (e) {
              // ignorieren
            }
          });
        },
      });
    }

    // Fix für fehlende server-reference-manifest.json Dateien
    if (dev && isServer) {
      const fs = require('fs');
      const manifestContent = JSON.stringify({ node: {}, edge: {} }, null, 2);
      let manifestCheckScheduled = false;
      
      // Plugin zum Erstellen fehlender Manifest-Dateien (optimiert)
      config.plugins.push({
        apply: (compiler) => {
          compiler.hooks.afterEmit.tap('FixManifestPlugin', () => {
            // Verhindere mehrfache gleichzeitige Ausführungen
            if (manifestCheckScheduled) return;
            manifestCheckScheduled = true;
            
            // Verwende process.nextTick statt setTimeout für bessere Performance
            process.nextTick(() => {
              try {
                const serverAppDir = path.join(__dirname, '.next', 'server', 'app');
                if (fs.existsSync(serverAppDir)) {
                  function ensureManifest(dir) {
                    const manifestPath = path.join(dir, 'server-reference-manifest.json');
                    if (!fs.existsSync(manifestPath)) {
                      fs.writeFileSync(manifestPath, manifestContent);
                    }
                  }
                  
                  function walkDir(dir) {
                    try {
                      const files = fs.readdirSync(dir);
                      for (const file of files) {
                        const filePath = path.join(dir, file);
                        const stat = fs.statSync(filePath);
                        if (stat.isDirectory()) {
                          walkDir(filePath);
                        } else if (file.startsWith('page.')) {
                          ensureManifest(dir);
                          const pageDir = path.join(dir, 'page');
                          if (fs.existsSync(pageDir) && fs.statSync(pageDir).isDirectory()) {
                            ensureManifest(pageDir);
                          }
                        }
                      }
                    } catch (e) {
                      // Ignoriere Fehler
                    }
                  }
                  walkDir(serverAppDir);
                }
              } catch (e) {
                // Ignoriere Fehler
              } finally {
                manifestCheckScheduled = false;
              }
            });
          });
        }
      });
    }
    
    return config;
  },
  async redirects() {
    // Englische URLs → deutsche kanonische Routen (keine englischen Routen mehr)
    return [
      { source: '/documents', destination: '/dokumente', permanent: true },
      { source: '/facilities', destination: '/einrichtungen', permanent: true },
      { source: '/profile', destination: '/profil', permanent: true },
      { source: '/schedule', destination: '/admin/dienstplan', permanent: true },
      { source: '/dashboard', destination: '/employee/arbeitsplatz', permanent: true },
      { source: '/maintenance', destination: '/wartung', permanent: true },
      { source: '/time', destination: '/employee/zeiten', permanent: true },
      { source: '/login', destination: '/anmelden', permanent: true },
      { source: '/register', destination: '/registrieren', permanent: true },
      { source: '/forgot-password', destination: '/passwort-vergessen', permanent: true },
      { source: '/admin-register', destination: '/admin-registrieren', permanent: true },
      { source: '/admin/dashboard', destination: '/admin/schichten', permanent: true },
      { source: '/admin/assignments', destination: '/admin/einsaetze', permanent: true },
      { source: '/admin/shifts', destination: '/admin/schichten', permanent: true },
      { source: '/admin/staff', destination: '/admin/mitarbeiter', permanent: true },
      { source: '/admin/audit-logs', destination: '/admin/pruefprotokolle', permanent: true },
      { source: '/legal/imprint', destination: '/recht/impressum', permanent: true },
      { source: '/legal/privacy', destination: '/recht/datenschutz', permanent: true },
      { source: '/status', destination: '/systemstatus', permanent: true },
      { source: '/accept-invite', destination: '/einladung-annehmen', permanent: true },
      { source: '/employee/dashboard', destination: '/employee/arbeitsplatz', permanent: true },
      { source: '/employee/assignments', destination: '/employee/einsaetze', permanent: true },
      { source: '/messenger', destination: '/employee/arbeitsplatz', permanent: true },
    ];
  },
  eslint: {
    // Lint läuft separat über `npm run lint:ci` (CI-Workflow quality.yml),
    // nicht noch einmal im Build – hält den Produktions-Build schnell.
    ignoreDuringBuilds: true,
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
      // Service Worker dürfen nicht HTTP-gecacht werden, sonst erreichen
      // Updates installierte PWA-Clients erst nach Ablauf des Caches.
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
      {
        source: '/firebase-messaging-sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
      {
        source: '/manifest.webmanifest',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' }],
      },
    ];
  },
};

module.exports = nextConfig;
