import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  testMatch: ['design-refinement.spec.ts', 'ui-consistency.spec.ts'],
  use: { baseURL: 'http://127.0.0.1:8790', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
});
