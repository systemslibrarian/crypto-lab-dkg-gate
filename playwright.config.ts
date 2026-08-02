import { defineConfig } from '@playwright/test'

/**
 * Accessibility gate. Tests run against the production build served by
 * `vite preview`, so what passes here is what actually ships to Pages.
 * Run `npm run build` first (CI does).
 */
export default defineConfig({
  testDir: './e2e',
  // driveDemos() walks every exhibit (real group math per click) before each
  // of the two axe scans — measured headroom for slower machines, no sleeps.
  timeout: 120_000,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4208/crypto-lab-dkg-gate/',
    colorScheme: 'dark',
  },
  webServer: {
    // Build first: `vite preview` only serves whatever is already in `dist/`.
    // Without the build, a source change that fails to compile leaves the last
    // good bundle in place and the suite passes green against code that no
    // longer builds — which silently invalidates mutation checks.
    command: 'npm run build && npm run preview -- --port 4208 --strictPort',
    url: 'http://localhost:4208/crypto-lab-dkg-gate/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
