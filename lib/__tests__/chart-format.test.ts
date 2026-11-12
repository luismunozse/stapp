import { describe, it, expect } from "vitest"
import { formatCompactCurrencyValue } from "@/lib/currency"
import { formatCompactCurrency } from "@/lib/utils"
import { CHART_CONCEPT_COLORS, CHART_SERIES, chartSeriesColor } from "@/lib/chart-colors"
import { FINANZAS_CONCEPTS } from "@/lib/finanzas-theme"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// Intl usa espacios duros (U+00A0 / U+202F) entre número y símbolo.
const plano = (s: string) => s.replace(/[  ]/g, " ")

describe("formatCompactCurrencyValue", () => {
  it("abrevia pesos con locale es-AR", () => {
    expect(plano(formatCompactCurrencyValue(1_500_000, "ARS"))).toBe("$1,5 M")
    expect(plano(formatCompactCurrencyValue(15_000, "ARS"))).toBe("$15 k")
    expect(plano(formatCompactCurrencyValue(950, "ARS"))).toBe("$ 950")
  })

  it("no inventa el '$1500k' de antes: más de mil miles pasa a millones", () => {
    const s = plano(formatCompactCurrency(1_500_000))
    expect(s).not.toMatch(/1500/)
    expect(s).toMatch(/M/)
  })

  it("respeta la moneda de la organización", () => {
    expect(plano(formatCompactCurrencyValue(1_500, "USD"))).toBe("$1.5K")
    expect(plano(formatCompactCurrencyValue(1_500, "EUR"))).toBe("1,5 mil €")
    // Sin moneda, ARS (la default de la app).
    expect(plano(formatCompactCurrency(2_000_000))).toBe("$2 M")
  })

  it("negativos y entradas vacías", () => {
    expect(plano(formatCompactCurrencyValue(-23_000, "ARS"))).toBe("-$23 k")
    expect(formatCompactCurrencyValue(null)).toBe("")
    expect(formatCompactCurrencyValue(undefined)).toBe("")
    expect(formatCompactCurrencyValue(Number.NaN)).toBe("")
    expect(formatCompactCurrencyValue("abc")).toBe("")
    expect(plano(formatCompactCurrencyValue("2500", "ARS"))).toBe("$2,5 K")
  })
})

describe("colores de gráficos", () => {
  it("las series salen de los tokens --chart-n y dan la vuelta", () => {
    expect(CHART_SERIES).toHaveLength(8)
    expect(chartSeriesColor(0)).toBe("hsl(var(--chart-1))")
    expect(chartSeriesColor(8)).toBe("hsl(var(--chart-1))")
    expect(chartSeriesColor(-1)).toBe("hsl(var(--chart-8))")
  })

  it("finanzas usa el mismo color por concepto que el resto (Costos naranja en todos lados)", () => {
    expect(FINANZAS_CONCEPTS.ingresos.color).toBe(CHART_CONCEPT_COLORS.ingresos)
    expect(FINANZAS_CONCEPTS.costos.color).toBe(CHART_CONCEPT_COLORS.costos)
    expect(FINANZAS_CONCEPTS.gastos.color).toBe(CHART_CONCEPT_COLORS.gastos)
    expect(FINANZAS_CONCEPTS.ganancia.color).toBe(CHART_CONCEPT_COLORS.ganancia)
  })

  it("cada token usado está definido en modo claro y oscuro", () => {
    const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8")
    const tokens = [...CHART_SERIES, ...Object.values(CHART_CONCEPT_COLORS)].map(
      (c) => /var\((--[a-z0-9-]+)\)/.exec(c)![1]
    )
    for (const token of tokens) {
      const definiciones = css.match(new RegExp(`^\\s*${token}:`, "gm")) ?? []
      expect(definiciones.length, token).toBe(2)
    }
  })
})
