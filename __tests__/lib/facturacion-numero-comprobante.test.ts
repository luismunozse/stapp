// @vitest-environment node
import { describe, it, expect } from "vitest"

import { formatearNumeroComprobante, parsearNumeroComprobante } from "@/lib/facturacion/numero-comprobante"

describe("formatearNumeroComprobante", () => {
  it("completa con ceros: punto de venta a 4 dígitos y número a 8", () => {
    expect(formatearNumeroComprobante(3, 1)).toBe("0003-00000001")
    expect(formatearNumeroComprobante(1, 7)).toBe("0001-00000007")
  })

  it("no recorta números que ya llenan el ancho", () => {
    expect(formatearNumeroComprobante(5000, 12345678)).toBe("5000-12345678")
  })
})

describe("parsearNumeroComprobante", () => {
  it("lee punto de venta y número del formato PPPP-NNNNNNNN", () => {
    expect(parsearNumeroComprobante("0003-00000001")).toEqual({ puntoVenta: 3, numero: 1 })
    expect(parsearNumeroComprobante("5000-12345678")).toEqual({ puntoVenta: 5000, numero: 12345678 })
  })

  it("ARCA admite puntos de venta de hasta 5 dígitos", () => {
    expect(parsearNumeroComprobante("99999-00000001")).toEqual({ puntoVenta: 99999, numero: 1 })
  })

  it("es la inversa de formatearNumeroComprobante", () => {
    expect(parsearNumeroComprobante(formatearNumeroComprobante(12, 345))).toEqual({ puntoVenta: 12, numero: 345 })
  })

  it("acepta anchos más cortos y espacios alrededor (filas de otros proveedores)", () => {
    expect(parsearNumeroComprobante("3-1")).toEqual({ puntoVenta: 3, numero: 1 })
    expect(parsearNumeroComprobante("  0003-00000001 ")).toEqual({ puntoVenta: 3, numero: 1 })
  })

  it.each([
    ["vacío", ""],
    ["null", null],
    ["undefined", undefined],
    ["sin guion", "000300000001"],
    ["dos guiones", "0003-0000-0001"],
    ["letras", "00A3-00000001"],
    ["punto de venta de 6 dígitos", "000003-00000001"],
    ["número de 9 dígitos", "0003-000000001"],
    ["punto de venta cero", "0000-00000001"],
    ["número cero", "0003-00000000"],
    ["negativo", "-3-00000001"],
  ])("devuelve null cuando el número es inválido (%s)", (_titulo, entrada) => {
    expect(parsearNumeroComprobante(entrada as string | null | undefined)).toBeNull()
  })
})
