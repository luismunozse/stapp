// __tests__/lib/facturacion-comprobante-asociado.test.ts
/**
 * Pure helpers behind the credit note PDF: the text of the synthetic detail
 * line, and the emission date of a LEGACY invoice (rows from before the fiscal
 * snapshot have no fecha_emision, but ARCA's authorization answer was stored).
 */
import { describe, it, expect } from "vitest"
import { descripcionAnulacion, fechaDeRespuestaEmision } from "@/lib/facturacion/comprobante-asociado"

describe("descripcionAnulacion", () => {
  it("is the single line printed when a credit note has no detail", () => {
    expect(descripcionAnulacion("B", "0003-00000001")).toBe("Anulación de la factura B 0003-00000001")
    expect(descripcionAnulacion("C", "0002-00000007")).toBe("Anulación de la factura C 0002-00000007")
  })
})

describe("fechaDeRespuestaEmision", () => {
  const respuesta = (det: unknown) => ({ FeCabResp: { Resultado: "A" }, FeDetResp: { FECAEDetResponse: det } })

  it("reads CbteFch from the first FECAEDetResponse and returns an ISO date", () => {
    expect(fechaDeRespuestaEmision(respuesta([{ Resultado: "A", CbteFch: "20261015" }]))).toBe("2026-10-15")
    expect(fechaDeRespuestaEmision(respuesta([{ Resultado: "A", CbteFch: "20260301" }]))).toBe("2026-03-01")
  })

  it("accepts the SDK answering a single object instead of a list", () => {
    expect(fechaDeRespuestaEmision(respuesta({ Resultado: "A", CbteFch: "20261016" }))).toBe("2026-10-16")
  })

  it("accepts CbteFch as a number", () => {
    expect(fechaDeRespuestaEmision(respuesta([{ CbteFch: 20261019 }]))).toBe("2026-10-19")
  })

  it("uses the first entry only", () => {
    expect(fechaDeRespuestaEmision(respuesta([{ CbteFch: "20261015" }, { CbteFch: "20261020" }]))).toBe("2026-10-15")
  })

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a string", "20261015"],
    ["a number", 20261015],
    ["an empty object", {}],
    ["no FeDetResp", { FeCabResp: {} }],
    ["an empty list", respuesta([])],
    ["no CbteFch", respuesta([{ Resultado: "A" }])],
    ["empty CbteFch", respuesta([{ CbteFch: "" }])],
    ["a short CbteFch", respuesta([{ CbteFch: "2026101" }])],
    ["a long CbteFch", respuesta([{ CbteFch: "202610150" }])],
    ["a CbteFch with a prefix", respuesta([{ CbteFch: "x20261015" }])],
    ["a dashed CbteFch", respuesta([{ CbteFch: "2026-10-15" }])],
    ["a letters CbteFch", respuesta([{ CbteFch: "2026ABCD" }])],
    ["month 13", respuesta([{ CbteFch: "20261315" }])],
    ["month 00", respuesta([{ CbteFch: "20260015" }])],
    ["day 00", respuesta([{ CbteFch: "20261000" }])],
    ["day 32", respuesta([{ CbteFch: "20261032" }])],
    ["a non-object entry", respuesta(["20261015"])],
  ])("returns null for %s", (_nombre, raw) => {
    expect(fechaDeRespuestaEmision(raw)).toBeNull()
  })
})
