import { describe, it, expect } from "vitest"

import { buildVoucher } from "@/lib/facturacion/arca/voucher"
import type { ArcaCredenciales, EmitirInput } from "@/lib/facturacion/types"

const credsMonotributo: ArcaCredenciales = {
  organizationId: "org-1",
  cuit: "23944498389",
  certPem: "CERT",
  keyPem: "KEY",
  puntoVenta: 1,
  condicionFiscal: "MONOTRIBUTO",
  production: false,
}

const inputConsumidorFinal: EmitirInput = {
  ventaId: "venta-1",
  moneda: "PES",
  total: 1000,
  receptor: {
    razonSocial: "Consumidor Final",
    documentoTipo: "CONSUMIDOR FINAL",
    documentoNro: "0",
    condicionIva: "CF",
  },
  items: [{ cantidad: 2, descripcion: "Cambio de pantalla", importeUnitario: 500, alicuotaIva: 21 }],
}

describe("buildVoucher — Factura C (monotributo)", () => {
  it("no discrimina IVA: ImpNeto es el total y ImpIVA queda en cero", () => {
    const voucher = buildVoucher(credsMonotributo, inputConsumidorFinal, { cbteFch: "20260829" })

    expect(voucher.CbteTipo).toBe(11)
    expect(voucher.ImpTotal).toBe(1000)
    expect(voucher.ImpNeto).toBe(1000)
    expect(voucher.ImpIVA).toBe(0)
    expect(voucher.Iva).toBeUndefined()
  })
})

describe("buildVoucher — Factura B (responsable inscripto)", () => {
  it("discrimina IVA: el neto sale de las líneas y el IVA va agrupado por alícuota", () => {
    const creds: ArcaCredenciales = { ...credsMonotributo, condicionFiscal: "RESPONSABLE_INSCRIPTO" }
    const input: EmitirInput = {
      ...inputConsumidorFinal,
      total: 1210,
      items: [{ cantidad: 2, descripcion: "Cambio de pantalla", importeUnitario: 500, alicuotaIva: 21 }],
    }

    const voucher = buildVoucher(creds, input, { cbteFch: "20260829" })

    expect(voucher.CbteTipo).toBe(6)
    expect(voucher.ImpNeto).toBe(1000)
    expect(voucher.ImpIVA).toBe(210)
    expect(voucher.ImpTotal).toBe(1210)
    expect(voucher.Iva).toEqual([{ Id: 5, BaseImp: 1000, Importe: 210 }])
  })

  it("agrupa las líneas por alícuota en vez de emitir una entrada por ítem", () => {
    const creds: ArcaCredenciales = { ...credsMonotributo, condicionFiscal: "RESPONSABLE_INSCRIPTO" }
    const input: EmitirInput = {
      ...inputConsumidorFinal,
      total: 1320.5,
      items: [
        { cantidad: 1, descripcion: "Repuesto", importeUnitario: 1000, alicuotaIva: 21 },
        { cantidad: 1, descripcion: "Servicio", importeUnitario: 100, alicuotaIva: 10.5 },
      ],
    }

    const voucher = buildVoucher(creds, input, { cbteFch: "20260829" })

    expect(voucher.Iva).toEqual([
      { Id: 5, BaseImp: 1000, Importe: 210 },
      { Id: 4, BaseImp: 100, Importe: 10.5 },
    ])
    expect(voucher.ImpNeto).toBe(1100)
    expect(voucher.ImpIVA).toBe(220.5)
  })

  /**
   * AFIP valida `ImpTotal = ImpNeto + ImpIVA + ImpTrib + ImpOpEx + ImpTotConc`
   * y rechaza el comprobante si no cierra. El total se recalcula desde las
   * líneas en vez de confiar en `input.total`.
   */
  it("recalcula ImpTotal desde las partes en vez de copiar input.total", () => {
    const creds: ArcaCredenciales = { ...credsMonotributo, condicionFiscal: "RESPONSABLE_INSCRIPTO" }
    const input: EmitirInput = {
      ...inputConsumidorFinal,
      total: 999, // incoherente con las líneas a propósito
      items: [{ cantidad: 1, descripcion: "Repuesto", importeUnitario: 1000, alicuotaIva: 21 }],
    }

    const voucher = buildVoucher(creds, input, { cbteFch: "20260829" })

    expect(voucher.ImpTotal).toBe(1210)
  })
})

describe("buildVoucher — receptor", () => {
  const conReceptor = (receptor: EmitirInput["receptor"]): EmitirInput => ({
    ...inputConsumidorFinal,
    receptor,
  })

  it("mapea consumidor final a DocTipo 99 / DocNro 0 / condición 5", () => {
    const voucher = buildVoucher(
      credsMonotributo,
      conReceptor({
        razonSocial: "Consumidor Final",
        documentoTipo: "CONSUMIDOR FINAL",
        documentoNro: "0",
        condicionIva: "CF",
      }),
      { cbteFch: "20260829" }
    )

    expect(voucher.DocTipo).toBe(99)
    expect(voucher.DocNro).toBe(0)
    expect(voucher.CondicionIVAReceptorId).toBe(5)
  })

  it("mapea un receptor con CUIT a DocTipo 80 y condición responsable inscripto", () => {
    const voucher = buildVoucher(
      credsMonotributo,
      conReceptor({
        razonSocial: "Taller SRL",
        documentoTipo: "CUIT",
        documentoNro: "30-71095505-7",
        condicionIva: "RI",
      }),
      { cbteFch: "20260829" }
    )

    expect(voucher.DocTipo).toBe(80)
    expect(voucher.DocNro).toBe(30710955057)
    expect(voucher.CondicionIVAReceptorId).toBe(1)
  })

  it("mapea DNI a DocTipo 96 y monotributo a condición 6", () => {
    const voucher = buildVoucher(
      credsMonotributo,
      conReceptor({
        razonSocial: "Juan Perez",
        documentoTipo: "DNI",
        documentoNro: "27.123.456",
        condicionIva: "MONOTRIBUTO",
      }),
      { cbteFch: "20260829" }
    )

    expect(voucher.DocTipo).toBe(96)
    expect(voucher.DocNro).toBe(27123456)
    expect(voucher.CondicionIVAReceptorId).toBe(6)
  })
})
