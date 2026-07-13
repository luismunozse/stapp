import { test, expect } from "./fixtures/auth"
import { ROUTES, ESTADO_ORDEN, TRANSICIONES_VALIDAS } from "./helpers/selectors"
import { makeOrden } from "./fixtures/data"
import { SEED } from "./fixtures/seed"
import { settle, openOrdenByMarker } from "./helpers/utils"

/**
 * MÓDULO 2 — Crear/editar orden + MÁQUINA DE ESTADOS.
 *
 * Requires the QA tenant to have at least one cliente seeded (the create wizard
 * mandates a cliente). The state-machine cases derive valid/invalid transitions
 * from lib/orden-state-machine.ts via helpers/selectors.ts.
 */

test.describe("Órdenes — listado", () => {
  test("el listado carga con encabezado y sin errores 5xx", async ({ page, serverErrors }) => {
    await page.goto(ROUTES.ordenes)
    await expect(page.getByText(/Órdenes de Servicio/i).first()).toBeVisible()
    await settle(page)
    expect(serverErrors.failures, serverErrors.failures.join("\n")).toEqual([])
  })

  test("la búsqueda filtra el listado", async ({ page }) => {
    await page.goto(ROUTES.ordenes)
    const search = page.getByPlaceholder(/buscar por/i)
    await expect(search).toBeVisible()
    await search.fill("CEL")
    await settle(page)
    // No assertion on result count (data-dependent); we assert the control works
    // and the page didn't crash.
    await expect(search).toHaveValue("CEL")
  })
})

test.describe("Órdenes — crear (validación)", () => {
  test("abrir el wizard y enviar sin datos muestra errores de validación", async ({ page }) => {
    await page.goto(ROUTES.ordenes)
    await page.getByRole("button", { name: /nueva/i }).click()

    // Paso 1: intentar avanzar sin completar campos obligatorios.
    await expect(page.getByText(/Cliente y Equipo/i).first()).toBeVisible()
    await page.getByRole("button", { name: /siguiente/i }).click()

    // Debe aparecer al menos un error de campo requerido (cliente/dispositivo/problema).
    await expect(
      page.getByText(/es requerido/i).first()
    ).toBeVisible({ timeout: 10_000 })
  })
})

test.describe("Órdenes — crear (flujo completo)", () => {
  // Depende de que exista al menos un cliente en el tenant QA.
  test("crear una orden con datos válidos", async ({ page, serverErrors }) => {
    const data = makeOrden()
    await page.goto(ROUTES.ordenes)
    await page.getByRole("button", { name: /nueva/i }).click()

    // --- Paso 1: Cliente y Equipo ---
    // ClienteSelector es un combobox de búsqueda: abrir, elegir el primero.
    const clienteSelector = page.getByRole("combobox").first()
    await clienteSelector.click()
    const primerCliente = page.getByRole("option").first()
    if (await primerCliente.isVisible().catch(() => false)) {
      await primerCliente.click()
    } else {
      // Algunos selectores filtran por texto: escribir y elegir.
      await page.keyboard.type("a")
      await page.getByRole("option").first().click()
    }

    await page.getByLabel(/^Marca$/i).fill(data.marca)
    await page.getByLabel(/Modelo \/ Dispositivo/i).fill(data.dispositivo)
    await page.getByLabel(/Problema Reportado/i).fill(data.problema)
    await page.getByRole("button", { name: /siguiente/i }).click()

    // --- Paso 2: Detalles ---
    await page.getByLabel(/Presupuesto \(Opcional\)/i).fill(data.presupuesto)
    await page.getByRole("button", { name: /siguiente/i }).click()

    // --- Paso 3: Fotos y Checklist -> Crear ---
    await page.getByRole("button", { name: /crear orden/i }).click()

    // El modal cierra y la orden aparece (buscamos el dispositivo recién creado).
    await expect(page.getByText(data.dispositivo).first()).toBeVisible({ timeout: 15_000 })
    expect(serverErrors.failures, serverErrors.failures.join("\n")).toEqual([])
  })
})

test.describe("Órdenes — máquina de estados", () => {
  test("el selector de estado solo ofrece transiciones válidas", async ({ page }) => {
    // Abrir la orden SEMBRADA (determinístico) en lugar de "la primera".
    const abierta = await openOrdenByMarker(page, SEED.marker)
    test.skip(!abierta, "No se encontró la orden sembrada (¿corrió el seed?)")
    await expect(page).toHaveURL(/\/ordenes\/.+/)
    await expect(page.getByRole("heading", { name: /^Orden\s/i })).toBeVisible()

    // La card "Estado" muestra el estado actual como "{Label} (actual)".
    const estadoActualText = await page.getByText(/\(actual\)/i).first().textContent()
    expect(estadoActualText, "debe mostrar estado actual").toBeTruthy()

    // Determinar el estado actual por su label y verificar que las opciones del
    // <Select> sean exactamente las transiciones permitidas (subconjunto).
    const estadoKey = Object.keys(ESTADO_ORDEN).find((k) =>
      estadoActualText!.includes(ESTADO_ORDEN[k as keyof typeof ESTADO_ORDEN])
    )
    test.skip(!estadoKey, "No se pudo determinar el estado actual de la orden")

    const permitidas = TRANSICIONES_VALIDAS[estadoKey as string] ?? []
    // Abrir el select de estado.
    const estadoSelect = page.getByRole("combobox").first()
    if (await estadoSelect.isVisible().catch(() => false)) {
      await estadoSelect.click()
      const opciones = await page.getByRole("option").allTextContents()
      // Ninguna opción ofrecida debe ser una transición NO permitida.
      const labelsPermitidos = permitidas.map((k) => ESTADO_ORDEN[k as keyof typeof ESTADO_ORDEN])
      for (const op of opciones) {
        const limpio = op.replace(/\(actual\)/i, "").trim()
        if (!limpio) continue
        const esActual = estadoActualText!.includes(limpio)
        const esPermitido = labelsPermitidos.some((l) => limpio.includes(l))
        expect(esPermitido || esActual, `"${limpio}" no debería ofrecerse desde ${estadoKey}`).toBeTruthy()
      }
    }
  })
})
