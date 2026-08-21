import { describe, it, expect, vi, beforeEach } from "vitest"
import { buildPayload, tusFacturasProvider } from "@/lib/facturacion/tusfacturas-provider"
import type { FacturacionCredenciales, EmitirInput } from "@/lib/facturacion/types"

const creds: FacturacionCredenciales = { apitoken: "a", apikey: "k", usertoken: "u", puntoVenta: 3, condicionFiscal: "MONOTRIBUTO" }
const input: EmitirInput = {
  ventaId: "v1", moneda: "PES", total: 1210,
  receptor: { razonSocial: "Consumidor Final", documentoTipo: "CONSUMIDOR FINAL", documentoNro: "0", condicionIva: "CF" },
  items: [{ cantidad: 1, descripcion: "Servicio", importeUnitario: 1210, alicuotaIva: 21 }],
}

describe("buildPayload", () => {
  it("includes auth, external_reference and Factura C for monotributo", () => {
    const p = buildPayload(creds, input, "C")
    expect(p.apitoken).toBe("a"); expect(p.apikey).toBe("k"); expect(p.usertoken).toBe("u")
    expect(p.comprobante.tipo).toBe("FACTURA C")
    expect(p.comprobante.external_reference).toBe("v1")
    expect(p.comprobante.punto_venta).toBe("3")
    expect(p.comprobante.detalle).toHaveLength(1)
  })

  it("rounds money fields to 2 decimals avoiding float artifacts", () => {
    const fractionalInput: EmitirInput = {
      ...input,
      items: [{ cantidad: 3, descripcion: "Servicio", importeUnitario: 0.1, alicuotaIva: 21 }],
    }
    const p = buildPayload(creds, fractionalInput, "C")
    expect(p.comprobante.detalle[0].importe).toBe("0.30")
    expect(p.comprobante.detalle[0].producto.precio_unitario_sin_iva).toBe("0.10")
  })
})

describe("tusFacturasProvider.emitir", () => {
  beforeEach(() => { vi.unstubAllGlobals() })
  it("maps a success response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: async () => ({
      error: "N", errores: [], cae: "123", vencimiento_cae: "2026-08-01",
      comprobante_nro: "0003-00000001", comprobante_pdf_url: "http://pdf", afip_qr: "qr",
    }) }))
    const r = await tusFacturasProvider.emitir(creds, input)
    expect(r.ok).toBe(true); expect(r.tipo).toBe("C"); expect(r.cae).toBe("123")
    expect(r.numero).toBe("0003-00000001"); expect(r.pdfUrl).toBe("http://pdf")
  })
  it("maps a rejection", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: async () => ({ error: "S", errores: ["CUIT inválido"] }) }))
    const r = await tusFacturasProvider.emitir(creds, input)
    expect(r.ok).toBe(false); expect(r.errores).toContain("CUIT inválido")
  })
  it("returns ok:false with errores when the network request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")))
    const r = await tusFacturasProvider.emitir(creds, input)
    expect(r.ok).toBe(false)
    expect(r.errores).toBeDefined()
    expect(r.errores!.length).toBeGreaterThan(0)
  })
})
