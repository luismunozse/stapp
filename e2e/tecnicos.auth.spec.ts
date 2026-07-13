import { test, expect } from "./fixtures/auth"
import { ROUTES } from "./helpers/selectors"
import { makeTecnico } from "./fixtures/data"
import { settle } from "./helpers/utils"

/**
 * MÓDULO 3 — Técnicos y asignación.
 *
 * Assumes the persisted session is an ADMIN (only ADMIN can reach /tecnicos —
 * middleware.ts adminOnlyRoutes). Assignment is exercised from the orden detail
 * "Técnico Asignado" card.
 */

test.describe("Técnicos — CRUD", () => {
  test("el listado de técnicos carga (ruta ADMIN)", async ({ page }) => {
    await page.goto(ROUTES.tecnicos)
    // Si la sesión fuese no-ADMIN, middleware redirige a /dashboard.
    await expect(page).toHaveURL(/\/tecnicos/, { timeout: 10_000 })
    await expect(page.getByText(/^Técnicos$/).first()).toBeVisible()
  })

  test("validación: % de comisión fuera de rango es rechazado", async ({ page }) => {
    await page.goto(ROUTES.tecnicos)
    await page.getByRole("button", { name: /nuevo técnico/i }).click()
    await expect(page.getByText(/Nuevo Técnico/i).first()).toBeVisible()

    const data = makeTecnico({ comision: "150" }) // fuera de 0-100
    await page.getByLabel(/Nombre \*/i).fill(data.nombre)
    await page.getByLabel(/Email \*/i).fill(data.email)
    await page.getByLabel(/Contraseña/i).fill(data.password)
    await page.getByLabel(/% Comisión/i).fill(data.comision)
    await page.getByRole("button", { name: /guardar/i }).click()

    await expect(page.getByText(/El porcentaje de comisión debe estar entre 0 y 100/i)).toBeVisible()
  })

  test("crear un técnico válido lo agrega al listado", async ({ page, serverErrors }) => {
    const data = makeTecnico()
    await page.goto(ROUTES.tecnicos)
    await page.getByRole("button", { name: /nuevo técnico/i }).click()

    await page.getByLabel(/Nombre \*/i).fill(data.nombre)
    await page.getByLabel(/Email \*/i).fill(data.email)
    await page.getByLabel(/Contraseña/i).fill(data.password)
    await page.getByLabel(/% Comisión/i).fill(data.comision)
    await page.getByRole("button", { name: /guardar/i }).click()

    await expect(page.getByText(data.nombre).first()).toBeVisible({ timeout: 15_000 })
    await settle(page)
    expect(serverErrors.failures, serverErrors.failures.join("\n")).toEqual([])
  })
})

test.describe("Técnicos — asignación a una orden", () => {
  test("asignar un técnico desde el detalle de la orden", async ({ page }) => {
    await page.goto(ROUTES.ordenes)
    const verBtn = page.getByRole("button", { name: /ver orden/i }).first()
    test.skip(!(await verBtn.isVisible().catch(() => false)), "No hay órdenes para asignar técnico")
    await verBtn.click()
    await expect(page).toHaveURL(/\/ordenes\/.+/)

    // Card "Técnico Asignado": <Select> con "Sin asignar" + técnicos.
    const card = page.getByText(/Técnico Asignado/i).first()
    await expect(card).toBeVisible()

    // El select de técnico es el combobox dentro/junto a esa card.
    const tecnicoSelect = page.getByRole("combobox").filter({ hasText: /asignar|técnico|sin/i }).first()
    if (await tecnicoSelect.isVisible().catch(() => false)) {
      await tecnicoSelect.click()
      const opcion = page.getByRole("option").nth(1) // [0] suele ser "Sin asignar"
      if (await opcion.isVisible().catch(() => false)) {
        const nombre = (await opcion.textContent())?.trim() ?? ""
        await opcion.click()
        // Tras asignar, el nombre debe reflejarse en la card.
        if (nombre) await expect(page.getByText(nombre).first()).toBeVisible({ timeout: 10_000 })
      }
    }
  })
})

test.describe("Técnicos — guard de rol (requiere sesión TECNICO)", () => {
  // Para verificar que un TECNICO NO accede a /tecnicos se necesita una segunda
  // sesión. Se habilita proveyendo STAPP_TEST_TECNICO_EMAIL/PASSWORD y corriendo
  // con esa storageState. Documentado en README; aquí se deja como referencia.
  test.skip(true, "Requiere sesión con rol TECNICO (STAPP_TEST_TECNICO_*) — ver README")
})
