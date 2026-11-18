// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { ChipCotizacion } from "@/components/moneda/chip-cotizacion"
import { antiguedad } from "@/lib/currency/antiguedad"
import type { ResultadoTipoCambio } from "@/lib/currency/tipo-cambio"

const hace5min = () => new Date(Date.now() - 5 * 60_000).toISOString()

describe("ChipCotizacion", () => {
  it("sin datos o con la función apagada no muestra nada", () => {
    const { container, rerender } = render(<ChipCotizacion tipoCambio={undefined} monedaLocal="ARS" />)
    expect(container).toBeEmptyDOMElement()
    rerender(<ChipCotizacion tipoCambio={{ disponible: false, motivo: "DESHABILITADA" }} monedaLocal="ARS" />)
    expect(container).toBeEmptyDOMElement()
  })

  it("cotización viva: moneda, fuente, valor en moneda local y antigüedad", () => {
    const tc: ResultadoTipoCambio = {
      disponible: true, valor: 1200, fuente: "BLUE", moneda: "USD", en: hace5min(), estado: "vivo",
    }
    render(<ChipCotizacion tipoCambio={tc} monedaLocal="ARS" />)
    const chip = screen.getByRole("status")
    expect(chip).toHaveTextContent(/^USD Blue · \$\s1\.200,00 · hace 5 min$/)
    expect(chip.className).not.toMatch(/warning/)
  })

  it("cotización de referencia: estilo de advertencia", () => {
    const tc: ResultadoTipoCambio = {
      disponible: true, valor: 1150, fuente: "OFICIAL", moneda: "USD",
      en: new Date(Date.now() - 3 * 3_600_000).toISOString(), estado: "referencia",
    }
    render(<ChipCotizacion tipoCambio={tc} monedaLocal="ARS" />)
    const chip = screen.getByRole("status")
    expect(chip).toHaveTextContent("USD Oficial")
    expect(chip).toHaveTextContent("hace 3 h")
    expect(chip.className).toMatch(/warning/)
  })

  it("sin cotización: aviso con link a la configuración de moneda", () => {
    render(
      <ChipCotizacion tipoCambio={{ disponible: false, motivo: "SIN_COTIZACION" }} monedaLocal="ARS" monedaExtranjera="USD" />
    )
    expect(screen.getByText("Sin cotización de USD")).toBeInTheDocument()
    expect(screen.getByRole("link")).toHaveAttribute("href", "/configuracion?tab=moneda")
  })
})

describe("antiguedad", () => {
  const ahora = new Date("2026-11-13T12:00:00Z")
  it("instantes, minutos, horas y días", () => {
    expect(antiguedad("2026-11-13T11:59:40Z", ahora)).toBe("instantes")
    expect(antiguedad("2026-11-13T11:15:00Z", ahora)).toBe("45 min")
    expect(antiguedad("2026-11-13T07:00:00Z", ahora)).toBe("5 h")
    expect(antiguedad("2026-11-10T12:00:00Z", ahora)).toBe("3 d")
  })
  it("una fecha futura cuenta como instantes", () => {
    expect(antiguedad("2026-11-13T12:10:00Z", ahora)).toBe("instantes")
  })
})
