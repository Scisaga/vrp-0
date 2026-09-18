import { defineConfig } from '../../main/resources/META-INF/resources/static/node_modules/@playwright/test/index.mjs';

export default defineConfig({
  testDir: '.', testMatch: '**/*.spec.mjs', fullyParallel: true,
  forbidOnly: Boolean(process.env.CI), retries: 0, workers: 2,
  timeout: 30000, expect: { timeout: 7000 },
  reporter: 'list', outputDir: '/tmp/vrp0-mcp-ui-playwright',
  use: { browserName: 'chromium', headless: true, viewport: { width: 1200, height: 900 },
    trace: 'retain-on-failure', screenshot: 'only-on-failure', serviceWorkers: 'block' },
});
