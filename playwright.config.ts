import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env['BASE_URL'] ?? 'http://localhost:3000'
const webServerCommand =
  process.env['PLAYWRIGHT_WEB_SERVER_COMMAND'] ??
  'JWT_SECRET=${JWT_SECRET:-playwright-test-secret-min-32-chars!!} pnpm dev --filter=web'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  workers: process.env['CI'] ? 1 : undefined,
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['junit', { outputFile: 'test-results/junit/playwright.xml' }],
    ['list'],
  ],
  use: {
    baseURL,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: webServerCommand,
    url: baseURL,
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
})
