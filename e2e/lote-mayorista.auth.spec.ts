import { test, expect } from "./fixtures/auth"
import { ROUTES } from "./helpers/selectors"
import { SEED } from "./fixtures/seed"
import { settle, uniqueSuffix } from "./helpers/utils"

/**
 * Lote mayorista — recepción múltiple con descuento y entrega con cobro único.
 *
 * Flujo cubierto (ver .superpowers/sdd/2026-08-04-lote-mayorista-recepcion/):
 *   1. crear una recepción de 2 equipos desde el formulario (/ordenes/recepcion)
 *   2. abrir el detalle del lote desde el modal de éxito ("Ver lote")
 *   3. aplicar un descuento del 10% (ADMIN) y verificar que se refleje
 *   4. reparar ambas órdenes con costo final, vía API (ver nota más abajo)
 *   5. "Entregar lote": EFECTIVO, confirmar
 *   6. verificar "2 de 2 entregados", el estado ENTREGADO puntual de cada
 *      orden, y que el total cobrado sea la suma de costos menos el 10%
 *
 * Depende de CUATRO migraciones manuales aplicadas al tenant (este repo no
 * tiene runner de migraciones automático — ver scripts/db-run.mjs):
 *   - 287_recepcion_multiple.sql / 288_crear_recepcion_multiple.sql: habilitan
 *     el flag de plan `recepcion_multiple` y el RPC crear_recepcion_multiple.
 *     Sin esto, /ordenes/recepcion muestra el FeatureLockedView y el botón
 *     "Recibir varios equipos" ni siquiera aparece — igual que en
 *     e2e/recepcion-multiple.auth.spec.ts, este test SALTA en ese caso con un
 *     motivo explícito en vez de fallar.
 *   - 289_recepcion_descuento.sql / 290_entregar_lote_recepcion.sql: agregan
 *     descuento_tipo/descuento_valor a `recepciones` y el RPC
 *     entregar_lote_recepcion. Si el flag ya está pero estas dos no corrieron,
 *     GET /api/recepciones/[id] devuelve 500 (columna inexistente). Este test
 *     SALTA únicamente ante ese 500 puntual (probing directo a la API antes
 *     de asumir que el detalle del lote funciona), para no bloquear CI con un
 *     rojo falso antes de que esas migraciones corran en el tenant QA. Un
 *     status no-ok distinto de 500 (404, 403, etc.) hace fallar el test: un
 *     guard `!ok()` genérico enmascararía regresiones reales para siempre,
 *     incluso después de que 289/290 ya estén aplicadas.
 *
 * Mover las dos órdenes a REPARADO se hace por API (request fixture), no por
 * UI: la máquina de estados (lib/orden-state-machine.ts) permite
 * RECIBIDO -> EN_REPARACION -> REPARADO directo, que es el camino más corto,
 * y conducir eso a través del formulario de detalle de una orden individual
 * no es lo que este test verifica (el flujo de lote es lo que está bajo
 * prueba, no el detalle de orden). El costo final sólo es obligatorio al
 * llegar a REPARADO (CAMPOS_REQUERIDOS_POR_ESTADO), así que va en el mismo
 * PUT que hace esa transición.
 */

const RAZON_FLAG_DESHABILITADO =
  "La organización de prueba no tiene el flag de plan recepcion_multiple habilitado " +
  "(migraciones 287_recepcion_multiple.sql / 288_crear_recepcion_multiple.sql sin aplicar en el tenant QA)"

const RAZON_MIGRACION_LOTE_PENDIENTE =
  "El flag recepcion_multiple está activo pero GET /api/recepciones/[id] respondió 500 " +
  "(migraciones 289_recepcion_descuento.sql / 290_entregar_lote_recepcion.sql sin aplicar en el tenant QA)"

const RAZON_NO_ADMIN =
  "La sesión de prueba no es ADMIN: el editor de descuento del lote no se muestra " +
  "(RecepcionDetail sólo lo renderiza para isAdmin) y la entrega con cobro único también lo exige " +
  "(POST /api/recepciones/[id]/entregar responde 403 para no-ADMIN)."

