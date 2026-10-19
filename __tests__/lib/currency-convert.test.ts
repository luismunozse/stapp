import { describe, it, expect } from "vitest"
import {
  MAX_DECIMALES_TIPO_CAMBIO,
  convertirALocal,
  validarTipoCambio,
  roundUnit,
  calcularTotalesMultimoneda,
  TipoCambioInvalidoError,
  PrecioOrigenInvalidoError,
} from "@/lib/currency/convert"
import type { EntradaTotalesMultimoneda } from "@/lib/currency/convert"
import { calcularTotalesVenta } from "@/lib/ventas/totales"
import casos from "@/fixtures/currency/conversion-cases.json"

describe("validarTipoCambio (REQ-1.6)", () => {
  it.each([1, 1300, 1300.5, 0.0001, "1300", "1300.25", 1300.123456, 99999999.999999, " 1300 ", ".5"])("accepts %s", (v) => {
    const r = validarTipoCambio(v)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.valor).toBe(Number(typeof v === "string" ? v.trim() : v))
  })

  it.each([0, -5, NaN, Infinity, -Infinity, "abc", "", "  ", null, undefined, {}, [], true, 1300.1234567, "1e3x", 1e8, 123456789, "1e3", "0x10", "0b11", "1_000", "Infinity", "100000000", "1,5"])(
    "rejects %s",
    (v) => {
      expect(validarTipoCambio(v as unknown).ok).toBe(false)
    }
  )

  it("allows at most 6 decimals", () => {
    expect(MAX_DECIMALES_TIPO_CAMBIO).toBe(6)
    expect(validarTipoCambio(0.000001).ok).toBe(true)
    expect(validarTipoCambio(0.0000001).ok).toBe(false)
  })

  it("explains the failure", () => {
    const r = validarTipoCambio(-5)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/mayor a 0/i)
  })
})

describe("roundUnit", () => {
  it("rounds to the nearest multiple, half up", () => {
    expect(roundUnit(14307, 100)).toBe(14300)
    expect(roundUnit(14350, 100)).toBe(14400)
    expect(roundUnit(14304, 10)).toBe(14300)
    expect(roundUnit(14305, 10)).toBe(14310)
  })

  it("falls back to cents when there is no unit", () => {
    expect(roundUnit(10.005, 0)).toBe(10.01)
    expect(roundUnit(10.123, 0)).toBe(10.12)
  })
})

describe("convertirALocal", () => {
  it("multiplies by the rate and rounds to the conversion unit", () => {
    expect(convertirALocal(10, 1300, 0)).toBe(13000)
    expect(convertirALocal(9.99, 1305.5, 10)).toBe(13040)
    expect(convertirALocal(9.99, 1305.5, 0)).toBe(13041.95)
  })

  it("refuses an invalid rate instead of producing NaN or 0", () => {
    expect(() => convertirALocal(10, 0, 0)).toThrow(TipoCambioInvalidoError)
    expect(() => convertirALocal(10, NaN, 0)).toThrow(TipoCambioInvalidoError)
    expect(() => convertirALocal(10, -1, 0)).toThrow(TipoCambioInvalidoError)
  })
})

