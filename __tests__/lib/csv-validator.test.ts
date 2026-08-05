import { describe, it, expect } from "vitest"
import { validateInventarioRow, validateClienteRow, validateCSVHeaders } from "@/lib/csv-validator"

describe("validateInventarioRow", () => {
  it("allows empty precioVenta ('') and defaults to 0, flagging sinPrecio", () => {
    const result = validateInventarioRow({ nombre: "Producto A", stock: "5", precioVenta: "" }, 0)
    expect(result.valid).toBe(true)
    expect(result.data.precioVenta).toBe(0)
    expect(result.sinPrecio).toBe(true)
  })

  it("treats whitespace-only precioVenta as empty (0 + sinPrecio)", () => {
    const result = validateInventarioRow({ nombre: "Producto A", stock: "5", precioVenta: "  " }, 0)
    expect(result.valid).toBe(true)
    expect(result.data.precioVenta).toBe(0)
    expect(result.sinPrecio).toBe(true)
  })

  it("allows null precioVenta and defaults to 0, flagging sinPrecio", () => {
    const result = validateInventarioRow({ nombre: "Producto A", stock: "5", precioVenta: null }, 0)
    expect(result.valid).toBe(true)
    expect(result.data.precioVenta).toBe(0)
    expect(result.sinPrecio).toBe(true)
  })

  it("rejects an unparseable precioVenta with a specific message", () => {
    const result = validateInventarioRow({ nombre: "Producto A", stock: "5", precioVenta: "abc" }, 0)
    expect(result.valid).toBe(false)
    expect(result.error).toContain("Precio de venta inválido")
  })

  it("rejects an unparseable stock with a specific message (not generic)", () => {
    const result = validateInventarioRow({ nombre: "Producto A", stock: "xyz", precioVenta: "100" }, 0)
    expect(result.valid).toBe(false)
    expect(result.error).toContain("Stock inválido")
  })

  it("parses a normal row with a valid price and no sinPrecio flag", () => {
    const result = validateInventarioRow({ nombre: "Producto A", stock: "5", precioVenta: "1.500,50" }, 0)
    expect(result.valid).toBe(true)
    expect(result.data.precioVenta).toBe(1500.5)
    expect(result.sinPrecio).toBeFalsy()
  })
})

describe("validateClienteRow", () => {
  it("rejects a telefono with fewer than 10 digits with the specific message", () => {
    const result = validateClienteRow({ nombre: "Juan", telefono: "123" }, 0)
    expect(result.valid).toBe(false)
    expect(result.error).toContain("El teléfono debe tener exactamente 10 dígitos")
  })
})

describe("validateCSVHeaders", () => {
  it("rejects INVENTARIO headers missing precioVenta", () => {
    const result = validateCSVHeaders(["nombre", "stock"], "INVENTARIO")
    expect(result.valid).toBe(false)
    expect(result.error).toContain("Faltan columnas requeridas")
  })
})
