import { defineConfig, devices } from "@playwright/test"
import path from "path"

/** Persisted session written by e2e/auth.setup.ts and reused by authenticated projects. */
export const STORAGE_STATE = path.join(__dirname, "e2e", ".auth", "user.json")

// Authenticated specs: *.auth.spec.ts. Everything else under e2e/ is public.
const AUTH_SPECS = /.*\.auth\.spec\.ts/

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "html" : "list",

  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: "public-chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: AUTH_SPECS,
    },
    {
      name: "authenticated-chromium",
      use: { ...devices["Desktop Chrome"], storageState: STORAGE_STATE },
      dependencies: ["setup"],
      testMatch: AUTH_SPECS,
    },
    // Optional cross-browser pass: npm run test:e2e:firefox
    ...(process.env.PW_FIREFOX
      ? [
          {
            name: "public-firefox",
            use: { ...devices["Desktop Firefox"] },
            testIgnore: AUTH_SPECS,
          },
          {
            name: "authenticated-firefox",
            use: { ...devices["Desktop Firefox"], storageState: STORAGE_STATE },
            dependencies: ["setup"],
            testMatch: AUTH_SPECS,
          },
        ]
      : []),
  ],

  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
})
