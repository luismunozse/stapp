import { describe, it, expect } from "vitest"
import { buildVoucher } from "@/lib/facturacion/arca/voucher"
import { mapVentaToEmitirInput } from "@/lib/facturacion/map-venta"
import type { ArcaCredenciales } from "@/lib/facturacion/types"

describe("mapVentaToEmitirInput", () => {
  it("defaults to consumidor final and maps items", () => {
    const venta = { id: "v1", total: 1210, iva_tasa: 21, cliente_nombre: "Juan" }
    const items = [{ cantidad: 1, descripcion: "Servicio", precio_unitario: 1210 }]
    const input = mapVentaToEmitirInput(venta, items)
    expect(input.ventaId).toBe("v1")
    expect(input.receptor.documentoTipo).toBe("CONSUMIDOR FINAL")
    expect(input.items[0].alicuotaIva).toBe(21)
    expect(input.total).toBe(1210)
  })

  it("preserves iva_tasa 0 (exento) instead of defaulting to 21", () => {
    const venta = { id: "v2", total: 100, iva_tasa: 0, cliente_nombre: "Juan" }
    const items = [{ cantidad: 1, descripcion: "Servicio", precio_unitario: 100 }]
    const input = mapVentaToEmitirInput(venta, items)
    expect(input.items[0].alicuotaIva).toBe(0)
  })

  it("defaults alicuotaIva to 21 when iva_tasa is missing", () => {
    const venta = { id: "v3", total: 100, cliente_nombre: "Juan" }
    const items = [{ cantidad: 1, descripcion: "Servicio", precio_unitario: 100 }]
    const input = mapVentaToEmitirInput(venta, items)
    expect(input.items[0].alicuotaIva).toBe(21)
  })

  it("defaults razonSocial to Consumidor Final when cliente_nombre is absent", () => {
    const venta = { id: "v4", total: 100, iva_tasa: 21 }
    const items = [{ cantidad: 1, descripcion: "Servicio", precio_unitario: 100 }]
    const input = mapVentaToEmitirInput(venta, items)
    expect(input.receptor.razonSocial).toBe("Consumidor Final")
  })

  it("maps an empty items array to an empty items list without throwing", () => {
    const venta = { id: "v5", total: 0, iva_tasa: 21 }
    const input = mapVentaToEmitirInput(venta, [])
    expect(input.items).toEqual([])
  })

  it("maps undefined items to an empty items list without throwing", () => {
    const venta = { id: "v6", total: 0, iva_tasa: 21 }
    const input = mapVentaToEmitirInput(venta, undefined as any)
    expect(input.items).toEqual([])
  })
})

/**
 * Importes: la factura tiene que valer lo que el cliente pagó (venta.total) al
 * centavo. Las líneas salen del precio guardado menos descuentos y se reparten
 * para sumar el total (descuento global, IVA aditivo y redondeo incluidos).
 */
const centavos = (n: number) => Math.round(n * 100)
const sumaLineas = (items: Array<{ importe?: number }>) =>
  items.reduce((acc, it) => acc + centavos(it.importe ?? NaN), 0)

