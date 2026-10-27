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

describe("validateInventarioRow — numbers arrive as strings from the CSV parser", () => {
  const base = { nombre: "Funda", stock: "3" }

  it.each([
    ["1.500", 1500],
    ["12.000", 12000],
    ["1.500,50", 1500.5],
    ["1500,50", 1500.5],
    ["1500.50", 1500.5],
    ["$ 1.500", 1500],
    ["1,234.56", 1234.56],
  ])("precioVenta %j -> %j", (raw, expected) => {
    const result = validateInventarioRow({ ...base, precioVenta: raw, precioCompra: raw }, 0)
    expect(result.valid).toBe(true)
    expect(result.data.precioVenta).toBe(expected)
    expect(result.data.precioCompra).toBe(expected)
  })

  it("names the column and the offending value for an invalid price", () => {
    const result = validateInventarioRow({ ...base, precioVenta: "1.5.0" }, 0)
    expect(result.valid).toBe(false)
    expect(result.column).toBe("precioVenta")
    expect(result.message).toContain("Precio de venta")
    expect(result.message).toContain('"1.5.0"')
    expect(result.error).toBe(`Fila 2: ${result.message}`)
  })

  it("names the column for an invalid precioCompra", () => {
    const result = validateInventarioRow({ ...base, precioVenta: "10", precioCompra: "mucho" }, 0)
    expect(result.valid).toBe(false)
    expect(result.column).toBe("precioCompra")
    expect(result.message).toContain("Precio de compra")
    expect(result.message).toContain('"mucho"')
  })

  it("treats a thousands-dotted stock as thousands, not as a decimal", () => {
    expect(validateInventarioRow({ nombre: "A", stock: "1.000", precioVenta: "1" }, 0).data.stock).toBe(1000)
  })

  it("rejects a fractional stock instead of silently gluing the digits together", () => {
    const result = validateInventarioRow({ nombre: "A", stock: "2,5", precioVenta: "1" }, 0)
    expect(result.valid).toBe(false)
    expect(result.column).toBe("stock")
    expect(result.message).toContain("Stock inválido")
    expect(result.message).toContain('"2,5"')
  })

  it("rejects a negative price with the column named", () => {
    const result = validateInventarioRow({ ...base, precioVenta: "-5" }, 0)
    expect(result.valid).toBe(false)
    expect(result.column).toBe("precioVenta")
    expect(result.message).toContain("precio de venta")
  })

  it("honours an explicit spreadsheet row number over the index", () => {
    const result = validateInventarioRow({ nombre: "", precioVenta: "1" }, 0, 7)
    expect(result.error).toContain("Fila 7:")
  })

  it("still accepts native numbers (Excel)", () => {
    const result = validateInventarioRow({ nombre: "A", stock: 4, precioVenta: 1500.5, precioCompra: 900 }, 0)
    expect(result.valid).toBe(true)
    expect(result.data).toMatchObject({ stock: 4, precioVenta: 1500.5, precioCompra: 900 })
  })

  it("accepts a numeric Excel codigo as a string", () => {
    const result = validateInventarioRow({ codigo: 123456, nombre: "A", precioVenta: 1 }, 0)
    expect(result.valid).toBe(true)
    expect(result.data.codigo).toBe("123456")
  })
})

describe("validateClienteRow — identifiers stay strings", () => {
  it("accepts a phone with a leading zero and a DNI with a leading zero", () => {
    const result = validateClienteRow({ nombre: "Juan", telefono: "0111234567", dni: "00123456" }, 0)
    expect(result.valid).toBe(true)
    expect(result.data.telefono).toBe("0111234567")
    expect(result.data.dni).toBe("00123456")
  })

  it("accepts native numbers from Excel for telefono and dni", () => {
    const result = validateClienteRow({ nombre: "Juan", telefono: 1123456789, dni: 12345678 }, 0)
    expect(result.valid).toBe(true)
    expect(result.data.telefono).toBe("1123456789")
    expect(result.data.dni).toBe("12345678")
  })

  it("strips common phone formatting (spaces, dashes, parentheses, dots)", () => {
    const result = validateClienteRow({ nombre: "Juan", telefono: "(11) 2345-6789" }, 0)
    expect(result.valid).toBe(true)
    expect(result.data.telefono).toBe("1123456789")
  })

  it("names the column and the received value when the phone is wrong", () => {
    const result = validateClienteRow({ nombre: "Juan", telefono: "123" }, 0)
    expect(result.valid).toBe(false)
    expect(result.column).toBe("telefono")
    expect(result.message).toContain("El teléfono debe tener exactamente 10 dígitos")
    expect(result.message).toContain('"123"')
  })

  it("names the column for an invalid email", () => {
    const result = validateClienteRow({ nombre: "Juan", telefono: "1123456789", email: "juan@" }, 0)
    expect(result.valid).toBe(false)
    expect(result.column).toBe("email")
    expect(result.message).toContain("Email")
  })

  it("trims whitespace around text fields", () => {
    const result = validateClienteRow({ nombre: "  Juan  ", telefono: "1123456789" }, 0)
    expect(result.data.nombre).toBe("Juan")
  })
})

describe("validateCSVHeaders", () => {
  it("rejects INVENTARIO headers missing precioVenta", () => {
    const result = validateCSVHeaders(["nombre", "stock"], "INVENTARIO")
    expect(result.valid).toBe(false)
    expect(result.error).toContain("Faltan columnas requeridas")
  })
})
