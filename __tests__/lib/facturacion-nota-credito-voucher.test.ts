// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest"
import { Voucher } from "@arcasdk/core"

import {
  buildNotaCreditoVoucher,
  detalleNotaCredito,
  inferirAlicuotaIva,
  type FacturaOriginal,
} from "@/lib/facturacion/arca/nota-credito-voucher"
import { ErrorDeNegocioFacturacion } from "@/lib/facturacion/errores"
import type { ConsultaResult } from "@/lib/facturacion/types"

// CUIT de prueba de la documentación de ARCA. Este repo es público: ningún CUIT
// ni dato de cliente real entra a un fixture.
const CUIT_EMISOR = "20111111112"

// 2026-10-20 12:00 hora argentina.
const AHORA = new Date("2026-10-20T15:00:00.000Z")

const opciones = { puntoVenta: 3, cuitEmisor: CUIT_EMISOR, now: AHORA }

const facturaB: FacturaOriginal = {
  tipo: "B",
  cbteTipo: 6,
  numero: "0003-00000001",
  cuitEmisor: CUIT_EMISOR,
  receptorDocTipoCod: 99,
  receptorDocNroCod: "0",
  receptorCondicionIva: "CF",
  // Legado pre-#516: las líneas suman 1000 pero ARCA autorizó 1210.
  detalle: [{ cantidad: 1, descripcion: "Cambio de pantalla", importeUnitario: 1000, importe: 1000, alicuotaIva: 21 }],
}

const consultaB: ConsultaResult = {
  existe: true,
  cae: "70000000000001",
  caeVencimiento: "20261025",
  resultado: "A",
  cbteFch: "20261015",
  concepto: 1,
  docTipo: 99,
  docNro: "0",
  impTotal: 1210,
  impNeto: 1000,
  impIva: 210,
  impTrib: 0,
  impOpEx: 0,
  impTotConc: 0,
  moneda: "PES",
  cotizacion: 1,
}

/** Fila legada sin detalle: la alícuota solo se puede inferir de los importes. */
const facturaBSinDetalle: FacturaOriginal = { ...facturaB, detalle: null }

const facturaC: FacturaOriginal = {
  ...facturaB,
  tipo: "C",
  cbteTipo: 11,
  numero: "0002-00000007",
}

const consultaC: ConsultaResult = { ...consultaB, impTotal: 1000, impNeto: 1000, impIva: 0 }

/** Una consulta B con otros importes: neto + IVA = total. */
const consultaBCon = (impNeto: number, impIva: number, impTotal: number): ConsultaResult => ({
  ...consultaB,
  impNeto,
  impIva,
  impTotal,
})

