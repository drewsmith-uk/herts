import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', timeout: 60_000, expect: { timeout: 15_000 }, workers: 1,
  // Full Chromium exercises service-worker push; the minimal headless shell does not.
  use: { channel: 'chromium', baseURL: 'http://127.0.0.1:8790', launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'node --import tsx tests/browser-server.ts', url: 'http://127.0.0.1:8790/api/v1/state', timeout: 30_000, reuseExistingServer: false },
});
