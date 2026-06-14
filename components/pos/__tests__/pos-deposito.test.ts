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

describe("buildVentaPayload — clienteTelefono", () => {
  it("omite clienteTelefono cuando telefono es vacío", () => {
    const payload = buildVentaPayload({
      ...baseInput,
      cliente: { id: null, nombre: "Juan", telefono: "" },
    })
    expect(payload).not.toHaveProperty("clienteTelefono")
  })

  it("incluye clienteTelefono cuando telefono tiene valor", () => {
    const payload = buildVentaPayload({
      ...baseInput,
      cliente: { id: null, nombre: "Juan", telefono: "099123456" },
    })
    expect(payload.clienteTelefono).toBe("099123456")
  })
})

describe("buildVentaPayload — serieIds", () => {
  it("incluye serieIds solo cuando trackeaSeries=true y hay series", () => {
    const input: BuildVentaPayloadInput = {
      ...baseInput,
      items: [
        {
          ...baseInput.items[0],
          trackeaSeries: true,
          serieIds: ["s1"],
        },
      ],
    }
    const payload = buildVentaPayload(input)
    expect(payload.items[0].serieIds).toEqual(["s1"])
  })

  it("omite serieIds cuando trackeaSeries=false aunque haya serieIds en el item", () => {
    const input: BuildVentaPayloadInput = {
      ...baseInput,
      items: [
        {
          ...baseInput.items[0],
          trackeaSeries: false,
          serieIds: ["s1"],
        },
      ],
    }
    const payload = buildVentaPayload(input)
    expect(payload.items[0]).not.toHaveProperty("serieIds")
  })

  it("omite serieIds cuando trackeaSeries=true pero serieIds está vacío", () => {
    const input: BuildVentaPayloadInput = {
      ...baseInput,
      items: [
        {
          ...baseInput.items[0],
          trackeaSeries: true,
          serieIds: [],
        },
      ],
    }
    const payload = buildVentaPayload(input)
    expect(payload.items[0]).not.toHaveProperty("serieIds")
  })
})
