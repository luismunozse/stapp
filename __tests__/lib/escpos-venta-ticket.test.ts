// @vitest-environment node
import { describe, it, expect } from "vitest"
import { generateTicketCommands, type TicketData } from "@/lib/escpos"

function decode(bytes: Uint8Array): string {
  return new TextDecoder("latin1").decode(bytes)
}

const baseData: TicketData = {
  numeroVenta: 42,
  fecha: "01/07/2026 10:30",
  cliente: { nombre: "Juan Perez", telefono: "1122334455" },
  vendedor: "Maria Gomez",
  items: [
    { descripcion: "Cable USB-C", cantidad: 2, precioUnitario: 1500, subtotal: 3000, diasGarantia: 30 },
    { descripcion: "Funda iPhone 13", cantidad: 1, precioUnitario: 5000, subtotal: 5000, diasGarantia: 0 },
  ],
  subtotal: 8000,
  descuento: 500,
  total: 7500,
  metodoPago: "EFECTIVO",
  nombreEmpresa: "Taller Test",
  telefonoEmpresa: "1144556677",
  direccionEmpresa: "Av. Siempre Viva 123",
}

// Pinned bytes captured from generateTicketCommands BEFORE logo support was
// added (see PR that introduced TicketData.logoRaster). When logoRaster is
// absent, the emitted byte stream must stay byte-identical to this baseline
// — no silent format changes for the printers already in the field.
const BASELINE_58_B64 =
  "G0AbdBMbYQEbRQEbITBUYWxsZXIgVGVzdAobIQAbRQBUZWw6IDExNDQ1NTY2NzcKQXYuIFNpZW1wcmUgVml2YSAxMjMKPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0KG0UBGyEwVkVOVEEgIzAwNDIKGyEAG0UAMDEvMDcvMjAyNiAxMDozMAotLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLQpDbGllbnRlOiAgICAgICAgICAgICAgSnVhbiBQZXJlegpUZWw6ICAgICAgICAgICAgICAgICAgMTEyMjMzNDQ1NQpWZW5kZWRvcjogICAgICAgICAgICBNYXJpYSBHb21legotLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLQobRQFQUk9EVUNUTyAgICAgICAgICAgICAgICAgICBUT1RBTAobRQAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLQobRQFDYWJsZSBVU0ItQwobRQAgMiB4ICQxLjUwMCAgICAgICAgICAgICAgICQzLjAwMAogR2FyYW50aWE6IDMwIGRpYXMKG0UBRnVuZGEgaVBob25lIDEzChtFACAxIHggJDUuMDAwICAgICAgICAgICAgICAgJDUuMDAwCj09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09ClN1YnRvdGFsOiAgICAgICAgICAgICAgICAgJDguMDAwCkRlc2N1ZW50bzogICAgICAgICAgICAgICAgIC0kNTAwChtFARshMFRPVEFMOiAgICAkNy41MDAKGyEAG0UALS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0KUGFnbzogICAgICAgICAgICAgICAgICAgRWZlY3Rpdm8KPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0KG2EBG0UBR3JhY2lhcyBwb3Igc3UgY29tcHJhIQobRQBDb25zZXJ2ZSBlc3RlIHRpY2tldApjb21vIGNvbXByb2JhbnRlCh1WQQM="
const BASELINE_80_B64 =
  "G0AbdBMbYQEbRQEbITBUYWxsZXIgVGVzdAobIQAbRQBUZWw6IDExNDQ1NTY2NzcKQXYuIFNpZW1wcmUgVml2YSAxMjMKPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09ChtFARshMFZFTlRBICMwMDQyChshABtFADAxLzA3LzIwMjYgMTA6MzAKLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tCkNsaWVudGU6ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgSnVhbiBQZXJlegpUZWw6ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDExMjIzMzQ0NTUKVmVuZGVkb3I6ICAgICAgICAgICAgICAgICAgICAgICAgICAgIE1hcmlhIEdvbWV6Ci0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLQobRQFQUk9EVUNUTyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgVE9UQUwKG0UALS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tChtFAUNhYmxlIFVTQi1DChtFACAyIHggJDEuNTAwICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICQzLjAwMAogR2FyYW50aWE6IDMwIGRpYXMKG0UBRnVuZGEgaVBob25lIDEzChtFACAxIHggJDUuMDAwICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICQ1LjAwMAo9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0KU3VidG90YWw6ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJDguMDAwCkRlc2N1ZW50bzogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAtJDUwMAobRQEbITBUT1RBTDogICAgICAgICAgICAkNy41MDAKGyEAG0UALS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tClBhZ286ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBFZmVjdGl2bwo9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0KG2EBG0UBR3JhY2lhcyBwb3Igc3UgY29tcHJhIQobRQBDb25zZXJ2ZSBlc3RlIHRpY2tldApjb21vIGNvbXByb2JhbnRlCh1WQQM="

