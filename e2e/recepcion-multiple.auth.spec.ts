import { test, expect } from "./fixtures/auth"
import { ROUTES } from "./helpers/selectors"
import { settle } from "./helpers/utils"

/**
 * Recepción múltiple — flujo de mostrador.
 *
 * El feature vive detrás del flag de plan `recepcion_multiple` (ver
 * lib/subscriptions.ts + hasPlanFeature). Ese flag sólo existe una vez que
 * las migraciones 277_recepcion_multiple.sql y 278_crear_recepcion_multiple.sql
 * corrieron a mano en el tenant — este repo no tiene runner de migraciones
 * automático. Mientras no corran, ningún plan del tenant QA trae el flag: el
 * botón "Recibir varios equipos" no aparece y /ordenes/recepcion muestra el
 * FeatureLockedView. Por eso estos tests SALTAN hoy con un motivo explícito
 * en vez de fallar — eso es correcto, no un bug de la suite. Un skip acá no
 * prueba que el flujo funcione; sólo prueba que el gate sigue cerrado.
 */

const RAZON_FLAG_DESHABILITADO =
  "La organización de prueba no tiene el flag de plan recepcion_multiple habilitado " +
  "(migraciones 277_recepcion_multiple.sql / 278_crear_recepcion_multiple.sql sin aplicar en el tenant QA)"

test.describe("Recepción múltiple en mostrador", () => {
  test("el botón del listado lleva al formulario, que arranca con dos equipos", async ({
    page,
    serverErrors,
  }) => {
    await page.goto(ROUTES.ordenes)

    // El botón sólo se renderiza cuando canRecepcionMultiple es true (gate en
    // components/ordenes/ordenes-list.tsx). .first() por las dudas: existe una
    // segunda copia del mismo link en el estado vacío de la vista mobile, que
    // sólo se monta si el tenant no tiene ninguna orden (no es el caso acá).
    const botonRecepcion = page.getByRole("link", { name: /recibir varios equipos/i }).first()
    if (!(await botonRecepcion.isVisible().catch(() => false))) {
      test.skip(true, RAZON_FLAG_DESHABILITADO)
    }

    await botonRecepcion.click()
    await expect(page).toHaveURL(/\/ordenes\/recepcion$/)
    await expect(page.getByRole("heading", { name: /recibir varios equipos/i })).toBeVisible()

    // El mínimo son dos equipos: el formulario arranca ahí para que el caso
    // más común del mostrador no necesite un click extra.
    await expect(page.getByRole("heading", { name: /^equipo 1$/i })).toBeVisible()
    await expect(page.getByRole("heading", { name: /^equipo 2$/i })).toBeVisible()
    await expect(page.getByRole("heading", { name: /^equipo 3$/i })).toHaveCount(0)

    // Con el mínimo no debe haber botón de quitar en ninguna card.
    await expect(page.getByRole("button", { name: /quitar equipo/i })).toHaveCount(0)

    // Una sola firma para todo el lote, no una por equipo: es el punto central
    // de la feature (un comprobante firmado una vez cubre los N equipos).
    await expect(page.getByText(/una sola firma cubre los 2 equipos/i)).toBeVisible()
    await expect(page.getByText(/firma del cliente/i)).toHaveCount(1)

    await settle(page)
    expect(serverErrors.failures, serverErrors.failures.join("\n")).toEqual([])
  })

  test("no se puede bajar de dos equipos", async ({ page }) => {
    await page.goto("/ordenes/recepcion")

    const heading = page.getByRole("heading", { name: /recibir varios equipos/i })
    if (!(await heading.isVisible().catch(() => false))) {
      test.skip(true, RAZON_FLAG_DESHABILITADO)
    }

    // Arrancando en el mínimo (2), ninguna card ofrece la opción de quitar:
    // el lote no puede reducirse por debajo de dos equipos.
    await expect(page.getByRole("button", { name: /quitar equipo/i })).toHaveCount(0)
  })
})