describe("mapVentaToEmitirInput — importes de las líneas", () => {
  it("EXENTO sin descuento: la línea vale el precio y la alícuota cae en 21", () => {
    const venta = { id: "a", total: 1210, subtotal: 1210, descuento: 0, iva_regimen: null, iva_tasa: null }
    const items = [{ cantidad: 1, descripcion: "Pantalla", precio_unitario: 1210, descuento: 0 }]

    const input = mapVentaToEmitirInput(venta, items)

    expect(input.total).toBe(1210)
    expect(input.items).toHaveLength(1)
    expect(input.items[0].importe).toBe(1210)
    expect(input.items[0].alicuotaIva).toBe(21)
    expect(input.desgloseIva).toBeUndefined()
  })

  it("INCLUIDO: usa el neto y el IVA guardados en la venta", () => {
    const venta = {
      id: "b", total: 1210, subtotal: 1210, descuento: 0,
      iva_regimen: "INCLUIDO", iva_tasa: 21, iva_neto: 1000, iva_monto: 210, redondeo_monto: 0,
    }
    const items = [{ cantidad: 1, descripcion: "Pantalla", precio_unitario: 1210, descuento: 0 }]

    const input = mapVentaToEmitirInput(venta, items)

    expect(input.desgloseIva).toEqual({ neto: 1000, iva: 210, alicuota: 21 })
    expect(sumaLineas(input.items)).toBe(centavos(1210))
  })

  it("ADITIVO: el precio de lista es neto, así que la línea sube hasta el total con IVA", () => {
    const venta = {
      id: "c", total: 1210, subtotal: 1000, descuento: 0,
      iva_regimen: "ADITIVO", iva_tasa: 21, iva_neto: 1000, iva_monto: 210, redondeo_monto: 0,
    }
    const items = [{ cantidad: 2, descripcion: "Cable", precio_unitario: 500, descuento: 0 }]

    const input = mapVentaToEmitirInput(venta, items)

    expect(input.items[0].importe).toBe(1210)
    expect(input.items[0].importeUnitario).toBeCloseTo(605, 6)
    expect(input.desgloseIva).toEqual({ neto: 1000, iva: 210, alicuota: 21 })
  })

  it("descuento por línea en monto y en porcentaje", () => {
    const venta = { id: "d", total: 1400, subtotal: 2000, descuento: 600, iva_regimen: null, iva_tasa: null }
    const items = [
      { cantidad: 2, descripcion: "A", precio_unitario: 500, descuento: 100, tipo_descuento: "MONTO" },
      { cantidad: 1, descripcion: "B", precio_unitario: 1000, descuento: 0, tipo_descuento: "PORCENTAJE", porcentaje_descuento: 50 },
    ]

    const input = mapVentaToEmitirInput(venta, items)

    expect(input.items.map((i) => i.importe)).toEqual([900, 500])
    expect(sumaLineas(input.items)).toBe(centavos(1400))
  })

  it("descuento global: se prorratea entre las líneas", () => {
    const venta = { id: "e", total: 900, subtotal: 1000, descuento: 100, iva_regimen: null, iva_tasa: null }
    const items = [
      { cantidad: 1, descripcion: "A", precio_unitario: 600, descuento: 0 },
      { cantidad: 1, descripcion: "B", precio_unitario: 400, descuento: 0 },
    ]

    const input = mapVentaToEmitirInput(venta, items)

    expect(input.items.map((i) => i.importe)).toEqual([540, 360])
  })

  it("descuento por línea más global a la vez", () => {
    const venta = { id: "f", total: 900, subtotal: 1100, descuento: 200, iva_regimen: null, iva_tasa: null }
    const items = [
      { cantidad: 2, descripcion: "A", precio_unitario: 500, descuento: 100 },
      { cantidad: 1, descripcion: "B", precio_unitario: 100, descuento: 0 },
    ]

    const input = mapVentaToEmitirInput(venta, items)

    expect(input.items.map((i) => i.importe)).toEqual([810, 90])
  })

  it("redondeo de efectivo: las líneas suman el total al centavo y el resto va a la última", () => {
    const venta = { id: "g", total: 100, subtotal: 99.99, descuento: 0, redondeo_monto: 0.01, iva_regimen: null, iva_tasa: null }
    const items = [
      { cantidad: 1, descripcion: "A", precio_unitario: 33.33, descuento: 0 },
      { cantidad: 1, descripcion: "B", precio_unitario: 33.33, descuento: 0 },
      { cantidad: 1, descripcion: "C", precio_unitario: 33.33, descuento: 0 },
    ]

    const input = mapVentaToEmitirInput(venta, items)

    expect(input.items.map((i) => i.importe)).toEqual([33.33, 33.33, 33.34])
    expect(sumaLineas(input.items)).toBe(centavos(100))
  })

  it("ADITIVO con redondeo: el neto + IVA guardados ya no suman el total, así que no se usan", () => {
    const venta = {
      id: "h", total: 1215, subtotal: 1000, descuento: 0,
      iva_regimen: "ADITIVO", iva_tasa: 21, iva_neto: 1000, iva_monto: 210, redondeo_monto: 5,
    }
    const items = [{ cantidad: 1, descripcion: "A", precio_unitario: 1000, descuento: 0 }]

    const input = mapVentaToEmitirInput(venta, items)

    expect(input.desgloseIva).toBeUndefined()
    expect(input.items[0].importe).toBe(1215)
  })

  it("EXENTO con redondeo (iva_monto 0) no manda desglose: la factura B sí discrimina", () => {
    const venta = {
      id: "i", total: 1000, subtotal: 999.9, descuento: 0,
      iva_regimen: "EXENTO", iva_tasa: 21, iva_neto: 999.9, iva_monto: 0, redondeo_monto: 0.1,
    }
    const items = [{ cantidad: 1, descripcion: "A", precio_unitario: 999.9, descuento: 0 }]

    const input = mapVentaToEmitirInput(venta, items)

    expect(input.desgloseIva).toBeUndefined()
    expect(input.items[0].importe).toBe(1000)
  })

  it("alícuota 10.5 viaja en las líneas y en el desglose", () => {
    const venta = {
      id: "j", total: 1105, subtotal: 1105, descuento: 0,
      iva_regimen: "INCLUIDO", iva_tasa: 10.5, iva_neto: 1000, iva_monto: 105, redondeo_monto: 0,
    }
    const items = [{ cantidad: 1, descripcion: "A", precio_unitario: 1105, descuento: 0 }]

    const input = mapVentaToEmitirInput(venta, items)

    expect(input.items[0].alicuotaIva).toBe(10.5)
    expect(input.desgloseIva).toEqual({ neto: 1000, iva: 105, alicuota: 10.5 })
  })

  it("el remanente no cae en una última línea gratuita", () => {
    const venta = { id: "k", total: 100, subtotal: 99.99, descuento: 0, iva_regimen: null, iva_tasa: null }
    const items = [
      { cantidad: 1, descripcion: "A", precio_unitario: 33.33, descuento: 0 },
      { cantidad: 1, descripcion: "B", precio_unitario: 66.66, descuento: 0 },
      { cantidad: 1, descripcion: "Regalo", precio_unitario: 10, descuento: 10 },
    ]

    const input = mapVentaToEmitirInput(venta, items)

    expect(input.items.map((i) => i.importe)).toEqual([33.33, 66.67, 0])
    expect(sumaLineas(input.items)).toBe(centavos(100))
  })
})

