// __tests__/lib/facturacion-anulable.test.ts
/**
 * Row-local eligibility the comprobantes listing reports to the UI: can this
 * factura be annulled, can this credit note be verified. The listing cannot see
 * "another credit note is in flight" (that needs sibling rows), so the card
 * combines these flags with the rows of the venta.
 */
import { describe, it, expect } from "vitest"
import { esFacturaAnulable, esNotaCreditoVerificable } from "@/lib/facturacion/anulable"

const FACTURA = {
  tipo: "B",
  provider: "arca",
  estado: "emitido",
  numero: "0003-00000001",
  cae: "74123456789012",
  cbte_tipo: 6,
}

describe("esFacturaAnulable", () => {
  it("an emitted ARCA factura B with number and CAE is annullable", () => {
    expect(esFacturaAnulable(FACTURA)).toBe(true)
  })

  it("factura C and delegated ARCA are annullable too", () => {
    expect(esFacturaAnulable({ ...FACTURA, tipo: "C", cbte_tipo: 11 })).toBe(true)
    expect(esFacturaAnulable({ ...FACTURA, provider: "arca_delegado" })).toBe(true)
  })

  it("a legacy row without cbte_tipo is a factura", () => {
    expect(esFacturaAnulable({ ...FACTURA, cbte_tipo: null })).toBe(true)
    expect(esFacturaAnulable({ ...FACTURA, cbte_tipo: undefined })).toBe(true)
  })

  it.each(["pendiente", "rechazado", "anulado"])("estado %s is not annullable", (estado) => {
    expect(esFacturaAnulable({ ...FACTURA, estado })).toBe(false)
  })

  it.each(["tusfacturas", "", null, undefined])("provider %j is not annullable", (provider) => {
    expect(esFacturaAnulable({ ...FACTURA, provider })).toBe(false)
  })

  it("a credit note (8 or 13) is never annullable", () => {
    expect(esFacturaAnulable({ ...FACTURA, cbte_tipo: 8 })).toBe(false)
    expect(esFacturaAnulable({ ...FACTURA, tipo: "C", cbte_tipo: 13 })).toBe(false)
  })

  it.each(["A", "X", "", null, undefined])("tipo %j is not annullable (only B and C)", (tipo) => {
    expect(esFacturaAnulable({ ...FACTURA, tipo })).toBe(false)
  })

  it.each([null, undefined, "", "sin numero", "0000-00000000", "0003-"])("numero %j is not annullable", (numero) => {
    expect(esFacturaAnulable({ ...FACTURA, numero })).toBe(false)
  })

  it.each([null, undefined, ""])("cae %j is not annullable", (cae) => {
    expect(esFacturaAnulable({ ...FACTURA, cae })).toBe(false)
  })
})

describe("esNotaCreditoVerificable", () => {
  const NC = { cbte_tipo: 8, estado: "pendiente", cbte_nro_solicitado: 5 }

  it("a pending credit note with a requested number is verifiable", () => {
    expect(esNotaCreditoVerificable(NC)).toBe(true)
    expect(esNotaCreditoVerificable({ ...NC, cbte_tipo: 13 })).toBe(true)
  })

  it.each(["emitido", "rechazado", "anulado"])("estado %s is not verifiable", (estado) => {
    expect(esNotaCreditoVerificable({ ...NC, estado })).toBe(false)
  })

  it("a factura is never verifiable, even pending", () => {
    expect(esNotaCreditoVerificable({ ...NC, cbte_tipo: 6 })).toBe(false)
    expect(esNotaCreditoVerificable({ ...NC, cbte_tipo: null })).toBe(false)
  })

  it.each([null, undefined, 0, -1, 1.5, "5"])("requested number %j is not verifiable", (cbte_nro_solicitado) => {
    expect(esNotaCreditoVerificable({ ...NC, cbte_nro_solicitado: cbte_nro_solicitado as never })).toBe(false)
  })
})
