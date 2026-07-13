import { test as setup, expect } from "@playwright/test"
import { STORAGE_STATE } from "../playwright.config"
import { HAS_CREDENTIALS, CREDENTIALS } from "./helpers/utils"
import { ensureSeedData } from "./fixtures/seed"
import fs from "node:fs"
import path from "node:path"

/**
 * Authentication setup project.
 *
 * Logs in ONCE against the QA tenant and persists the session to
 * e2e/.auth/user.json. The authenticated projects reuse it via storageState,
 * so individual specs never re-login (faster + less flaky).
 *
 * When credentials are absent we DON'T fail: we skip and ensure an empty,
 * valid storageState exists so dependent projects still load (their specs then
 * self-skip via fixtures/auth.ts).
 */
setup("authenticate", async ({ page }) => {
  fs.mkdirSync(path.dirname(STORAGE_STATE), { recursive: true })

  if (!HAS_CREDENTIALS) {
    if (!fs.existsSync(STORAGE_STATE)) {
      fs.writeFileSync(STORAGE_STATE, JSON.stringify({ cookies: [], origins: [] }))
    }
    setup.skip(true, "Sin credenciales de tenant QA — se omite el login.")
    return
  }

  await page.goto("/login")
  await page.getByLabel(/email/i).fill(CREDENTIALS.email)
  await page.getByLabel("Contraseña", { exact: true }).fill(CREDENTIALS.password)
  await page.getByRole("button", { name: /iniciar sesi[oó]n|ingresar/i }).click()

  // A successful tenant login redirects to the dashboard.
  await page.waitForURL(/\/dashboard/, { timeout: 25_000 })
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible()

  await page.context().storageState({ path: STORAGE_STATE })

  // Seed mínimo vía API autenticada (page.request reusa las cookies de sesión y
  // apunta al subdominio del tenant -> middleware inyecta x-tenant-slug).
  // Idempotente: garantiza un cliente + una orden de prueba para los specs.
  const seed = await ensureSeedData(page.request)
  setup.info().annotations.push({ type: "seed", description: JSON.stringify(seed) })
})
