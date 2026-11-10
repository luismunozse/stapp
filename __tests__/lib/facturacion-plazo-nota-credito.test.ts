// @vitest-environment node
/**
 * RG 4540: la nota de crédito se emite dentro de los 15 días corridos de la
 * factura. El sistema solo AVISA (nunca bloquea), y cuenta los días con fechas
 * argentinas: un servidor en UTC no puede adelantar ni atrasar el día del taller.
 */
import { describe, it, expect } from "vitest"

import {
  PLAZO_NOTA_CREDITO_DIAS,
  diasDesdeEmision,
  diasDesdeFactura,
  excedePlazoNotaCredito,
} from "@/lib/facturacion/plazo-nota-credito"

// Mediodía en Argentina del 20/10/2026 (15:00 UTC): no cerca de ninguna frontera.
const HOY = new Date("2026-10-20T15:00:00Z")

describe("PLAZO_NOTA_CREDITO_DIAS", () => {
  it("es el plazo de la RG 4540: 15 días corridos", () => {
    expect(PLAZO_NOTA_CREDITO_DIAS).toBe(15)
  })
})

describe("diasDesdeEmision", () => {
  it("cuenta días corridos entre la fecha de emisión y hoy", () => {
    expect(diasDesdeEmision("2026-10-20", HOY)).toBe(0)
    expect(diasDesdeEmision("2026-10-19", HOY)).toBe(1)
    expect(diasDesdeEmision("2026-10-05", HOY)).toBe(15)
    expect(diasDesdeEmision("2026-10-04", HOY)).toBe(16)
    expect(diasDesdeEmision("2026-09-10", HOY)).toBe(40)
  })

  it("cruza el fin de mes y de año sin errores", () => {
    expect(diasDesdeEmision("2026-09-30", HOY)).toBe(20)
    expect(diasDesdeEmision("2025-12-31", new Date("2026-01-02T15:00:00Z"))).toBe(2)
  })

  it("acepta la fecha como la entrega ARCA (AAAAMMDD)", () => {
    expect(diasDesdeEmision("20261005", HOY)).toBe(15)
  })

  it("acepta un timestamp ISO y mira solo el día", () => {
    expect(diasDesdeEmision("2026-10-05T23:59:59.000Z", HOY)).toBe(15)
  })

  it("hoy es el día de ARGENTINA, no el de UTC: a las 02:30 UTC todavía es el día anterior", () => {
    const madrugadaUtc = new Date("2026-10-20T02:30:00Z") // 23:30 del 19/10 en Buenos Aires
    expect(diasDesdeEmision("2026-10-04", madrugadaUtc)).toBe(15)
    expect(diasDesdeEmision("2026-10-19", madrugadaUtc)).toBe(0)
  })

  it("pasadas las 03:00 UTC ya es el día siguiente en Argentina", () => {
    const amanecerUtc = new Date("2026-10-20T03:00:00Z") // 00:00 del 20/10 en Buenos Aires
    expect(diasDesdeEmision("2026-10-04", amanecerUtc)).toBe(16)
  })

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["vacío", ""],
    ["texto cualquiera", "ayer"],
    ["mes imposible", "2026-13-01"],
    ["día imposible", "2026-02-30"],
    ["AAAAMMDD imposible", "20261340"],
  ])("devuelve null cuando la fecha no se puede leer (%s)", (_titulo, entrada) => {
    expect(diasDesdeEmision(entrada as string | null | undefined, HOY)).toBeNull()
  })

  it("una fecha futura da un número negativo, no un plazo vencido", () => {
    expect(diasDesdeEmision("2026-10-25", HOY)).toBe(-5)
  })
})

describe("diasDesdeFactura", () => {
  it("usa la fecha de emisión de la factura cuando se puede leer", () => {
    expect(diasDesdeFactura({ fechaEmision: "2026-10-05", createdAt: "2026-01-01T12:00:00Z" }, HOY)).toBe(15)
    expect(diasDesdeFactura({ fechaEmision: "2026-10-04", createdAt: "2026-10-19T12:00:00Z" }, HOY)).toBe(16)
  })

  it("en una factura vieja sin fecha usa el día en que se creó", () => {
    expect(diasDesdeFactura({ fechaEmision: null, createdAt: "2026-10-05T15:00:00Z" }, HOY)).toBe(15)
    expect(diasDesdeFactura({ fechaEmision: "", createdAt: "2026-10-04T15:00:00Z" }, HOY)).toBe(16)
  })

  it("la creación se pasa al día de ARGENTINA: a la 01:00 UTC todavía es el día anterior", () => {
    // 01:00 UTC del 05/10 = 22:00 del 04/10 en Buenos Aires: son 16 días, no 15.
    expect(diasDesdeFactura({ fechaEmision: null, createdAt: "2026-10-05T01:00:00Z" }, HOY)).toBe(16)
    // 03:00 UTC del 05/10 = 00:00 del 05/10 en Buenos Aires: 15 días.
    expect(diasDesdeFactura({ fechaEmision: null, createdAt: "2026-10-05T03:00:00Z" }, HOY)).toBe(15)
  })

  it("cuenta hasta el 'hoy' que recibe, no hasta el reloj de la máquina", () => {
    const otroHoy = new Date("2026-11-30T15:00:00Z")
    expect(diasDesdeFactura({ fechaEmision: "2026-11-15", createdAt: null }, otroHoy)).toBe(15)
    expect(diasDesdeFactura({ fechaEmision: null, createdAt: "2026-11-14T15:00:00Z" }, otroHoy)).toBe(16)
  })

  it("también cuando la fecha de emisión no se puede leer", () => {
    expect(diasDesdeFactura({ fechaEmision: "ayer", createdAt: "2026-10-05T15:00:00Z" }, HOY)).toBe(15)
  })

  it.each([
    ["sin ninguna de las dos", { fechaEmision: null, createdAt: null }],
    ["con una creación ilegible", { fechaEmision: null, createdAt: "no es una fecha" }],
    ["con una creación vacía", { fechaEmision: undefined, createdAt: "" }],
  ])("devuelve null %s: no se afirma que venció", (_titulo, factura) => {
    expect(diasDesdeFactura(factura, HOY)).toBeNull()
  })
})

describe("excedePlazoNotaCredito", () => {
  it("el día 15 todavía está en plazo y el 16 ya no", () => {
    expect(excedePlazoNotaCredito(15)).toBe(false)
    expect(excedePlazoNotaCredito(16)).toBe(true)
  })

  it("una factura de hoy, de ayer o con fecha futura está en plazo", () => {
    expect(excedePlazoNotaCredito(0)).toBe(false)
    expect(excedePlazoNotaCredito(1)).toBe(false)
    expect(excedePlazoNotaCredito(-5)).toBe(false)
  })

  it("sin fecha legible no se afirma que venció", () => {
    expect(excedePlazoNotaCredito(null)).toBe(false)
  })

  it("una factura de 40 días excede el plazo", () => {
    expect(excedePlazoNotaCredito(40)).toBe(true)
  })
})
