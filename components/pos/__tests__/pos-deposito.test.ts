import { describe, it, expect } from "vitest"
import { buildVentaPayload } from "../pos-payload"
import type { BuildVentaPayloadInput } from "../pos-payload"
import { createPagoLine } from "@/components/pagos/multi-pago-input"

const baseInput: BuildVentaPayloadInput = {
  items: [
    {
      lineId: "pos_1",
      inventarioId: "inv-1",
      codigo: "PROD-01",
      nombre: "Producto de prueba",
      precioUnitario: 1000,
      cantidad: 1,
      stockDisponible: 10,
      diasGarantia: 0,
      trackeaSeries: false,
      serieIds: [],
    },
  ],
  cliente: { id: null, nombre: "", telefono: "" },
  pagosLines: [createPagoLine(1000)],
  pagoParcial: false,
  observaciones: "",
  idempotencyKey: "key-123",
}

describe("buildVentaPayload — depositoId", () => {
  it("incluye depositoId en el payload cuando hay deposito activo", () => {
    const payload = buildVentaPayload({ ...baseInput, depositoId: "dep-2" })
    expect(payload.depositoId).toBe("dep-2")
  })

  it("manda depositoId null sin seleccion", () => {
    const payload = buildVentaPayload({ ...baseInput, depositoId: null })
    expect(payload.depositoId).toBeNull()
  })
})
