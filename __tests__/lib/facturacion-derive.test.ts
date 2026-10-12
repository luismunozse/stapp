import { describe, it, expect } from "vitest"
import { deriveTipo } from "@/lib/facturacion/derive"

describe("deriveTipo", () => {
  it("monotributo emits Factura C", () => {
    expect(deriveTipo("MONOTRIBUTO")).toBe("C")
  })
  it("responsable inscripto emits Factura B", () => {
    expect(deriveTipo("RESPONSABLE_INSCRIPTO")).toBe("B")
  })
})
