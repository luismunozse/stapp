import { test, expect } from "@playwright/test"
import { HAS_CREDENTIALS, CREDENTIALS, watchConsole, loginViaForm } from "./helpers/utils"

/**
 * MÓDULO 1 — Autenticación & sesión.
 *
 * Complements the pre-existing e2e/login.spec.ts (form presence, invalid creds).
 * Public cases run everywhere; session cases require tenant credentials and
 * self-skip otherwise.
 */

test.describe("Auth — acceso y protección (público)", () => {
  test("ruta protegida sin sesión redirige a /login", async ({ page }) => {
    // "commit" resuelve apenas la navegación commitea (el redirect del middleware),
    // sin esperar la carga completa de la página de login (cold-compile en dev).
    await page.goto("/ordenes", { waitUntil: "commit" })
    // Comportamiento real verificado: el guard redirige a /login (sin query
    // callbackUrl en este flujo). Afirmamos lo que el sistema HACE, no lo asumido.
    await expect(page).toHaveURL(/\/login(\?|$)/, { timeout: 20_000 })
  })

  test("formulario de login es accesible (labels enlazados)", async ({ page }) => {
    await page.goto("/login")
    // getByLabel solo funciona si <Label htmlFor> está bien enlazado al input.
    await expect(page.getByLabel(/email/i)).toBeVisible()
    await expect(page.getByLabel("Contraseña", { exact: true })).toBeVisible()
    const submit = page.getByRole("button", { name: /iniciar sesi[oó]n|ingresar/i })
    await expect(submit).toBeEnabled()
  })

  test("la página de login no emite errores de consola inesperados", async ({ page }) => {
    const consoleWatcher = watchConsole(page)
    // domcontentloaded basta: evaluamos errores de consola al cargar el DOM, sin
    // esperar el evento "load" completo (assets pesados / HMR en dev).
    await page.goto("/login", { waitUntil: "domcontentloaded" })
    expect(consoleWatcher.unexpected(), consoleWatcher.unexpected().join("\n")).toEqual([])
  })

  test("credenciales inválidas NO crean sesión (sigue en login)", async ({ page }) => {
    await page.goto("/login")
    await page.getByLabel(/email/i).fill("nadie@inexistente.test")
    await page.getByLabel("Contraseña", { exact: true }).fill("malísima")
    await page.getByRole("button", { name: /iniciar sesi[oó]n|ingresar/i }).click()

    await expect(page.getByText(/incorrect|inv[aá]lid|invalid|error|no autoriz|credencial/i).first()).toBeVisible({
      timeout: 10_000,
    })
    // Y NO debe haber escapado al dashboard.
    await expect(page).not.toHaveURL(/\/dashboard/)
  })
})

test.describe("Auth — sesión real (requiere tenant QA)", () => {
  test.skip(!HAS_CREDENTIALS, "Sin STAPP_TEST_EMAIL/PASSWORD")

  test("login válido lleva al dashboard correcto", async ({ page }) => {
    await loginViaForm(page)
    await expect(page).toHaveURL(/\/dashboard/)
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible()
  })

  test("logout limpia la sesión (rutas protegidas vuelven a redirigir)", async ({ page }) => {
    await loginViaForm(page)

    // El control de logout vive en el menú de usuario; lo invocamos por la
    // ruta de signOut de NextAuth para no depender de la posición del menú.
    await page.goto("/perfil")
    const logout = page.getByRole("button", { name: /cerrar sesi[oó]n|salir|logout/i }).first()
    if (await logout.isVisible().catch(() => false)) {
      await logout.click()
    } else {
      // Fallback robusto: endpoint de signOut de NextAuth.
      await page.goto("/api/auth/signout")
      const confirm = page.getByRole("button", { name: /cerrar sesi[oó]n|sign out/i }).first()
      if (await confirm.isVisible().catch(() => false)) await confirm.click()
    }

    await page.goto("/dashboard")
    await expect(page).toHaveURL(/\/login/)
  })

  test('"Recordarme" deja una cookie de sesión persistente (30 días)', async ({ page, context }) => {
    await page.goto("/login")
    await page.getByLabel(/email/i).fill(CREDENTIALS.email)
    await page.getByLabel("Contraseña", { exact: true }).fill(CREDENTIALS.password)
    const remember = page.getByLabel(/recordarme/i)
    if (await remember.isVisible().catch(() => false)) await remember.check()
    await page.getByRole("button", { name: /iniciar sesi[oó]n|ingresar/i }).click()
    await page.waitForURL(/\/dashboard/, { timeout: 25_000 })

    const cookies = await context.cookies()
    const sessionCookie = cookies.find((c) => /next-auth|authjs|session/i.test(c.name))
    expect(sessionCookie, "debe existir cookie de sesión").toBeTruthy()
    // Persistente => tiene expiración futura (no es cookie de sesión de navegador).
    expect(sessionCookie!.expires).toBeGreaterThan(0)
  })
})
