import { defineConfig } from 'vitest/config';
import path from 'path';

/**
 * Eigener Testlauf für die Cloud Functions.
 *
 * Die Root-Konfiguration schließt `functions/**` aus (jsdom-Umgebung, anderer
 * Modulbaum). Ohne diese zweite Konfiguration wurden die vorhandenen
 * Functions-Tests von keinem Lauf ausgeführt.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['functions/test/**/*.test.ts'],
    exclude: ['node_modules', 'functions/node_modules', 'functions/lib'],
    coverage: {
      provider: 'v8',
      enabled: false,
      reportsDirectory: './coverage-functions',
      include: ['functions/src/**/*.ts'],
      exclude: ['functions/src/index.ts', '**/*.d.ts'],
      reporter: ['text', 'text-summary', 'json-summary'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
});
