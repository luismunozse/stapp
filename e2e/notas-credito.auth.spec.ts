import { test, expect } from "./fixtures/auth"
import { ROUTES } from "./helpers/selectors"
import { settle } from "./helpers/utils"

/**
 * Notas de crédito desde la venta y el POS (PR3). Solo lectura: abre el
 * diálogo, calcula por monto y cancela. Emitir de verdad deja una NC en el
 * tenant de QA que recién se puede anular desde el PR4; el E2E que emite y
 * anula (emitir + anular = identidad) llega ahí.
 */
test.describe("Nota de crédito desde la venta", () => {
  test("el diálogo calcula una NC por monto sin emitir nada", async ({ page, serverErrors }) => {
    const res = await page.request.get("/api/ventas?limit=20")
    test.skip(!res.ok(), "No se pudieron leer las ventas")
    const { data } = await res.json()
    const venta = (data as Array<{ id: string; estado: string }>).find((v) => v.estado === "COMPLETADA")
    test.skip(!venta, "No hay ventas completadas en el tenant")

    await page.goto(`${ROUTES.ventas}/${venta!.id}`)
    const boton = page.getByRole("button", { name: "Nota de crédito" })
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