describe("generateTicketCommands — logo", () => {
  it("sin logoRaster, el stream de bytes es identico al baseline pre-logo (58mm)", () => {
    const bytes = generateTicketCommands(baseData, 58)
    expect(Buffer.from(bytes).toString("base64")).toBe(BASELINE_58_B64)
  })

  it("sin logoRaster, el stream de bytes es identico al baseline pre-logo (80mm)", () => {
    const bytes = generateTicketCommands(baseData, 80)
    expect(Buffer.from(bytes).toString("base64")).toBe(BASELINE_80_B64)
  })

  it("con logoRaster: null explicito, tambien es identico al baseline (no agrega bytes vacios)", () => {
    const bytes = generateTicketCommands({ ...baseData, logoRaster: null }, 58)
    expect(Buffer.from(bytes).toString("base64")).toBe(BASELINE_58_B64)
  })

  it("con logoRaster presente, los bytes del comando GS v 0 aparecen antes del header", () => {
    // GS v 0: 0x1d 0x76 0x30 0x00, seguido de xL xH yL yH y los bytes del raster.
    const logoRaster = new Uint8Array([0x1d, 0x76, 0x30, 0x00, 0x01, 0x00, 0x01, 0x00, 0xff])
    const bytes = generateTicketCommands({ ...baseData, logoRaster }, 58)
    const arr = Array.from(bytes)

    const raster = Array.from(logoRaster)
    const rasterIdx = findSubarray(arr, raster)
    expect(rasterIdx).toBeGreaterThanOrEqual(0)

    const headerText = Array.from(Buffer.from("Taller Test", "latin1"))
    const headerIdx = findSubarray(arr, headerText)
    expect(headerIdx).toBeGreaterThan(rasterIdx)
  })

  it("sin logoRaster, el comando GS v 0 no aparece en el stream", () => {
    const bytes = generateTicketCommands(baseData, 58)
    const arr = Array.from(bytes)
    const gsRasterCmd = [0x1d, 0x76, 0x30]
    expect(findSubarray(arr, gsRasterCmd)).toBe(-1)
  })
})

describe("generateTicketCommands — campos existentes del ticket", () => {
  it("imprime empresa, telefono y direccion en el header", () => {
    const text = decode(generateTicketCommands(baseData, 58))
    expect(text).toContain("Taller Test")
    expect(text).toContain("Tel: 1144556677")
    expect(text).toContain("Av. Siempre Viva 123")
  })

  it("imprime numero de venta, fecha, cliente y vendedor", () => {
    const text = decode(generateTicketCommands(baseData, 58))
    expect(text).toContain("VENTA #0042")
    expect(text).toContain("01/07/2026 10:30")
    expect(text).toMatch(/Cliente:\s+Juan Perez/)
    expect(text).toMatch(/Tel:\s+1122334455/)
    expect(text).toMatch(/Vendedor:\s+Maria Gomez/)
  })

  it("lista los items con cantidad, precio unitario y subtotal", () => {
    const text = decode(generateTicketCommands(baseData, 58))
    expect(text).toContain("Cable USB-C")
    expect(text).toMatch(/2 x \$1\.500\s+\$3\.000/)
    expect(text).toContain("Garantia: 30 dias")
    expect(text).toContain("Funda iPhone 13")
    expect(text).toMatch(/1 x \$5\.000\s+\$5\.000/)
  })

  it("imprime subtotal, descuento y total", () => {
    const text = decode(generateTicketCommands(baseData, 58))
    expect(text).toMatch(/Subtotal:\s+\$8\.000/)
    expect(text).toMatch(/Descuento:\s+-\$500/)
    expect(text).toMatch(/TOTAL:\s+\$7\.500/)
  })

  it("traduce el metodo de pago a su etiqueta", () => {
    const text = decode(generateTicketCommands(baseData, 58))
    expect(text).toMatch(/Pago:\s+Efectivo/)
  })

  it("usa 'Consumidor Final' cuando no hay nombre de cliente", () => {
    const text = decode(
      generateTicketCommands({ ...baseData, cliente: { nombre: "", telefono: null } }, 58),
    )
    expect(text).toContain("Consumidor Final")
  })
})

function findSubarray(haystack: number[], needle: number[]): number {
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer
    }
    return i
  }
  return -1
}
