import { describe, it, expect } from "vitest"

import { buildVoucher } from "@/lib/facturacion/arca/voucher"
import type { ArcaCredenciales, EmitirInput } from "@/lib/facturacion/types"

const round2 = (n: number) => Math.round(n * 100) / 100

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

  it("ImpNeto es igual a ImpTotal aun con un total con decimales sucios", () => {
    const voucher = buildVoucher(credsMonotributo, { ...inputConsumidorFinal, total: 0.1 + 0.2 }, { cbteFch: "20260829" })

    expect(voucher.ImpTotal).toBe(0.3)
    expect(voucher.ImpNeto).toBe(voucher.ImpTotal)
  })
})

describe("buildVoucher — Factura B (responsable inscripto)", () => {
  const credsRI: ArcaCredenciales = { ...credsMonotributo, condicionFiscal: "RESPONSABLE_INSCRIPTO" }

  const inputB = (total: number, items: EmitirInput["items"], extra: Partial<EmitirInput> = {}): EmitirInput => ({
    ...inputConsumidorFinal,
    total,
    items,
    ...extra,
  })

  /**
   * Las líneas ya vienen con el IVA adentro (post-descuento, sumando el total
   * de la venta): el IVA se despeja del total, no se suma encima.
   */
  it("ImpTotal es el total de la venta y el IVA se despeja de él", () => {
    const voucher = buildVoucher(
      credsRI,
      inputB(1210, [{ cantidad: 2, descripcion: "Cambio de pantalla", importeUnitario: 605, importe: 1210, alicuotaIva: 21 }]),
      { cbteFch: "20260829" }
    )

    expect(voucher.CbteTipo).toBe(6)
    expect(voucher.ImpTotal).toBe(1210)
    expect(voucher.ImpNeto).toBe(1000)
    expect(voucher.ImpIVA).toBe(210)
    expect(voucher.Iva).toEqual([{ Id: 5, BaseImp: 1000, Importe: 210 }])
  })

  it("un total con descuento no se infla un 21%: 900 sigue siendo 900", () => {
    const voucher = buildVoucher(
      credsRI,
      inputB(900, [{ cantidad: 1, descripcion: "Repuesto", importeUnitario: 900, importe: 900, alicuotaIva: 21 }]),
      { cbteFch: "20260829" }
    )

    expect(voucher.ImpTotal).toBe(900)
    expect(voucher.ImpNeto).toBe(743.8) // 900 / 1.21 = 743,801...
    expect(voucher.ImpIVA).toBe(156.2)
    expect(voucher.Iva).toEqual([{ Id: 5, BaseImp: 743.8, Importe: 156.2 }])
  })

  it("agrupa las líneas por alícuota y el total sigue siendo el de la venta", () => {
    const voucher = buildVoucher(
      credsRI,
      inputB(1320.5, [
        { cantidad: 1, descripcion: "Repuesto", importeUnitario: 1210, importe: 1210, alicuotaIva: 21 },
        { cantidad: 1, descripcion: "Servicio", importeUnitario: 110.5, importe: 110.5, alicuotaIva: 10.5 },
      ]),
      { cbteFch: "20260829" }
    )

    expect(voucher.Iva).toEqual([
      { Id: 5, BaseImp: 1000, Importe: 210 },
      { Id: 4, BaseImp: 100, Importe: 10.5 },
    ])
    expect(voucher.ImpNeto).toBe(1100)
    expect(voucher.ImpIVA).toBe(220.5)
    expect(voucher.ImpTotal).toBe(1320.5)
  })

  it("input.total manda: nunca se recalcula por encima de lo cobrado", () => {
    const voucher = buildVoucher(
      credsRI,
      inputB(999, [{ cantidad: 1, descripcion: "Repuesto", importeUnitario: 1000, importe: 1000, alicuotaIva: 21 }]),
      { cbteFch: "20260829" }
    )

    expect(voucher.ImpTotal).toBe(999)
    expect(round2(Number(voucher.ImpNeto) + Number(voucher.ImpIVA))).toBe(999)
  })

  it("sin importe en la línea usa importeUnitario x cantidad", () => {
    const voucher = buildVoucher(
      credsRI,
      inputB(1210, [{ cantidad: 2, descripcion: "Cable", importeUnitario: 605, alicuotaIva: 21 }]),
      { cbteFch: "20260829" }
    )

    expect(voucher.ImpNeto).toBe(1000)
    expect(voucher.ImpIVA).toBe(210)
  })

  it("usa el neto y el IVA guardados en la venta cuando suman el total", () => {
    // 1.000,05 / 1,21 = 826,45 pero la venta guardó neto 826,44 + IVA 173,61
    const voucher = buildVoucher(
      credsRI,
      inputB(1000.05, [{ cantidad: 1, descripcion: "A", importeUnitario: 1000.05, importe: 1000.05, alicuotaIva: 21 }], {
        desgloseIva: { neto: 826.44, iva: 173.61, alicuota: 21 },
      }),
      { cbteFch: "20260829" }
    )

    expect(voucher.ImpNeto).toBe(826.44)
    expect(voucher.ImpIVA).toBe(173.61)
    expect(voucher.ImpTotal).toBe(1000.05)
    expect(voucher.Iva).toEqual([{ Id: 5, BaseImp: 826.44, Importe: 173.61 }])
  })

  it("ignora un desglose guardado que no suma el total", () => {
    const voucher = buildVoucher(
      credsRI,
      inputB(1215, [{ cantidad: 1, descripcion: "A", importeUnitario: 1215, importe: 1215, alicuotaIva: 21 }], {
        desgloseIva: { neto: 1000, iva: 210, alicuota: 21 },
      }),
      { cbteFch: "20260829" }
    )

    expect(voucher.ImpTotal).toBe(1215)
    expect(voucher.ImpNeto).toBe(1004.13)
    expect(voucher.ImpIVA).toBe(210.87)
  })

  it("una alícuota que ARCA no tiene mapeada tira un error claro en vez de mandar 21%", () => {
    expect(() =>
      buildVoucher(
        credsRI,
        inputB(1150, [{ cantidad: 1, descripcion: "A", importeUnitario: 1150, importe: 1150, alicuotaIva: 15 }]),
        { cbteFch: "20260829" }
      )
    ).toThrow("Alícuota de IVA no soportada por ARCA: 15%")
  })

  it("lo mismo cuando la alícuota viene en el desglose guardado", () => {
    expect(() =>
      buildVoucher(
        credsRI,
        inputB(1150, [{ cantidad: 1, descripcion: "A", importeUnitario: 1150, importe: 1150, alicuotaIva: 15 }], {
          desgloseIva: { neto: 1000, iva: 150, alicuota: 15 },
        }),
        { cbteFch: "20260829" }
      )
    ).toThrow("Alícuota de IVA no soportada por ARCA: 15%")
  })

  it("alícuota 0 (exento) no suma IVA", () => {
    const voucher = buildVoucher(
      credsRI,
      inputB(500, [{ cantidad: 1, descripcion: "Libro", importeUnitario: 500, importe: 500, alicuotaIva: 0 }]),
      { cbteFch: "20260829" }
    )

    expect(voucher.ImpTotal).toBe(500)
    expect(voucher.ImpNeto).toBe(500)
    expect(voucher.ImpIVA).toBe(0)
    expect(voucher.Iva).toEqual([{ Id: 3, BaseImp: 500, Importe: 0 }])
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
