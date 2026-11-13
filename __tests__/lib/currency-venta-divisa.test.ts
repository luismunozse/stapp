import { describe, it, expect } from "vitest"
import {
  aplicarCotizacionLineas,
  mensajeNoVendible,
  motivoNoVendible,
  resolverLineasDivisa,
  type ItemCatalogoVenta,
} from "@/lib/currency/venta-divisa"
import type { ConfigMoneda } from "@/lib/currency/config-moneda"
import type { ResultadoTipoCambio } from "@/lib/currency/tipo-cambio"

const config = {
  habilitada: true,
  monedaExtranjera: "USD",
  monedaLocal: "ARS",
  redondeoConversion: 10,
} as ConfigMoneda
const tc: ResultadoTipoCambio = {
  disponible: true,
  valor: 1200,
  fuente: "BLUE",
  moneda: "USD",
  en: "2026-11-13T00:00:00.000Z",
  estado: "vivo",
}
const sinTc: ResultadoTipoCambio = { disponible: false, motivo: "SIN_COTIZACION" }

function catalogo(precioCompra: number | null = 6.04) {
  return new Map<string, ItemCatalogoVenta>([
    ["a", { id: "a", nombre: "Local", moneda: null, precioVenta: 500, precioCompra: 100 }],
    ["u", { id: "u", nombre: "Funda", moneda: "USD", precioVenta: 10, precioCompra }],
  ])
}

describe("motivoNoVendible", () => {
  it("local es vendible", () => expect(motivoNoVendible(null, config, tc)).toBeNull())
  it("deshabilitada", () =>
    expect(motivoNoVendible("USD", { ...config, habilitada: false }, tc)).toBe("DESHABILITADA"))
  it("otra divisa", () => expect(motivoNoVendible("EUR", config, tc)).toBe("OTRA_DIVISA"))
  it("sin cotización", () => expect(motivoNoVendible("USD", config, sinTc)).toBe("SIN_COTIZACION"))
  it("config ausente", () => expect(motivoNoVendible("USD", undefined, tc)).toBe("DESHABILITADA"))
  it("vendible", () => expect(motivoNoVendible("USD", config, tc)).toBeNull())
})

describe("mensajeNoVendible", () => {
  it("textos", () => {
    const m = mensajeNoVendible("SIN_COTIZACION", "Funda", "USD")
    expect(m).toContain("Configuración → Operativa")
    expect(m).toContain('"Funda"')
    expect(mensajeNoVendible("DESHABILITADA", "Funda", "USD")).toBe(
      '"Funda" tiene precio en USD y la moneda extranjera está deshabilitada.'
    )
    expect(mensajeNoVendible("OTRA_DIVISA", "Funda", "EUR")).toBe(
      '"Funda" tiene precio en EUR, que ya no es la divisa de la organización.'
    )
  })
})

describe("resolverLineasDivisa", () => {
  it("convierte precio y costo", () => {
    const r = resolverLineasDivisa({
      lineas: [{ inventarioId: "a" }, { inventarioId: "u" }, { inventarioId: null }],
      catalogo: catalogo(),
      config,
      tc,
    })
    expect(r).toEqual({
      ok: true,
      lineas: [null, { moneda: "USD", precioOrigen: 10, precioLocal: 12000, costoLocal: 7250 }, null],
      tipoCambio: 1200,
    })
  })
  it("el precio del request gana y se redondea", () => {
    const r = resolverLineasDivisa({ lineas: [{ inventarioId: "u", precioOrigen: 12.346 }], catalogo: catalogo(), config, tc })
    expect(r.ok && r.lineas[0]).toMatchObject({ precioOrigen: 12.35, precioLocal: 14820 })
  })
  it.each([0, -3])("precio %s usa el del catálogo", (p) => {
    const r = resolverLineasDivisa({ lineas: [{ inventarioId: "u", precioOrigen: p }], catalogo: catalogo(), config, tc })
    expect(r.ok && r.lineas[0]?.precioOrigen).toBe(10)
  })
  it("precioCompra null", () => {
    const r = resolverLineasDivisa({ lineas: [{ inventarioId: "u" }], catalogo: catalogo(null), config, tc })
    expect(r.ok && r.lineas[0]?.costoLocal).toBeNull()
  })
  it("sin líneas en divisa, aun apagada", () => {
    const r = resolverLineasDivisa({
      lineas: [{ inventarioId: "a" }, { inventarioId: "zzz" }, {}],
      catalogo: catalogo(),
      config: { ...config, habilitada: false },
      tc: null,
    })
    expect(r).toEqual({ ok: true, lineas: [null, null, null], tipoCambio: null })
  })
  it("apagada con línea USD", () => {
    const r = resolverLineasDivisa({
      lineas: [{ inventarioId: "u" }],
      catalogo: catalogo(),
      config: { ...config, habilitada: false },
      tc,
    })
    expect(r).toMatchObject({ ok: false, motivo: "DESHABILITADA" })
    expect(!r.ok && r.mensaje).toContain("Funda")
  })
})

describe("aplicarCotizacionLineas", () => {
  it("recalcula solo las de divisa", () => {
    const local = { moneda: null, precioUnitario: 5 }
    const out = aplicarCotizacionLineas(
      [{ moneda: "USD" as const, precioOrigen: 10, precioUnitario: 1 }, local],
      1300,
      10
    )
    expect(out[0].precioUnitario).toBe(13000)
    expect(out[1]).toBe(local)
  })
})