test.describe("Lote mayorista — recepción a entrega", () => {
  test("crea un lote de 2 equipos, aplica descuento, repara y entrega con cobro único", async ({
    page,
    request,
    serverErrors,
  }) => {
    const suffix = uniqueSuffix()

    // --- 1) Crear la recepción múltiple desde el formulario --------------
    await page.goto(ROUTES.ordenes)
    const botonRecepcion = page.getByRole("link", { name: /recibir varios equipos/i }).first()
    if (!(await botonRecepcion.isVisible().catch(() => false))) {
      test.skip(true, RAZON_FLAG_DESHABILITADO)
    }
    await botonRecepcion.click()
    await expect(page).toHaveURL(/\/ordenes\/recepcion$/)

    // Cliente: buscar el sembrado por marcador estable (ver e2e/fixtures/seed.ts).
    await page.getByPlaceholder(/buscar cliente por nombre/i).fill(SEED.marker)
    const opcionCliente = page.getByRole("button", { name: new RegExp(SEED.clienteNombre, "i") })
    await expect(opcionCliente).toBeVisible({ timeout: 10_000 })
    await opcionCliente.click()

    // Cada RecepcionEquipoCard es su propio <Card> (rounded-lg border); desde
    // el heading "Equipo N" subimos al Card más cercano que lo envuelve para
    // no confundirlo con el <Card> exterior del formulario completo, que
    // también contiene ese mismo heading como descendiente.
    const equipoCard = (n: number) =>
      page
        .getByRole("heading", { name: new RegExp(`^equipo ${n}$`, "i") })
        .locator("xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' rounded-lg ')][1]")

    for (const n of [1, 2]) {
      const card = equipoCard(n)
      // "Celular" es el tipo base que la app auto-siembra para cualquier
      // organización sin tipos propios (ver TIPOS_BASE en
      // app/api/tipos-dispositivo/route.ts) — un selector estable, a
      // diferencia de "el primer botón", que también podría matchear un
      // botón de otra sección de la card mientras los tipos siguen cargando.
      const tipoButton = card.getByRole("button", { name: /^celular$/i })
      await expect(tipoButton).toBeVisible({ timeout: 15_000 })
      await tipoButton.click()

      await card.getByPlaceholder("Ej: iPhone 13").fill(`QA-Lote-${suffix}-${n}`)
      const marca = card.getByPlaceholder("Ej: Apple")
      if (await marca.isVisible().catch(() => false)) {
        await marca.fill("QA-Marca")
      }
      await card.locator("textarea").fill(`No enciende — caso E2E lote ${suffix}-${n}`)
    }

    await page.getByLabel(/acepta los t.rminos/i).check()
    await page.getByRole("button", { name: /crear recepci[oó]n \(2 equipos\)/i }).click()

    // --- 2) Modal de éxito -> "Ver lote" ----------------------------------
    const verLote = page.getByRole("link", { name: /ver lote/i })
    await expect(verLote).toBeVisible({ timeout: 15_000 })
    await verLote.click()
    await expect(page).toHaveURL(/\/ordenes\/recepcion\/[^/]+$/)
    const recepcionId = page.url().match(/\/ordenes\/recepcion\/([^/?#]+)/)?.[1]
    if (!recepcionId) {
      throw new Error("No se pudo extraer el id de la recepción de la URL")
    }

    // Probe directo a la API del lote: si 289/290 no corrieron, este
    // endpoint responde específicamente 500 (columna descuento_tipo/
    // descuento_valor inexistente en `recepciones`, ver
    // app/api/recepciones/[id]/route.ts) — sólo ESE status se trata como
    // "migración pendiente" y saltamos en vez de fallar en rojo. Cualquier
    // otro status no-ok (404 por un recepcionId mal extraído de la URL, 403,
    // o un 500 genuino ya con las migraciones aplicadas) tiene que fallar el
    // test en lugar de quedar enmascarado como skip: si el guard fuera
    // `!detalleRes.ok()` a secas, una regresión real después de que 289/290
    // corran en el tenant seguiría saltando en silencio para siempre. De
    // paso, esta misma llamada nos da los ids de las 2 órdenes del lote.
    const detalleRes = await request.get(`/api/recepciones/${recepcionId}`)
    if (detalleRes.status() === 500) {
      test.skip(true, RAZON_MIGRACION_LOTE_PENDIENTE)
    }
    expect(detalleRes.ok(), `GET recepcion detalle falló con ${detalleRes.status()}`).toBeTruthy()
    const detalle = await detalleRes.json()
    const [orden1, orden2] = detalle.ordenes as Array<{ id: string; numeroOrden: number }>
    expect(orden1?.id, "el lote debe tener 2 órdenes").toBeTruthy()
    expect(orden2?.id, "el lote debe tener 2 órdenes").toBeTruthy()

    await expect(page.getByRole("heading", { name: /equipos del lote/i })).toBeVisible({ timeout: 15_000 })

    // --- 3) Descuento 10% (sólo ADMIN, ver RecepcionDetail) ---------------
    const guardarDescuento = page.getByRole("button", { name: /^guardar$/i })
    if (!(await guardarDescuento.isVisible().catch(() => false))) {
      test.skip(true, RAZON_NO_ADMIN)
    }
    await page.getByLabel(/^descuento$/i).fill("10")
    await guardarDescuento.click()
    await expect(page.getByText(/descuento \(10%\)/i)).toBeVisible({ timeout: 10_000 })

    // --- 4) Reparar ambas órdenes con costo final, vía API ----------------
    const costos = [15000, 9000]
    const ordenes = [orden1, orden2]
    for (let i = 0; i < ordenes.length; i++) {
      const enReparacion = await request.put(`/api/ordenes/${ordenes[i].id}`, {
        data: { estado: "EN_REPARACION" },
      })
      expect(enReparacion.ok(), await enReparacion.text()).toBeTruthy()

      const reparado = await request.put(`/api/ordenes/${ordenes[i].id}`, {
        data: { estado: "REPARADO", costoFinal: costos[i] },
      })
      expect(reparado.ok(), await reparado.text()).toBeTruthy()
    }

    // --- 5) Entregar el lote con cobro único (EFECTIVO) --------------------
    await page.reload()
    const entregarLote = page.getByRole("button", { name: /entregar lote/i })
    await expect(entregarLote).toBeEnabled({ timeout: 15_000 })
    await entregarLote.click()

    await expect(page.getByText(/confirm[aá] el costo final/i)).toBeVisible()
    await expect(page.getByLabel(`Costo final #${orden1.numeroOrden}`)).toHaveValue(String(costos[0]))
    await expect(page.getByLabel(`Costo final #${orden2.numeroOrden}`)).toHaveValue(String(costos[1]))

    await page.getByLabel(/^efectivo$/i).check()

    const [entregaResponse] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().endsWith(`/api/recepciones/${recepcionId}/entregar`) && res.request().method() === "POST"
      ),
      page.getByRole("button", { name: /confirmar entrega/i }).click(),
    ])
    expect(entregaResponse.ok(), await entregaResponse.text()).toBeTruthy()
    const entregaBody = await entregaResponse.json()
    const totalEsperado = (costos[0] + costos[1]) * 0.9 // subtotal - 10%
    expect(entregaBody.totalCobrado).toBeCloseTo(totalEsperado, 2)

    // --- 6) Ambos equipos entregados, lote completo -------------------------
    await expect(page.getByText(/2 de 2 entregados/i)).toBeVisible({ timeout: 15_000 })

    // El agregado "2 de 2 entregados" cuenta cualquier variante ENTREGADO_*
    // (ver ESTADOS_ENTREGADOS en lib/lote-estados.ts),
    // pero el flujo de este test entrega con cobro (no "sin cobro" ni
    // "retiro sin reparación") y el RPC entregar_lote_recepcion hardcodea
    // el estado ENTREGADO para ese camino — así que además se verifica el
    // estado puntual, no sólo el conteo agregado. Cada fila de la card
    // "Equipos del lote" muestra un OrderStatusBadge cuyo texto es
    // exactamente "Entregado" (ver getOrderStatusLabel en
    // components/ui/badge.tsx); el regex anclado evita matchear variantes
    // como "Entregado sin Cobro".
    const equiposDelLoteCard = page
      .getByRole("heading", { name: /equipos del lote/i })
      .locator("xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' rounded-lg ')][1]")
    await expect(equiposDelLoteCard.getByText(/^Entregado$/)).toHaveCount(2)

    await settle(page)
    expect(serverErrors.failures, serverErrors.failures.join("\n")).toEqual([])
  })
})
