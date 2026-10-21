// @vitest-environment node
import { describe, it, expect } from "vitest"

import { formatearNumeroComprobante } from "@/lib/facturacion/numero-comprobante"

describe("formatearNumeroComprobante", () => {
  it("completa con ceros: punto de venta a 4 dígitos y número a 8", () => {
    expect(formatearNumeroComprobante(3, 1)).toBe("0003-00000001")
    expect(formatearNumeroComprobante(1, 7)).toBe("0001-00000007")
  })

  it("no recorta números que ya llenan el ancho", () => {
    expect(formatearNumeroComprobante(5000, 12345678)).toBe("5000-12345678")
  })
})
