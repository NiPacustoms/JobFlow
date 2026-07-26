import { defineConfig, devices } from '@playwright/test';

/**
 * Zwei getrennte Suiten:
 *
 * - `chromium` / `firefox` (Standard): `e2e/**` – läuft gegen die App mit
 *   Mock-Auth (`__E2E_TEST_MODE__`), also ohne Firebase-Backend. Das ist der
 *   Lauf, der bei jeder Änderung grün sein muss.
 * - `backend`: `tests/e2e/**` – meldet sich mit ECHTEN Konten an und braucht
 *   ein befülltes Firebase-Projekt sowie die Zugangsdaten in
 *   E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD / E2E_EMPLOYEE_EMAIL /
 *   E2E_EMPLOYEE_PASSWORD. Bewusst nicht im Standardlauf – vorher lag dieses
 *   Verzeichnis komplett außerhalb von testDir und wurde nie ausgeführt.
 *   Start: `npm run test:e2e:backend`.
 */
export default defineConfig({
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  timeout: 60000,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    actionTimeout: 20000,
    navigationTimeout: 30000,
  },
  projects: [
    {
      name: 'chromium',
      testDir: './e2e',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      testDir: './e2e',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'backend',
      testDir: './tests/e2e',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: process.env.CI
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://localhost:3000',
        reuseExistingServer: !process.env.CI,
        timeout: 120000,
      },
});
