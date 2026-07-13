import { test as base, expect } from "@playwright/test"
import { HAS_CREDENTIALS, watchConsole, watchServerErrors, type ConsoleWatcher } from "../helpers/utils"

/**
 * Extended test for AUTHENTICATED specs.
 *
 * - `console`: collects console/page errors so any test can assert no
 *   unexpected JS errors occurred during the flow.
 * - `server`: collects 5xx responses to assert no backend blowups.
 * - Auto-skips the whole spec when tenant credentials are absent, so a fresh
 *   checkout (or CI without secrets) goes green by skipping instead of failing.
 *
 * Authenticated specs receive a `page` that already carries the persisted
 * session from e2e/auth.setup.ts (wired via storageState in playwright.config).
 */
type Fixtures = {
  consoleWatcher: ConsoleWatcher
  serverErrors: { failures: string[] }
}

export const test = base.extend<Fixtures>({
  consoleWatcher: async ({ page }, use) => {
    const watcher = watchConsole(page)
    await use(watcher)
  },
  serverErrors: async ({ page }, use) => {
    const watcher = watchServerErrors(page)
    await use(watcher)
  },
})

// Skip every authenticated spec that imports this `test` when no credentials.
test.skip(!HAS_CREDENTIALS, "Sin credenciales de tenant QA (STAPP_TEST_EMAIL/PASSWORD). Ver e2e/README.md")

export { expect }
