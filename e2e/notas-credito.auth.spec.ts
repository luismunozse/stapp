import { test, expect } from "./fixtures/auth"
import { ROUTES } from "./helpers/selectors"
import { settle } from "./helpers/utils"

/**
 * Notas de crédito desde la venta y el POS (PR3). Solo lectura: abre el
 * diálogo, calcula por monto y cancela. El que emite y anula (emitir + anular
 * = identidad) está abajo y muta datos: solo con E2E_MUTATE=1.
 */
test.describe("Nota de crédito desde la venta", () => {
  test("el diálogo calcula una NC por monto sin emitir nada", async ({ page, serverErrors }) => {
    const res = await page.request.get("/api/ventas?limit=20")
    test.skip(!res.ok(), "No se pudieron leer las ventas")
    const { data } = await res.json()
    const venta = (data as Array<{ id: string; estado: string }>).find((v) => v.estado === "COMPLETADA")
    test.skip(!venta, "No hay ventas completadas en el tenant")

    await page.goto(`${ROUTES.ventas}/${venta!.id}`)
    const boton = page.getByRole("button", { name: "Nota de crédito", exact: true })
    test.skip(!(await boton.isVisible().catch(() => false)), "La sesión no es ADMIN")
    await boton.click()

    const dialogo = page.getByRole("dialog", { name: /Nota de crédito · Venta V/ })
    await expect(dialogo).toBeVisible()
    await dialogo.getByRole("button", { name: "Por monto" }).click()
    await dialogo.getByLabel("Monto a acreditar").fill("1")
    await expect(dialogo.getByText("Se acredita")).toBeVisible()
    await expect(dialogo.getByText("Saldo pendiente después")).toBeVisible()
    await dialogo.getByRole("button", { name: "Cancelar" }).click()
    await expect(dialogo).toBeHidden()

    await settle(page)
    expect(serverErrors.failures, serverErrors.failures.join("\n")).toEqual([])
  })
})

test.describe("Nota de crédito desde el POS", () => {
  test("Devolución abre la búsqueda de la venta", async ({ page }) => {
    await page.goto(ROUTES.pos)
    const boton = page.getByRole("button", { name: "Devolución (nota de crédito)" })
    test.skip(!(await boton.isVisible().catch(() => false)), "La sesión no es ADMIN")
    await boton.click()
    await expect(page.getByRole("dialog", { name: /Buscar venta para devolución/ })).toBeVisible()
  })
})

const MUTATE = process.env.E2E_MUTATE === "1"

/**
 * Emitir + anular = identidad (spec, "Tests" → E2E). Muta datos: solo con
 * E2E_MUTATE=1 en un taller desechable. La NC es de $1 por transferencia, así
 * que no mueve la caja.
 */
test.describe("Emitir y anular una nota de crédito (mutación, requiere E2E_MUTATE=1)", () => {
  test.skip(!MUTATE, "Mutación deshabilitada: exportá E2E_MUTATE=1 en un taller desechable")

  test("anular deja la venta como estaba", async ({ page, serverErrors }) => {
    type NC = { montoDevolucion: number; anulada?: boolean }
    type Venta = { id: string; estado: string; total: number; saldoPendiente: number; estadoPago: string; devoluciones: NC[] }

    const res = await page.request.get("/api/ventas?limit=50")
    test.skip(!res.ok(), "No se pudieron leer las ventas")
    const { data } = await res.json()
    const disponible = (v: Venta) =>
      v.total - v.devoluciones.filter((d) => !d.anulada).reduce((s, d) => s + d.montoDevolucion, 0)
    const venta = (data as Venta[]).find((v) => v.estado === "COMPLETADA" && disponible(v) >= 1)
    test.skip(!venta, "No hay una venta con saldo para acreditar")

    const foto = async () => {
      const v = (await (await page.request.get(`/api/ventas/${venta!.id}`)).json()) as Venta
      return {
        saldoPendiente: v.saldoPendiente,
        estadoPago: v.estadoPago,
        activas: v.devoluciones.filter((d) => !d.anulada).length,
      }
    }
    const antes = await foto()

    await page.goto(`${ROUTES.ventas}/${venta!.id}`)
    const emitir = page.getByRole("button", { name: "Nota de crédito", exact: true })
    test.skip(!(await emitir.isVisible().catch(() => false)), "La sesión no es ADMIN")
    await emitir.click()
    const dialogo = page.getByRole("dialog", { name: /Nota de crédito · Venta V/ })
    await dialogo.getByRole("button", { name: "Por monto" }).click()
    await dialogo.getByLabel("Monto a acreditar").fill("1")
    await dialogo.getByLabel("Motivo", { exact: true }).selectOption("AJUSTE_PRECIO")
    const medio = dialogo.getByLabel("Cómo se le devuelve")
    if (await medio.isVisible().catch(() => false)) await medio.selectOption("TRANSFERENCIA")
    await dialogo.getByRole("button", { name: "Emitir nota de crédito" }).click()
    await expect(dialogo).toBeHidden()

    // La recién emitida es la más reciente: su "Anular" es el único habilitado.
    const anular = page.getByRole("button", { name: /^Anular la nota de crédito NC-/, disabled: false })
    await expect(anular).toHaveCount(1)
    await anular.click()
    const confirmar = page.getByRole("dialog", { name: /Anular la nota de crédito NC-/ })
    await confirmar.getByLabel("Motivo de la anulación").fill("Prueba E2E: emitir y anular")
    await confirmar.getByRole("button", { name: "Anular nota de crédito" }).click()
    await expect(confirmar).toBeHidden()
    await expect(page.getByText("Anulada", { exact: true }).first()).toBeVisible()

    expect(await foto()).toEqual(antes)
    await settle(page)
    expect(serverErrors.failures, serverErrors.failures.join("\n")).toEqual([])
  })
})
