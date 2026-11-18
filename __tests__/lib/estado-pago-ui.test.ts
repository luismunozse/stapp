import { describe, it, expect } from "vitest"
import { getEstadoPagoUi, normalizarEstadoPago } from "@/lib/estado-pago-ui"

describe("estado-pago-ui", () => {
  it("unifica los sinónimos de ventas y órdenes en una sola etiqueta y tono", () => {
    expect(getEstadoPagoUi("PAGADO")).toEqual(getEstadoPagoUi("COBRADO"))
    expect(getEstadoPagoUi("PAGADO").label).toBe("Cobrado")
    expect(getEstadoPagoUi("PAGADO_PARCIAL")).toEqual(getEstadoPagoUi("PARCIAL"))
    expect(getEstadoPagoUi("PARCIAL").label).toBe("Pago parcial")
    expect(getEstadoPagoUi("PENDIENTE").label).toBe("Sin cobrar")
    expect(getEstadoPagoUi("PENDIENTE").tone).toBe("warning")
  })

  it("normaliza sin importar mayúsculas ni espacios", () => {
    expect(normalizarEstadoPago(" cobrado ")).toBe("PAGADO")
    expect(normalizarEstadoPago(null)).toBeNull()
    expect(normalizarEstadoPago("OTRA_COSA")).toBeNull()
  })

  it("un estado desconocido se muestra tal cual, en tono neutro", () => {
    expect(getEstadoPagoUi("OTRA_COSA")).toMatchObject({ label: "OTRA_COSA", tone: "neutral" })
  })
})
