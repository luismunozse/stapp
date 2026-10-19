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
})