function mensajeDeError(fn: () => unknown): { esNegocio: boolean; message: string } {
  try {
    fn()
  } catch (e) {
    return { esNegocio: e instanceof ErrorDeNegocioFacturacion, message: (e as Error).message }
  }
  throw new Error("se esperaba que lanzara")
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("buildNotaCreditoVoucher — Factura B", () => {
  it("1210 / 1000 / 210: NC B (8) con las mismas cifras, alícuota 21% inferida y CbtesAsoc de la factura", () => {
    const { voucher } = buildNotaCreditoVoucher(facturaB, consultaB, opciones)

    expect(voucher).toEqual({
      CantReg: 1,
      PtoVta: 3,
      CbteTipo: 8,
      Concepto: 1,
      DocTipo: 99,
      DocNro: 0,
      CbteFch: "20261020",
      ImpTotal: 1210,
      ImpTotConc: 0,
      ImpNeto: 1000,
      ImpOpEx: 0,
      ImpIVA: 210,
      ImpTrib: 0,
      MonId: "PES",
      MonCotiz: 1,
      CondicionIVAReceptorId: 5,
      CbtesAsoc: [{ Tipo: 6, PtoVta: 3, Nro: 1, Cuit: CUIT_EMISOR, CbteFch: "20261015" }],
      Iva: [{ Id: 5, BaseImp: 1000, Importe: 210 }],
    })
  })

  it("121 / 100 / 21: mismo 21%, otra escala", () => {
    const { voucher } = buildNotaCreditoVoucher(facturaB, consultaBCon(100, 21, 121), opciones)

    expect(voucher.ImpTotal).toBe(121)
    expect(voucher.ImpNeto).toBe(100)
    expect(voucher.ImpIVA).toBe(21)
    expect(voucher.Iva).toEqual([{ Id: 5, BaseImp: 100, Importe: 21 }])
  })

  it("10,5%: infiere el Id 4", () => {
    const { voucher } = buildNotaCreditoVoucher(facturaBSinDetalle, consultaBCon(1000, 105, 1105), opciones)

    expect(voucher.Iva).toEqual([{ Id: 4, BaseImp: 1000, Importe: 105 }])
    expect(voucher.ImpTotal).toBe(1105)
  })

  it("0% (exento): Id 3 con Importe 0, igual que la factura emitida con alícuota 0", () => {
    const { voucher } = buildNotaCreditoVoucher(facturaBSinDetalle, consultaBCon(500, 0, 500), opciones)

    expect(voucher.Iva).toEqual([{ Id: 3, BaseImp: 500, Importe: 0 }])
    expect(voucher.ImpIVA).toBe(0)
    expect(voucher.ImpNeto).toBe(500)
  })

  it("centavos: 826,45 + 173,55 = 1000 cierra y se infiere 21% sin ruido de coma flotante", () => {
    const { voucher } = buildNotaCreditoVoucher(
      facturaB,
      consultaBCon(826.4500000000001, 173.54999999999998, 1000),
      opciones
    )

    expect(voucher.ImpNeto).toBe(826.45)
    expect(voucher.ImpIVA).toBe(173.55)
    expect(voucher.Iva).toEqual([{ Id: 5, BaseImp: 826.45, Importe: 173.55 }])
  })

  it("tolera el redondeo de un centavo entre IVA y neto x alícuota", () => {
    const { voucher } = buildNotaCreditoVoucher(facturaB, consultaBCon(100, 21.01, 121.01), opciones)

    expect(voucher.Iva).toEqual([{ Id: 5, BaseImp: 100, Importe: 21.01 }])
  })

  it("la letra sale de la factura original: B original = NC 8, sin importar el punto de venta de las credenciales", () => {
    const { voucher } = buildNotaCreditoVoucher(facturaB, consultaB, { ...opciones, puntoVenta: 5 })

    expect(voucher.CbteTipo).toBe(8)
    expect(voucher.PtoVta).toBe(5)
    // La factura sigue siendo la del punto de venta 3.
    expect(voucher.CbtesAsoc?.[0].PtoVta).toBe(3)
  })
})

describe("buildNotaCreditoVoucher — Factura C", () => {
  it("NC C (13): sin array Iva, ImpIVA 0, ImpNeto = ImpTotal y CbtesAsoc.Tipo 11", () => {
    const { voucher } = buildNotaCreditoVoucher(facturaC, consultaC, opciones)

    expect(voucher.CbteTipo).toBe(13)
    expect(voucher.ImpTotal).toBe(1000)
    expect(voucher.ImpNeto).toBe(1000)
    expect(voucher.ImpIVA).toBe(0)
    expect(voucher).not.toHaveProperty("Iva")
    expect(voucher.CbtesAsoc).toEqual([{ Tipo: 11, PtoVta: 2, Nro: 7, Cuit: CUIT_EMISOR, CbteFch: "20261015" }])
  })

  it("una C cuya consulta trae IVA no se anula: ARCA rechazaría la NC", () => {
    const r = mensajeDeError(() => buildNotaCreditoVoucher(facturaC, { ...consultaC, impNeto: 826.45, impIva: 173.55 }, opciones))

    expect(r.esNegocio).toBe(true)
    expect(r.message).toMatch(/Factura C/)
  })

  it("una C cuyo neto no es el total no se anula", () => {
    const r = mensajeDeError(() => buildNotaCreditoVoucher(facturaC, { ...consultaC, impNeto: 900 }, opciones))

    expect(r.esNegocio).toBe(true)
  })
})

describe("buildNotaCreditoVoucher — alícuota que no se puede inferir", () => {
  it("una relación IVA / neto que no es ninguna alícuota de ARCA es un error de negocio y no manda nada", () => {
    const r = mensajeDeError(() => buildNotaCreditoVoucher(facturaB, consultaBCon(1000, 150, 1150), opciones))

    expect(r.esNegocio).toBe(true)
    expect(r.message).toMatch(/alícuota/i)
  })

  it("dos centavos de diferencia ya no es redondeo: error", () => {
    const r = mensajeDeError(() => buildNotaCreditoVoucher(facturaB, consultaBCon(100, 21.02, 121.02), opciones))

    expect(r.esNegocio).toBe(true)
  })

  it("importes tan chicos que varias alícuotas encajan: ambigua, error", () => {
    const r = mensajeDeError(() => buildNotaCreditoVoucher(facturaBSinDetalle, consultaBCon(0.1, 0.01, 0.11), opciones))

    expect(r.esNegocio).toBe(true)
    expect(r.message).toMatch(/alícuota/i)
  })
})

describe("inferirAlicuotaIva", () => {
  it("devuelve la alícuota en porcentaje que encaja con neto e IVA", () => {
    expect(inferirAlicuotaIva(1000, 210)).toBe(21)
    expect(inferirAlicuotaIva(1000, 105)).toBe(10.5)
    expect(inferirAlicuotaIva(1000, 270)).toBe(27)
    expect(inferirAlicuotaIva(1000, 50)).toBe(5)
    expect(inferirAlicuotaIva(1000, 25)).toBe(2.5)
    expect(inferirAlicuotaIva(1000, 0)).toBe(0)
  })

  it("lanza un error de negocio si ninguna encaja", () => {
    expect(() => inferirAlicuotaIva(1000, 123)).toThrow(ErrorDeNegocioFacturacion)
  })
})

describe("buildNotaCreditoVoucher — cifras que no se pueden anular automáticamente", () => {
  it("el comprobante no existe en ARCA", () => {
    const r = mensajeDeError(() => buildNotaCreditoVoucher(facturaB, { existe: false }, opciones))

    expect(r.esNegocio).toBe(true)
  })

  it("concepto 2 (servicios): solo se anulan facturas de productos", () => {
    const r = mensajeDeError(() => buildNotaCreditoVoucher(facturaB, { ...consultaB, concepto: 2 }, opciones))

    expect(r.esNegocio).toBe(true)
    expect(r.message).toMatch(/productos/i)
  })

  it("tributos, operaciones exentas o no gravados distintos de cero: error propio, no se descartan en silencio", () => {
    // Con el total ajustado (neto + IVA + extra) la regla de la suma no lo atrapa: lo atrapa esta.
    const conTrib = mensajeDeError(() => buildNotaCreditoVoucher(facturaB, { ...consultaB, impTrib: 10 }, opciones))
    const conOpEx = mensajeDeError(() => buildNotaCreditoVoucher(facturaB, { ...consultaB, impOpEx: 10 }, opciones))
    const conTotConc = mensajeDeError(() => buildNotaCreditoVoucher(facturaB, { ...consultaB, impTotConc: 10 }, opciones))
    const conTotalCerrado = mensajeDeError(() =>
      buildNotaCreditoVoucher(facturaB, { ...consultaB, impTrib: 10, impTotal: 1220 }, opciones)
    )

    for (const r of [conTrib, conOpEx, conTotConc, conTotalCerrado]) {
      expect(r.esNegocio).toBe(true)
      expect(r.message).toMatch(/tributos/i)
    }
  })

  it("neto + IVA tiene que ser el total", () => {
    const r = mensajeDeError(() => buildNotaCreditoVoucher(facturaB, { ...consultaB, impTotal: 1211 }, opciones))

    expect(r.esNegocio).toBe(true)
    expect(r.message).toMatch(/no cierran/)
  })

  it("sin total, o con total cero o negativo, no hay nada que anular", () => {
    expect(mensajeDeError(() => buildNotaCreditoVoucher(facturaB, { ...consultaB, impTotal: undefined }, opciones)).esNegocio).toBe(true)
    expect(mensajeDeError(() => buildNotaCreditoVoucher(facturaB, consultaBCon(0, 0, 0), opciones)).esNegocio).toBe(true)
    expect(mensajeDeError(() => buildNotaCreditoVoucher(facturaB, consultaBCon(-1000, -210, -1210), opciones)).esNegocio).toBe(true)
  })

  it("ARCA no informó la moneda o la cotización: no se inventa PES", () => {
    expect(mensajeDeError(() => buildNotaCreditoVoucher(facturaB, { ...consultaB, moneda: undefined }, opciones)).esNegocio).toBe(true)
    expect(mensajeDeError(() => buildNotaCreditoVoucher(facturaB, { ...consultaB, cotizacion: undefined }, opciones)).esNegocio).toBe(true)
  })

  it("copia moneda y cotización de lo que ARCA autorizó", () => {
    const { voucher } = buildNotaCreditoVoucher(facturaB, { ...consultaB, moneda: "DOL", cotizacion: 1050.5 }, opciones)

    expect(voucher.MonId).toBe("DOL")
    expect(voucher.MonCotiz).toBe(1050.5)
  })
})

describe("buildNotaCreditoVoucher — receptor", () => {
  it("consumidor final: 99 / 0 / condición 5", () => {
    const { voucher } = buildNotaCreditoVoucher(facturaB, consultaB, opciones)

    expect(voucher.DocTipo).toBe(99)
    expect(voucher.DocNro).toBe(0)
    expect(voucher.CondicionIVAReceptorId).toBe(5)
  })

  it("DNI: 96 con su número y la condición que guardó la factura", () => {
    const { voucher } = buildNotaCreditoVoucher(
      { ...facturaB, receptorDocTipoCod: 96, receptorDocNroCod: "27123456", receptorCondicionIva: "MONOTRIBUTO" },
      { ...consultaB, docTipo: 96, docNro: "27123456" },
      opciones
    )

    expect(voucher.DocTipo).toBe(96)
    expect(voucher.DocNro).toBe(27123456)
    expect(voucher.CondicionIVAReceptorId).toBe(6)
  })

  it("el documento sale de ARCA aunque la fila legada no lo tenga", () => {
    const { voucher } = buildNotaCreditoVoucher(
      { ...facturaB, receptorDocTipoCod: null, receptorDocNroCod: null },
      { ...consultaB, docTipo: 96, docNro: "27123456" },
      opciones
    )

    expect(voucher.DocTipo).toBe(96)
    expect(voucher.DocNro).toBe(27123456)
  })

  it("si el documento de la fila no coincide con el de ARCA, error: no se anula contra otro receptor", () => {
    const tipo = mensajeDeError(() => buildNotaCreditoVoucher({ ...facturaB, receptorDocTipoCod: 96 }, consultaB, opciones))
    const nro = mensajeDeError(() =>
      buildNotaCreditoVoucher({ ...facturaB, receptorDocNroCod: "27123456" }, consultaB, opciones)
    )

    expect(tipo.esNegocio).toBe(true)
    expect(nro.esNegocio).toBe(true)
    expect(nro.message).toMatch(/receptor|documento/i)
  })

  it("compara el número sin ceros a la izquierda ni separadores", () => {
    const { voucher } = buildNotaCreditoVoucher(
      { ...facturaB, receptorDocTipoCod: 96, receptorDocNroCod: "027.123.456" },
      { ...consultaB, docTipo: 96, docNro: "27123456" },
      opciones
    )

    expect(voucher.DocNro).toBe(27123456)
  })

  it("consumidor final sin condición guardada es condición 5", () => {
    const { voucher } = buildNotaCreditoVoucher({ ...facturaB, receptorCondicionIva: null }, consultaB, opciones)

    expect(voucher.CondicionIVAReceptorId).toBe(5)
  })

  it("un receptor identificado cuya condición de IVA no se puede determinar: error, nada se manda", () => {
    const r = mensajeDeError(() =>
      buildNotaCreditoVoucher(
        { ...facturaB, receptorDocTipoCod: 96, receptorDocNroCod: "27123456", receptorCondicionIva: null },
        { ...consultaB, docTipo: 96, docNro: "27123456" },
        opciones
      )
    )

    expect(r.esNegocio).toBe(true)
    expect(r.message).toMatch(/condición/i)
  })

  it("ARCA no informó el tipo de documento: error", () => {
    const r = mensajeDeError(() => buildNotaCreditoVoucher(facturaB, { ...consultaB, docTipo: undefined }, opciones))

    expect(r.esNegocio).toBe(true)
  })
})

describe("buildNotaCreditoVoucher — CbtesAsoc", () => {
  it("parte PPPP-NNNNNNNN en punto de venta y número", () => {
    const { voucher } = buildNotaCreditoVoucher({ ...facturaB, numero: "0012-00004567" }, consultaB, opciones)

    expect(voucher.CbtesAsoc?.[0]).toMatchObject({ Tipo: 6, PtoVta: 12, Nro: 4567 })
  })

  it("el CUIT es un string de 11 dígitos y CbteFch la fecha de la factura en AAAAMMDD", () => {
    const { voucher } = buildNotaCreditoVoucher(facturaB, { ...consultaB, cbteFch: "20260101" }, opciones)

    expect(voucher.CbtesAsoc).toHaveLength(1)
    expect(voucher.CbtesAsoc?.[0].Cuit).toBe(CUIT_EMISOR)
    expect(voucher.CbtesAsoc?.[0].Cuit).toMatch(/^\d{11}$/)
    expect(voucher.CbtesAsoc?.[0].CbteFch).toBe("20260101")
  })

  it("una fila legada sin cuit_emisor usa el de las credenciales, normalizado a dígitos", () => {
    const { voucher } = buildNotaCreditoVoucher(
      { ...facturaB, cuitEmisor: null },
      consultaB,
      { ...opciones, cuitEmisor: "20-11111111-2" }
    )

    expect(voucher.CbtesAsoc?.[0].Cuit).toBe(CUIT_EMISOR)
  })

  it("el CUIT de la factura distinto del de las credenciales: error, la NC la emitiría otro contribuyente", () => {
    const r = mensajeDeError(() =>
      buildNotaCreditoVoucher({ ...facturaB, cuitEmisor: "23111111119" }, consultaB, opciones)
    )

    expect(r.esNegocio).toBe(true)
    expect(r.message).toMatch(/CUIT/)
  })

  it("un CUIT que no tiene 11 dígitos es un error", () => {
    const r = mensajeDeError(() =>
      buildNotaCreditoVoucher({ ...facturaB, cuitEmisor: null }, consultaB, { ...opciones, cuitEmisor: "1234" })
    )

    expect(r.esNegocio).toBe(true)
  })

  it("un número de factura ilegible es un error", () => {
    expect(mensajeDeError(() => buildNotaCreditoVoucher({ ...facturaB, numero: "1" }, consultaB, opciones)).esNegocio).toBe(true)
    expect(mensajeDeError(() => buildNotaCreditoVoucher({ ...facturaB, numero: "0003-00000000" }, consultaB, opciones)).esNegocio).toBe(true)
  })

  it("la fecha de la factura que devolvió ARCA tiene que ser AAAAMMDD", () => {
    expect(mensajeDeError(() => buildNotaCreditoVoucher(facturaB, { ...consultaB, cbteFch: "2026-10-15" }, opciones)).esNegocio).toBe(true)
    expect(mensajeDeError(() => buildNotaCreditoVoucher(facturaB, { ...consultaB, cbteFch: undefined }, opciones)).esNegocio).toBe(true)
  })

  it("un cbte_tipo guardado que contradice la letra es un error", () => {
    const r = mensajeDeError(() => buildNotaCreditoVoucher({ ...facturaB, cbteTipo: 11 }, consultaB, opciones))

    expect(r.esNegocio).toBe(true)
  })

  it("una fila legada con cbte_tipo NULL usa el de su letra", () => {
    const b = buildNotaCreditoVoucher({ ...facturaB, cbteTipo: null }, consultaB, opciones).voucher
    const c = buildNotaCreditoVoucher({ ...facturaC, cbteTipo: null }, consultaC, opciones).voucher

    expect(b.CbtesAsoc?.[0].Tipo).toBe(6)
    expect(c.CbtesAsoc?.[0].Tipo).toBe(11)
  })
})

describe("buildNotaCreditoVoucher — fecha del comprobante", () => {
  it("es el día de hoy en Argentina, no el de UTC", () => {
    // 2026-10-21 01:30 UTC = 2026-10-20 22:30 en Buenos Aires.
    const noche = buildNotaCreditoVoucher(facturaB, consultaB, { ...opciones, now: new Date("2026-10-21T01:30:00.000Z") })
    // 2026-10-21 03:00 UTC = 2026-10-21 00:00 en Buenos Aires.
    const medianoche = buildNotaCreditoVoucher(facturaB, consultaB, { ...opciones, now: new Date("2026-10-21T03:00:00.000Z") })

    expect(noche.voucher.CbteFch).toBe("20261020")
    expect(medianoche.voucher.CbteFch).toBe("20261021")
  })
})

describe("detalleNotaCredito", () => {
  const ctxB = { tipo: "B" as const, numero: "0003-00000001", impTotal: 1000, alicuota: 21 }

  it("copia las líneas de la factura cuando suman exactamente el total de la NC", () => {
    const lineas = [
      { cantidad: 2, descripcion: "Cable", importeUnitario: 250, importe: 500, alicuotaIva: 21 },
      { cantidad: 1, descripcion: "Funda", importeUnitario: 500, importe: 500, alicuotaIva: 21 },
    ]

    expect(detalleNotaCredito(lineas, ctxB)).toEqual(lineas)
  })

  it("si las líneas no suman el total autorizado: UNA línea sintética por el total", () => {
    const detalle = detalleNotaCredito(
      [{ cantidad: 1, descripcion: "Cambio de pantalla", importeUnitario: 1000, importe: 1000, alicuotaIva: 21 }],
      { ...ctxB, impTotal: 1210 }
    )

    expect(detalle).toEqual([
      {
        cantidad: 1,
        descripcion: "Anulación de la factura B 0003-00000001",
        importeUnitario: 1210,
        importe: 1210,
        alicuotaIva: 21,
      },
    ])
  })

  it("sin detalle (fila legada) o con un detalle ilegible: línea sintética", () => {
    const esperado = [
      {
        cantidad: 1,
        descripcion: "Anulación de la factura C 0002-00000007",
        importeUnitario: 1000,
        importe: 1000,
        alicuotaIva: 0,
      },
    ]
    const ctxC = { tipo: "C" as const, numero: "0002-00000007", impTotal: 1000, alicuota: 0 }

    expect(detalleNotaCredito(null, ctxC)).toEqual(esperado)
    expect(detalleNotaCredito([], ctxC)).toEqual(esperado)
    expect(detalleNotaCredito("basura", ctxC)).toEqual(esperado)
    expect(detalleNotaCredito([{ cantidad: "x", descripcion: "A" }], ctxC)).toEqual(esperado)
  })

  it("una línea sin importe se calcula con importeUnitario x cantidad, y la suma se compara al centavo", () => {
    const detalle = detalleNotaCredito(
      [{ cantidad: 3, descripcion: "Cable", importeUnitario: 333.33, alicuotaIva: 21 }],
      { ...ctxB, impTotal: 999.99 }
    )

    expect(detalle).toEqual([{ cantidad: 3, descripcion: "Cable", importeUnitario: 333.33, importe: 999.99, alicuotaIva: 21 }])
  })

  it("las líneas copiadas son una copia: no comparten referencia con el detalle original", () => {
    const original = [{ cantidad: 1, descripcion: "A", importeUnitario: 1000, importe: 1000, alicuotaIva: 21 }]
    const copia = detalleNotaCredito(original, ctxB)

    expect(copia).toEqual(original)
    expect(copia[0]).not.toBe(original[0])
  })
})

describe("buildNotaCreditoVoucher — detalle", () => {
  it("devuelve el detalle a persistir en la NC: sintético si el legado no suma lo autorizado", () => {
    const { detalle } = buildNotaCreditoVoucher(facturaB, consultaB, opciones)

    expect(detalle).toEqual([
      {
        cantidad: 1,
        descripcion: "Anulación de la factura B 0003-00000001",
        importeUnitario: 1210,
        importe: 1210,
        alicuotaIva: 21,
      },
    ])
  })

  it("copia el detalle de la factura cuando suma el total autorizado", () => {
    const lineas = [{ cantidad: 1, descripcion: "Pantalla", importeUnitario: 1210, importe: 1210, alicuotaIva: 21 }]
    const { detalle } = buildNotaCreditoVoucher({ ...facturaB, detalle: lineas }, consultaB, opciones)

    expect(detalle).toEqual(lineas)
  })
})

describe("buildNotaCreditoVoucher — validación previa del SDK", () => {
  it("el voucher de una NC B y de una NC C pasan Voucher.create una vez numerados", () => {
    const b = buildNotaCreditoVoucher(facturaB, consultaB, opciones).voucher
    const c = buildNotaCreditoVoucher(facturaC, consultaC, opciones).voucher

    expect(() => Voucher.create({ ...b, CbteDesde: 5, CbteHasta: 5 })).not.toThrow()
    expect(() => Voucher.create({ ...c, CbteDesde: 5, CbteHasta: 5 })).not.toThrow()
  })

  it("el armado corre esa validación: si el SDK la rechaza, el error sale del armado y es de negocio", () => {
    const create = vi.spyOn(Voucher, "create").mockImplementation(() => {
      throw new Error("validación del SDK")
    })

    const r = mensajeDeError(() => buildNotaCreditoVoucher(facturaB, consultaB, opciones))

    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0][0]).toMatchObject({ CbteTipo: 8, ImpTotal: 1210, CbteDesde: 1, CbteHasta: 1 })
    expect(r.esNegocio).toBe(true)
    expect(r.message).toContain("validación del SDK")
  })
})