describe("calcularTotalesMultimoneda: order roundUnit -> recargo -> discounts -> IVA -> redondeo_efectivo", () => {
  it.each(casos.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const r = calcularTotalesMultimoneda({
      ...(c.input as Omit<EntradaTotalesMultimoneda, "lineas">),
      lineas: c.input.lineas.map((l) => ({ ...l, moneda: (l as { moneda?: "USD" }).moneda ?? null })),
    })
    expect(r.lineas.map((l) => l.precioUnitario)).toEqual(c.expected.precioUnitarioLocal)
    expect(r.totales.subtotal).toBe(c.expected.subtotal)
    expect(r.totales.total).toBe(c.expected.total)
    expect(r.totales.redondeo).toBe(c.expected.redondeo)
  })

  it("applies percentage discounts after the surcharge on the converted price", () => {
    const r = calcularTotalesMultimoneda({
      lineas: [
        { cantidad: 1, precioUnitario: 0, moneda: "USD", precioOrigen: 100, tipoDescuento: "PORCENTAJE", porcentajeDescuento: 10 },
      ],
      tipoCambio: 1300,
      redondeoConversion: 0,
      factor: 1.1,
    })
    // 130000 -> 143000 with surcharge -> 10% off = 128700
    expect(r.totales.total).toBe(128700)
  })

  it("keeps the origin amount and rate on each converted line", () => {
    const r = calcularTotalesMultimoneda({
      lineas: [{ cantidad: 3, precioUnitario: 0, moneda: "USD", precioOrigen: 20 }],
      tipoCambio: 1300,
    })
    expect(r.lineas[0]).toMatchObject({
      precioUnitario: 26000,
      moneda: "USD",
      precioOrigen: 20,
      tipoCambio: 1300,
    })
  })

  it("flag-off identity: without USD lines it equals calcularTotalesVenta, even with a garbage rate", () => {
    const lineas = [
      { cantidad: 2, precioUnitario: 1234.56 },
      { cantidad: 1, precioUnitario: 99.99, tipoDescuento: "MONTO" as const, descuento: 9.99 },
    ]
    const fiscal = { regimen: "ADITIVO" as const, tasa: 21, redondeoEfectivo: 10 }
    const esperado = calcularTotalesVenta(lineas, { tipo: "PORCENTAJE", valor: 5 }, fiscal, true, 1.03)
    const r = calcularTotalesMultimoneda({
      lineas,
      global: { tipo: "PORCENTAJE", valor: 5 },
      fiscal,
      roundCash: true,
      factor: 1.03,
      tipoCambio: NaN,
      redondeoConversion: 100,
    })
    expect(r.totales).toEqual(esperado)
    expect(r.lineas.every((l) => l.moneda === null && l.precioOrigen === null && l.tipoCambio === null)).toBe(true)
  })

  it("a USD line without a valid rate is blocked (S3.h)", () => {
    const input = { lineas: [{ cantidad: 1, precioUnitario: 0, moneda: "USD" as const, precioOrigen: 10 }] }
    expect(() => calcularTotalesMultimoneda({ ...input, tipoCambio: null })).toThrow(TipoCambioInvalidoError)
    expect(() => calcularTotalesMultimoneda({ ...input, tipoCambio: 0 })).toThrow(TipoCambioInvalidoError)
  })

  it.each([null, undefined, NaN, Infinity, -1, -0.01, "10"])(
    "a USD line with an invalid origin price (%s) is blocked, never priced at 0",
    (po) => {
      const input = {
        lineas: [{ cantidad: 1, precioUnitario: 0, moneda: "USD" as const, precioOrigen: po as number | null | undefined }],
        tipoCambio: 1300,
      }
      expect(() => calcularTotalesMultimoneda(input)).toThrow(PrecioOrigenInvalidoError)
    }
  )

  it("a USD line explicitly priced 0 is a legitimate free item", () => {
    const r = calcularTotalesMultimoneda({
      lineas: [{ cantidad: 1, precioUnitario: 0, moneda: "USD", precioOrigen: 0 }],
      tipoCambio: 1300,
    })
    expect(r.lineas[0]).toMatchObject({ precioUnitario: 0, precioOrigen: 0, moneda: "USD" })
  })

  it("a 0-decimal local currency (CLP) rounds converted prices to whole units by default", () => {
    const entrada = {
      lineas: [{ cantidad: 1, precioUnitario: 0, moneda: "USD" as const, precioOrigen: 10.5 }],
      tipoCambio: 950.5,
    }
    // 10.5 x 950.5 = 9980.25
    expect(calcularTotalesMultimoneda({ ...entrada, monedaLocal: "CLP" }).lineas[0].precioUnitario).toBe(9980)
    expect(calcularTotalesMultimoneda({ ...entrada, monedaLocal: "CLP", redondeoConversion: 0 }).lineas[0].precioUnitario).toBe(9980)
    expect(calcularTotalesMultimoneda({ ...entrada, monedaLocal: "ARS" }).lineas[0].precioUnitario).toBe(9980.25)
    expect(calcularTotalesMultimoneda(entrada).lineas[0].precioUnitario).toBe(9980.25)
    expect(calcularTotalesMultimoneda({ ...entrada, monedaLocal: "CLP", redondeoConversion: 100 }).lineas[0].precioUnitario).toBe(10000)
  })

  it("a line whose moneda equals the local currency is never converted", () => {
    const r = calcularTotalesMultimoneda({
      lineas: [{ cantidad: 2, precioUnitario: 50, moneda: "USD", precioOrigen: 50 }],
      monedaLocal: "USD",
      tipoCambio: null,
    })
    expect(r.lineas[0]).toMatchObject({ precioUnitario: 50, moneda: null, precioOrigen: null, tipoCambio: null })
    expect(r.totales.total).toBe(100)
  })

  it("a USD line in a USD-local org ignores even a garbage rate", () => {
    expect(() =>
      calcularTotalesMultimoneda({
        lineas: [{ cantidad: 1, precioUnitario: 10, moneda: "USD" }],
        monedaLocal: "USD",
        tipoCambio: NaN,
      })
    ).not.toThrow()
  })
})
