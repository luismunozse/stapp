import { test, expect } from "./fixtures/auth"
import { ROUTES } from "./helpers/selectors"
import { makeOrden } from "./fixtures/data"
import { openOrdenByMarker, settle } from "./helpers/utils"

/**
 * Diagrama de daños de punta a punta:
 *   recepción (2 pins firmados) -> detalle (candado) -> daño detectado en
 *   diagnóstico (con autor) -> seguimiento público (3 pins + "Detectado por el técnico").
 *
 * Requiere la migración 408 (tabla orden_danos) aplicada en la base de prueba.
 * Los pins se dibujan en un overlay HTML y solo se ven los de la vista activa
 * (Frente / Dorso), por eso el daño del dorso se verifica cambiando de pestaña.
 */
test.describe("Diagrama de daños", () => {
  test("recepción, detalle, daño detectado y seguimiento público", async ({ page, serverErrors }) => {
    const data = makeOrden()

    // --- 1. Crear una orden de un celular marcando 2 daños en el frente ---
    await page.goto(ROUTES.ordenes)
    await page.getByRole("button", { name: /nueva/i }).click()

    const clienteSelector = page.getByRole("combobox").first()
    await clienteSelector.click()
    const primerCliente = page.getByRole("option").first()
    if (await primerCliente.isVisible().catch(() => false)) {
      await primerCliente.click()
    } else {
      await page.keyboard.type("a")
      await page.getByRole("option").first().click()
    }

    await page.getByRole("button", { name: "Celular", exact: true }).click()
    await page.getByLabel(/^Marca$/i).fill(data.marca)
    await page.getByLabel(/Modelo \/ Dispositivo/i).fill(data.dispositivo)
    await page.getByLabel(/Problema Reportado/i).fill(data.problema)
    await page.getByLabel(/Teléfono de contacto/i).fill("1155550000")

    // Paso 1 -> 2 -> 3 (el estado físico vive en el paso 3).
    await page.getByRole("button", { name: /agregar detalles/i }).click()
    await page.getByRole("button", { name: /siguiente/i }).click()
    await expect(page.getByRole("heading", { name: "Estado físico" })).toBeVisible()

    const dibujo = page.getByTestId("diagrama-svg")
    await expect(dibujo).toHaveAccessibleName(/vista frente/i)

    // Tocar el dibujo abre el selector de tipo; un toque en el tipo agrega el daño.
    await dibujo.click({ position: { x: 60, y: 80 } })
    await page.getByRole("button", { name: "Golpe", exact: true }).click()
    await expect(page.getByRole("button", { name: /^Daño 1: golpe, frente$/i })).toBeVisible()

    await dibujo.click({ position: { x: 200, y: 300 } })
    await page.getByRole("button", { name: "Rayón", exact: true }).click()
    await expect(page.getByRole("button", { name: /^Daño 2: rayón, frente$/i })).toBeVisible()

    await page.getByRole("button", { name: /crear orden/i }).click()
    await expect(page.getByText(data.dispositivo).first()).toBeVisible({ timeout: 15_000 })

    // --- 2. Detalle: los 2 pins de recepción aparecen con candado ---
    const abierta = await openOrdenByMarker(page, data.dispositivo)
    expect(abierta, "no se pudo abrir la orden recién creada").toBe(true)
    const ordenId = page.url().split("/ordenes/")[1].split(/[?#]/)[0]

    await expect(page.getByRole("heading", { name: "Estado físico" })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole("button", { name: /^Daño 1: golpe, frente$/i })).toBeVisible()
    await expect(page.getByRole("button", { name: /^Daño 2: rayón, frente$/i })).toBeVisible()
    await expect(page.getByTestId("icono-candado")).toHaveCount(2)
    await expect(page.getByText("Firmado por el cliente")).toHaveCount(2)

    // --- 3. Agregar un daño detectado (Humedad, dorso) ---
    await page.getByRole("button", { name: "Agregar daño detectado" }).click()
    await page.getByRole("tab", { name: "Dorso" }).click()
    await page.getByRole("button", { name: "Agregar daño", exact: true }).click()
    await page.getByRole("button", { name: "Humedad", exact: true }).click()

    const itemHumedad = page.getByRole("listitem").filter({ hasText: "3. Humedad – Dorso" })
    await expect(itemHumedad).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole("heading", { name: "Detectados en diagnóstico" })).toBeVisible()
    await expect(itemHumedad.getByRole("button", { name: "Quitar daño 3" })).toBeVisible()

    // El autor queda registrado en el servidor y se muestra en la lista.
    const res = await page.request.get(`/api/ordenes/${ordenId}/danos`)
    expect(res.ok()).toBe(true)
    const { danos } = (await res.json()) as { danos: { tipo: string; momento: string; createdByNombre?: string | null }[] }
    const humedad = danos.find((d) => d.tipo === "humedad")
    expect(humedad?.momento).toBe("diagnostico")
    expect(humedad?.createdByNombre).toBeTruthy()
    await expect(itemHumedad).toContainText(humedad!.createdByNombre!)

    // --- 4. Seguimiento público: 3 pins y la etiqueta del técnico ---
    const linkSeguimiento = (await page.getByText(/\/seguimiento\/[A-Za-z0-9_-]+/).first().textContent())?.trim() ?? ""
    const token = linkSeguimiento.split("/seguimiento/")[1]
    expect(token, "no se encontró el link de seguimiento en el detalle").toBeTruthy()

    await page.goto(ROUTES.landing) // salir del detalle antes de abrir la vista pública
    await page.goto(`/seguimiento/${token}`)
    await expect(page.getByText("Estado físico").first()).toBeVisible({ timeout: 15_000 })

    // Vista frente: los 2 pins de recepción.
    await expect(page.getByRole("button", { name: /^Daño 1: golpe, frente$/i })).toBeVisible()
    await expect(page.getByRole("button", { name: /^Daño 2: rayón, frente$/i })).toBeVisible()
    // Vista dorso: el daño detectado.
    await page.getByRole("tab", { name: "Dorso" }).click()
    await expect(page.getByRole("button", { name: /^Daño 3: humedad, dorso$/i })).toBeVisible()
    // La lista muestra los 3 y marca el detectado por el técnico.
    await expect(page.getByText("3. Humedad – Dorso")).toBeVisible()
    await expect(page.getByText("Detectado por el técnico")).toHaveCount(1)

    await settle(page)
    expect(serverErrors.failures, serverErrors.failures.join("\n")).toEqual([])
  })
})
