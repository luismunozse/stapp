import { describe, it, expect } from "vitest"
import { remitoActivo } from "@/lib/facturacion/remito-activo"

describe("remitoActivo", () => {
  it("sin remitos → null", () => {
    expect(remitoActivo(null)).toBeNull()
    expect(remitoActivo([])).toBeNull()
  })
  it("objeto (embed uno-a-uno de antes de la 418)", () => {
    expect(remitoActivo({ id: "a", estado_pago: "PAGADO" })).toEqual({ id: "a", estado_pago: "PAGADO" })
  })
  it("ignora los anulados", () => {
    expect(remitoActivo([{ id: "a", estado_pago: "ANULADA" }])).toBeNull()
    expect(remitoActivo([{ id: "a", estado_pago: "ANULADA" }, { id: "b", estado_pago: "PENDIENTE" }])?.id).toBe("b")
  })
})
