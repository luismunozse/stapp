// @vitest-environment node
import { describe, it, expect } from "vitest"
import { formatDevolucion } from "@/lib/db-utils"

describe("formatDevolucion — lo que el detalle de la venta necesita de cada NC", () => {
  it("expone el modo, el motivo del catálogo y si está anulada", () => {
    const nc = formatDevolucion({
      id: "d1", venta_id: "v1", numero_devolucion: "NC-000012", motivo: "Le cobramos el cable dos veces",
      tipo: "PARCIAL", monto_devolucion: "50", monto_aplicado_deuda: "40", estado: "COMPLETADA",
      modo: "MONTO", motivo_nc: "ERROR_FACTURACION", anulada: false, items_devolucion: [],
    })
    expect(nc).toMatchObject({
      modo: "MONTO", motivoNc: "ERROR_FACTURACION", anulada: false,
      montoDevolucion: 50, montoAplicadoDeuda: 40, montoReembolso: 10, items: [],
    })
  })

  it("el historial sin las columnas de la 350 sale como devolución de productos, sin motivo del catálogo y activa", () => {
    const nc = formatDevolucion({ id: "d0", numero_devolucion: "DEV-000001", motivo: "Falla", monto_devolucion: "100" })
    expect(nc).toMatchObject({ modo: "ITEMS", motivoNc: null, anulada: false })
  })

  it("una NC anulada expone cuándo y por qué se anuló", () => {
    const nc = formatDevolucion({
      id: "d1", numero_devolucion: "NC-000012", monto_devolucion: "50", anulada: true,
      anulada_at: "2026-10-20T15:00:00+00:00", anulada_motivo: "Se cargó por error", metodo_reembolso: "EFECTIVO",
    })
    expect(nc).toMatchObject({
      anulada: true, anuladaAt: "2026-10-20T15:00:00+00:00", anuladaMotivo: "Se cargó por error", metodoReembolso: "EFECTIVO",
    })
  })

  it("una activa no trae datos de anulación", () => {
    expect(formatDevolucion({ id: "d2", numero_devolucion: "NC-000013", monto_devolucion: "10" })).toMatchObject({
      anulada: false, anuladaAt: null, anuladaMotivo: null,
    })
  })
})
