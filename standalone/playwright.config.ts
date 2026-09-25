import { defineConfig } from '@playwright/test';

// Browser smoke tests against the production build. Uses the installed Google Chrome
// (present on GitHub's ubuntu runners), with software WebGL so it works headless.
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1, // every page renders 3D in software; running tests in parallel just makes them flaky
  use: {
    baseURL: 'http://localhost:4173',
    channel: 'chrome',
    viewport: { width: 1280, height: 720 },
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  webServer: [
    {
      command: 'VITE_TEST_HOOKS=1 npm run build && npx vite preview --port 4173 --strictPort',
      url: 'http://localhost:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'DATA_DIR=test-results/data GUESTS_PER_MINUTE=100 npx tsx server/main.ts', // game + account server on its default port, 2567
      port: 2567,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
