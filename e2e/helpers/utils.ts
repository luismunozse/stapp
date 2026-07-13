import type { Page, ConsoleMessage } from "@playwright/test"

/** Are tenant credentials configured? Authenticated specs skip when false. */
export const HAS_CREDENTIALS = Boolean(process.env.STAPP_TEST_EMAIL && process.env.STAPP_TEST_PASSWORD)

export const CREDENTIALS = {
  email: process.env.STAPP_TEST_EMAIL ?? "",
  password: process.env.STAPP_TEST_PASSWORD ?? "",
}

/**
 * Console / page-error collector.
 *
 * Real apps emit benign noise (favicon 404s, third-party SDK warnings, aborted
 * fetches on unmount). We collect everything but expose a FILTERED view so a
 * test can assert "no UNEXPECTED errors" without flaking on known noise.
 */
const IGNORED_ERROR_PATTERNS: RegExp[] = [
  /favicon\.ico/i,
  /ResizeObserver loop/i, // benign browser warning, never an app bug
  /Failed to load resource.*manifest/i,
  /web-share|navigator\.share/i, // Capacitor/PWA share API absent in headless
  /ServiceWorker|service worker/i,
  /\[next-auth\].*CLIENT_FETCH_ERROR/i, // session ping races on navigation
  /net::ERR_ABORTED/i, // navigation-cancelled in-flight requests
  /Download the React DevTools/i,
]

export interface ConsoleWatcher {
  errors: string[]
  pageErrors: string[]
  /** Errors with the known-noise allowlist removed. */
  unexpected(): string[]
}

export function watchConsole(page: Page): ConsoleWatcher {
  const errors: string[] = []
  const pageErrors: string[] = []

  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() === "error") errors.push(msg.text())
  })
  page.on("pageerror", (err) => {
    pageErrors.push(err.message)
  })

  return {
    errors,
    pageErrors,
    unexpected() {
      const all = [...errors, ...pageErrors]
      return all.filter((line) => !IGNORED_ERROR_PATTERNS.some((re) => re.test(line)))
    },
  }
}

/**
 * Track failed network responses (>=500 and 4xx that aren't expected auth gates).
 * Useful to assert "no 500s during this flow".
 */
export function watchServerErrors(page: Page): { failures: string[] } {
  const failures: string[] = []
  page.on("response", (res) => {
    const status = res.status()
    if (status >= 500) {
      failures.push(`${status} ${res.request().method()} ${res.url()}`)
    }
  })
  return { failures }
}

/** Performs a real credentialed login against the tenant (not storageState). */
export async function loginViaForm(page: Page, email = CREDENTIALS.email, password = CREDENTIALS.password) {
  await page.goto("/login")
  await page.getByLabel(/email/i).fill(email)
  await page.getByLabel("Contraseña", { exact: true }).fill(password)
  await page.getByRole("button", { name: /iniciar sesi[oó]n|ingresar/i }).click()
  // After a valid login the tenant lands on the dashboard.
  await page.waitForURL(/\/dashboard/, { timeout: 20_000 })
}

/** Unique suffix so created records are idempotent across re-runs. */
export function uniqueSuffix(): string {
  // Date.now via performance.now alternative; runner allows Date here (specs run live).
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}`
}

/** Waits until the network is idle, with a sane cap (SPA can keep polling). */
export async function settle(page: Page, timeout = 5000) {
  await page.waitForLoadState("networkidle", { timeout }).catch(() => {
    /* polling apps may never reach idle; ignore */
  })
}

/**
 * Abre desde el listado la primera orden que matchea `marker` (ej. el seed).
 * Hace el flujo determinístico: busca -> abre la fila sembrada, no "la primera".
 * Devuelve true si la abrió, false si no encontró ninguna.
 */
export async function openOrdenByMarker(page: Page, marker: string): Promise<boolean> {
  await page.goto("/ordenes")
  const search = page.getByPlaceholder(/buscar por/i)
  await search.fill(marker)
  await settle(page, 4000)

  const verBtn = page.getByRole("button", { name: /ver orden/i }).first()
  if (await verBtn.isVisible().catch(() => false)) {
    await verBtn.click()
    await page.waitForURL(/\/ordenes\/.+/, { timeout: 10_000 }).catch(() => {})
    return /\/ordenes\/.+/.test(page.url())
  }
  return false
}