describe("buildNotaCreditoVoucher — alícuota según el detalle de la factura", () => {
  const linea = (alicuotaIva: number, importe = 1000) => ({
    cantidad: 1,
    descripcion: "Ítem",
    importeUnitario: importe,
    importe,
    alicuotaIva,
  })

  it("1000 al 21% + 1000 al 0%: dos alícuotas, no se anula automáticamente (un solo Iva[] de 21% autorizaría otro IVA)", () => {
    const original: FacturaOriginal = { ...facturaB, detalle: [linea(21), linea(0)] }
    // Neto 2000, IVA 210: encaja con 10,5% por inferencia, pero la factura tenía dos alícuotas.
    const r = mensajeDeError(() => buildNotaCreditoVoucher(original, consultaBCon(2000, 210, 2210), opciones))

    expect(r.esNegocio).toBe(true)
    expect(r.message).toMatch(/más de una alícuota/i)
  })

  it("dos alícuotas en el detalle son error aunque el IVA total encajara con una sola", () => {
    const original: FacturaOriginal = { ...facturaB, detalle: [linea(21), linea(10.5)] }
    const r = mensajeDeError(() => buildNotaCreditoVoucher(original, consultaBCon(2000, 315, 2315), opciones))

    expect(r.esNegocio).toBe(true)
    expect(r.message).toMatch(/más de una alícuota/i)
  })

  it("varias líneas con la MISMA alícuota: se usa esa", () => {
    const original: FacturaOriginal = { ...facturaB, detalle: [linea(21, 400), linea(21, 600)] }
    const { voucher } = buildNotaCreditoVoucher(original, consultaB, opciones)

    expect(voucher.Iva).toEqual([{ Id: 5, BaseImp: 1000, Importe: 210 }])
  })

  it("una sola alícuota en el detalle que no concuerda con el IVA de ARCA: error de negocio", () => {
    // El detalle dice 21% pero ARCA autorizó 10,5% (neto 1000, IVA 105).
    const r = mensajeDeError(() => buildNotaCreditoVoucher(facturaB, consultaBCon(1000, 105, 1105), opciones))

    expect(r.esNegocio).toBe(true)
    expect(r.message).toMatch(/alícuota/i)
  })

  it("una sola alícuota en el detalle: tolera un centavo de redondeo contra ARCA", () => {
    const { voucher } = buildNotaCreditoVoucher(facturaB, consultaBCon(100, 21.01, 121.01), opciones)

    expect(voucher.Iva).toEqual([{ Id: 5, BaseImp: 100, Importe: 21.01 }])
  })

  it("una alícuota del detalle que ARCA no conoce (13%): error de negocio", () => {
    const original: FacturaOriginal = { ...facturaB, detalle: [linea(13)] }
    const r = mensajeDeError(() => buildNotaCreditoVoucher(original, consultaBCon(1000, 130, 1130), opciones))

    expect(r.esNegocio).toBe(true)
  })

  it("sin detalle: se infiere si UNA sola alícuota encaja (10,5%)", () => {
    const original: FacturaOriginal = { ...facturaB, detalle: null }
    const { voucher } = buildNotaCreditoVoucher(original, consultaBCon(1000, 105, 1105), opciones)

    expect(voucher.Iva).toEqual([{ Id: 4, BaseImp: 1000, Importe: 105 }])
  })

  it("sin detalle y con dos alícuotas que encajan dentro de la tolerancia: error de negocio", () => {
    const original: FacturaOriginal = { ...facturaB, detalle: null }
    const r = mensajeDeError(() => buildNotaCreditoVoucher(original, consultaBCon(0.1, 0.01, 0.11), opciones))

    expect(r.esNegocio).toBe(true)
    expect(r.message).toMatch(/ambigua/i)
  })

  it("un detalle ilegible o vacío cuenta como sin detalle (se infiere)", () => {
    for (const detalle of [[], "basura", [null], [{ cantidad: "x" }]]) {
      const original: FacturaOriginal = { ...facturaB, detalle }
      const { voucher } = buildNotaCreditoVoucher(original, consultaBCon(1000, 105, 1105), opciones)
      expect(voucher.Iva).toEqual([{ Id: 4, BaseImp: 1000, Importe: 105 }])
    }
  })
})
