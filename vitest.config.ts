import { defineConfig } from 'vitest/config';
import path from 'path';

/**
 * Zwei Abdeckungs-Ebenen:
 *
 * 1) Glob-Schwellen für die fachliche KERNLOGIK (Arbeitszeitrecht,
 *    Stundenberechnung, Signaturplanung, Offline-Queue, Eingabevalidierung).
 *    Dort gilt 100 % bzw. eine sehr hohe Schwelle – ein Rückschritt lässt den
 *    Testlauf fehlschlagen.
 * 2) Globale Untergrenzen für alles Übrige (überwiegend Firestore-Verdrahtung,
 *    zusätzlich abgesichert über Playwright-E2E und die Firestore-Rules-Tests).
 */
export default defineConfig({
  test: {
    // jsdom, damit clientseitige Service-/Hook-Guards (`typeof window`) und
    // React-Rendering (@testing-library/react) funktionieren.
    environment: 'jsdom',
    include: ['lib/**/__tests__/**/*.test.ts', 'lib/**/__tests__/**/*.test.tsx', 'lib/**/*.test.ts'],
    exclude: ['node_modules', '.next', 'e2e', 'functions/**'],
    coverage: {
      provider: 'v8',
      enabled: false,
      reportsDirectory: './coverage',
      include: ['lib/**/*.ts'],
      exclude: [
        'lib/**/__tests__/**',
        'lib/**/*.test.ts',
        '**/*.d.ts',
        '**/index.ts',
        // Reine Typdeklarationen, Designkonstanten und Debug-Helfer –
        // kein ausführbarer Code bzw. nicht sinnvoll unit-testbar.
        'lib/types/**',
        'lib/admin/dashboardTypes.ts',
        'lib/theme.ts',
        'lib/design-tokens.ts',
        'lib/constants/**',
        'lib/i18n/**',
        'lib/utils/ariaLabels.ts',
        'lib/utils/tokenDebug.ts',
      ],
      reporter: ['text', 'text-summary', 'html', 'json-summary'],
      thresholds: {
        // ── Fachliche Kernlogik ──────────────────────────────────────────
        'lib/utils/time.ts': { statements: 100, functions: 100, lines: 100, branches: 90 },
        'lib/utils/shiftStatus.ts': { statements: 100, functions: 100, lines: 100, branches: 100 },
        'lib/utils/sanitize.ts': { statements: 100, functions: 100, lines: 100, branches: 70 },
        'lib/utils/format.ts': { statements: 100, functions: 100, lines: 100, branches: 100 },
        'lib/utils/authz.ts': { statements: 100, functions: 100, lines: 100, branches: 100 },
        'lib/utils/dataUrl.ts': { statements: 100, functions: 100, lines: 100, branches: 75 },
        'lib/utils/signatureSchedule.ts': { statements: 95, functions: 100, lines: 95, branches: 90 },
        'lib/services/arbzgValidation.ts': { statements: 95, functions: 100, lines: 95, branches: 80 },
        'lib/services/timesheets/computeNetHours.ts': {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        'lib/services/timesheets/calculateWeeklyHours.ts': {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 90,
        },
        'lib/services/timesheets/checkLimitStatus.ts': {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        'lib/services/holidayProvider.ts': {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 85,
        },
        'lib/services/offlineQueue.ts': { statements: 85, functions: 85, lines: 85, branches: 75 },
        'lib/validations/**': { statements: 90, functions: 45, lines: 90, branches: 60 },
        // ── Globale Untergrenze (Ratsche: nur nach oben anpassen) ────────
        statements: 42,
        branches: 61,
        functions: 58,
        lines: 42,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
});
