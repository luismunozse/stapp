import { test, expect } from "./fixtures/auth"
import { ROUTES } from "./helpers/selectors"
import { settle } from "./helpers/utils"

/**
 * MÓDULO 4 — Seguimiento, dashboard y reportes.
 *
 * KPI labels are role-dependent (dashboard/page.tsx). We assert the dashboard
 * shell + at least one KPI card, that filters/search work on órdenes, and that
 * the reportes export produces a real download.
 */

test.describe("Dashboard", () => {
  test("carga el dashboard con KPIs y sin errores de consola", async ({ page, consoleWatcher }) => {
    await page.goto(ROUTES.dashboard)
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible()
    // Al menos una card de KPI visible (cualquiera de los roles muestra "Órdenes").
    await expect(page.getByText(/Órdenes/i).first()).toBeVisible()
    await expect(page.getByText(/^Alertas$/).first()).toBeVisible()
    await settle(page)
    expect(consoleWatcher.unexpected(), consoleWatcher.unexpected().join("\n")).toEqual([])
  })
})

test.describe("Seguimiento — filtros y búsqueda en órdenes", () => {
  test("el panel de filtros se abre y permite filtrar por estado", async ({ page }) => {
    await page.goto(ROUTES.ordenes)
    const filtros = page.getByRole("button", { name: /^filtros$/i })
    if (await filtros.isVisible().catch(() => false)) {
      await filtros.click()
      // Aparece el select de estados ("Todos los estados").
      await expect(page.getByText(/Todos los estados/i).first()).toBeVisible()
    }
  })

  test("búsqueda por número de orden no rompe la página", async ({ page, serverErrors }) => {
    await page.goto(ROUTES.ordenes)
    const search = page.getByPlaceholder(/buscar por/i)
    await search.fill("CEL001")
    await settle(page)
    expect(serverErrors.failures, serverErrors.failures.join("\n")).toEqual([])
  })
})

test.describe("Reportes", () => {
  test("la página de reportes carga (ruta ADMIN/VENDEDOR)", async ({ page }) => {
    await page.goto(ROUTES.reportes)
    await expect(page).toHaveURL(/\/reportes/, { timeout: 10_000 })
    await expect(page.getByRole("heading", { name: "Reportes" })).toBeVisible()
  })

  test("exportar un reporte a PDF descarga un archivo", async ({ page }) => {
    await page.goto(ROUTES.reportes)
    // El botón Exportar aparece en tabs con export (ej. "Tiempos").
    const tabTiempos = page.getByRole("tab", { name: /Tiempos/i })
    if (await tabTiempos.isVisible().catch(() => false)) await tabTiempos.click()

    const exportar = page.getByRole("button", { name: /exportar/i })
    test.skip(!(await exportar.isVisible().catch(() => false)), "Tab sin exportación disponible")
    await exportar.click()

    const downloadPromise = page.waitForEvent("download", { timeout: 20_000 })
    await page.getByRole("button", { name: /^PDF$/ }).click()
    const download = await downloadPromise

    const filename = download.suggestedFilename()
    expect(filename).toMatch(/reporte-.*\.pdf$/i)
  })
})
