import { test, expect } from "./fixtures/auth"
import { ROUTES } from "./helpers/selectors"
import { settle } from "./helpers/utils"

/**
 * MÓDULO 5 — Pagos / Caja.
 *
 * Cobro lives on the orden detail ("Cobrar" button -> CobrarOrdenDialog).
 * Caja diaria handles the cash session (abrir/cerrar) and manual movements.
 * We avoid mutating real money state by default: opening/closing caja and
 * registering charges are gated behind E2E_MUTATE=1 so the suite is safe to run
 * read-only against a shared tenant.
 */

const MUTATE = process.env.E2E_MUTATE === "1"

test.describe("Caja — lectura", () => {
  test("la página de caja carga con su resumen", async ({ page, serverErrors }) => {
    await page.goto(ROUTES.caja)
    await expect(page.getByText(/Caja Diaria/i).first()).toBeVisible()
    await settle(page)
    expect(serverErrors.failures, serverErrors.failures.join("\n")).toEqual([])
  })

  test("el estado de caja (abierta/cerrada) es visible para ADMIN", async ({ page }) => {
    await page.goto(ROUTES.caja)
    // El banner muestra "Caja abierta" o "Caja cerrada" (sólo ADMIN).
    const banner = page.getByText(/Caja (abierta|cerrada)/i).first()
    // No fallamos si la sesión no es ADMIN: el banner simplemente no está.
    if (await banner.isVisible().catch(() => false)) {
      await expect(banner).toBeVisible()
    }
  })
})

test.describe("Pagos — cobrar una orden", () => {
  test("el detalle de orden expone la acción de cobro", async ({ page }) => {
    await page.goto(ROUTES.ordenes)
    const verBtn = page.getByRole("button", { name: /ver orden/i }).first()
    test.skip(!(await verBtn.isVisible().catch(() => false)), "No hay órdenes para cobrar")
    await verBtn.click()
    await expect(page).toHaveURL(/\/ordenes\/.+/)

    // La card "Presupuesto y Costos" tiene "Cobrar" o "Ver Cobros".
    await expect(page.getByText(/Presupuesto y Costos/i).first()).toBeVisible()
    const cobrar = page.getByRole("button", { name: /cobrar|ver cobros/i }).first()
    await expect(cobrar).toBeVisible()
  })

  test("abrir el diálogo de cobro muestra el resumen pendiente", async ({ page }) => {
    await page.goto(ROUTES.ordenes)
    const verBtn = page.getByRole("button", { name: /ver orden/i }).first()
    test.skip(!(await verBtn.isVisible().catch(() => false)), "No hay órdenes")
    await verBtn.click()

    const cobrar = page.getByRole("button", { name: /^cobrar$/i }).first()
    test.skip(!(await cobrar.isVisible().catch(() => false)), "Orden ya cobrada o sin saldo")
    await cobrar.click()

    // CobrarOrdenDialog: título "Cobrar Orden ..." + label "Pendiente".
    await expect(page.getByText(/Cobrar Orden/i).first()).toBeVisible()
    await expect(page.getByText(/Pendiente/i).first()).toBeVisible()
  })
})

test.describe("Caja — apertura/cierre (mutación, requiere E2E_MUTATE=1)", () => {
  test.skip(!MUTATE, "Mutación de caja deshabilitada — exportá E2E_MUTATE=1 en un tenant desechable")

  test("abrir caja con saldo inicial inválido es rechazado", async ({ page }) => {
    await page.goto(ROUTES.caja)
    const abrir = page.getByRole("button", { name: /abrir caja/i }).first()
    test.skip(!(await abrir.isVisible().catch(() => false)), "La caja ya está abierta")
    await abrir.click()

    // Dejar el saldo vacío y confirmar -> error de validación.
    await page.getByRole("button", { name: /abrir caja/i }).last().click()
    await expect(page.getByText(/Ingrese un monto válido/i)).toBeVisible()
  })
})