describe("venta -> comprobante: lo autorizado es lo cobrado", () => {
  const creds = (condicionFiscal: ArcaCredenciales["condicionFiscal"]): ArcaCredenciales => ({
    organizationId: "org-1",
    cuit: "20111111112",
    certPem: "C",
    keyPem: "K",
    puntoVenta: 1,
    condicionFiscal,
    production: false,
  })

  const casos = [
    {
      nombre: "EXENTO con descuento global y redondeo",
      venta: { id: "x1", total: 1235, subtotal: 1300, descuento: 66.5, iva_regimen: null, iva_tasa: null, redondeo_monto: 1.5 },
      items: [
        { cantidad: 3, descripcion: "A", precio_unitario: 300, descuento: 0 },
        { cantidad: 1, descripcion: "B", precio_unitario: 400, descuento: 0 },
      ],
    },
    {
      nombre: "ADITIVO con descuento por línea",
      venta: { id: "x2", total: 1089, subtotal: 1000, descuento: 100, iva_regimen: "ADITIVO", iva_tasa: 21, iva_neto: 900, iva_monto: 189, redondeo_monto: 0 },
      items: [{ cantidad: 1, descripcion: "A", precio_unitario: 1000, descuento: 100 }],
    },
    {
      nombre: "INCLUIDO",
      venta: { id: "x3", total: 3333.33, subtotal: 3333.33, descuento: 0, iva_regimen: "INCLUIDO", iva_tasa: 21, iva_neto: 2754.82, iva_monto: 578.51, redondeo_monto: 0 },
      items: [
        { cantidad: 1, descripcion: "A", precio_unitario: 1111.11, descuento: 0 },
        { cantidad: 2, descripcion: "B", precio_unitario: 1111.11, descuento: 0 },
      ],
    },
  ]

  it.each(casos)("Factura B ($nombre): ImpTotal == venta.total y neto + IVA cierran", ({ venta, items }) => {
    const voucher = buildVoucher(creds("RESPONSABLE_INSCRIPTO"), mapVentaToEmitirInput(venta, items), { cbteFch: "20260829" })

    expect(voucher.ImpTotal).toBe(venta.total)
    expect(centavos(Number(voucher.ImpNeto) + Number(voucher.ImpIVA))).toBe(centavos(venta.total))
  })

  it.each(casos)("Factura C ($nombre): ImpTotal == ImpNeto == venta.total, sin IVA", ({ venta, items }) => {
    const voucher = buildVoucher(creds("MONOTRIBUTO"), mapVentaToEmitirInput(venta, items), { cbteFch: "20260829" })

    expect(voucher.ImpTotal).toBe(venta.total)
    expect(voucher.ImpNeto).toBe(venta.total)
    expect(voucher.ImpIVA).toBe(0)
  })
})
