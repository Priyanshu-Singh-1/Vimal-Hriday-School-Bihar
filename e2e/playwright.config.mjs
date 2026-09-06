import { defineConfig } from '@playwright/test';

// The school site pulls dozens of local images per page plus third-party assets
// (FontAwesome kit, YouTube embeds, Google Drive links). Under Playwright's
// default parallel workers, two browsers against a single-process static server
// starve each other and `page.goto` times out — which test fails varies run to
// run. This suite is four tests against static HTML, so serial is both fast
// enough (~6s) and deterministic.
export default defineConfig({
  testDir: '.',
  workers: 1,
  use: { baseURL: process.env.VHS_BASE_URL || 'http://127.0.0.1:3000' },
  reporter: 'list',
  // Serve the repo root ourselves so `npx playwright test` needs no second
  // terminal. Set VHS_BASE_URL to point at an already-running site instead
  // (a deployed URL, or a server you started yourself).
  webServer: process.env.VHS_BASE_URL
    ? undefined
    : {
        command: 'python3 -m http.server 3000 --bind 127.0.0.1 --directory ..',
        url: 'http://127.0.0.1:3000/index.html',
        reuseExistingServer: true,
        timeout: 60000,
      },
});
