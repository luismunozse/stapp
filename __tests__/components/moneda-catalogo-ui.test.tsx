// __tests__/components/moneda-catalogo-ui.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"

const useMonedaMock = vi.hoisted(() => vi.fn())
vi.mock("@/hooks/use-moneda", () => ({ useMoneda: useMonedaMock }))
vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({
    formatPrice: (n: number) => `ARS ${n.toLocaleString("es-AR", { maximumFractionDigits: 2 })}`,
  }),
}))

import { SelectorMoneda } from "@/components/moneda/selector-moneda"
import { PrecioEnMoneda } from "@/components/moneda/precio-en-moneda"
import { EquivalenteLocal } from "@/components/moneda/equivalente-local"

const CONFIG = {
  monedaLocal: "ARS",
  monedaExtranjera: "USD",
  habilitada: true,
  fuentesDisponibles: ["MANUAL", "OFICIAL", "BLUE", "MEP"],
  fuente: "BLUE",
  tipoCambioManual: null,
  tipoCambioReferencia: null,
  referenciaEn: null,
  redondeoConversion: 10,
  aceptaUsdEfectivo: false,
  vueltoMonedaDefault: "LOCAL",
}
const vivo = {
  disponible: true,
  valor: 1200,
  fuente: "BLUE",
  moneda: "USD",
  en: new Date().toISOString(),
  estado: "vivo",
}

function setMoneda(config: object | undefined, tipoCambio: object | undefined = vivo) {
  useMonedaMock.mockReturnValue({
    config: config === undefined ? undefined : { ...CONFIG, ...config },
    tipoCambio,
  })
}

beforeEach(() => useMonedaMock.mockReset())

describe("SelectorMoneda", () => {
  it("no se muestra con la función apagada y moneda local", () => {
    setMoneda({ habilitada: false })
    const { container } = render(<SelectorMoneda value={null} onChange={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it("no se muestra mientras carga la config con moneda local", () => {
    setMoneda(undefined)
    const { container } = render(<SelectorMoneda value={null} onChange={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it("con la función apagada y USD muestra las dos opciones y la ayuda", () => {
    setMoneda({ habilitada: false })
    render(<SelectorMoneda value="USD" onChange={() => {}} />)
    expect(screen.getByLabelText("Moneda del precio")).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "ARS (local)" })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "USD" })).toBeInTheDocument()
    expect(screen.getByText("La moneda extranjera está deshabilitada: podés volver a moneda local.")).toBeInTheDocument()
  })

  it("onChange(null) al elegir local y onChange('USD') al elegir la divisa", () => {
    setMoneda({})
    const onChange = vi.fn()
    render(<SelectorMoneda value="USD" onChange={onChange} />)
    const select = screen.getByLabelText("Moneda del precio")
    fireEvent.change(select, { target: { value: "" } })
    expect(onChange).toHaveBeenLastCalledWith(null)
    fireEvent.change(select, { target: { value: "USD" } })
    expect(onChange).toHaveBeenLastCalledWith("USD")
  })
})

describe("PrecioEnMoneda", () => {
  it("local usa formatPrice y divisa el código", () => {
    setMoneda({})
    const { rerender } = render(<PrecioEnMoneda monto={1500} moneda={null} />)
    expect(screen.getByText("ARS 1.500")).toBeInTheDocument()
    rerender(<PrecioEnMoneda monto={50} moneda="USD" />)
    expect(screen.getByText(/50/)).toBeInTheDocument()
    expect(screen.queryByText("ARS 50")).not.toBeInTheDocument()
  })

  it("monto null muestra guion", () => {
    setMoneda({})
    render(<PrecioEnMoneda monto={null} moneda="USD" />)
    expect(screen.getByText("—")).toBeInTheDocument()
  })
})

describe("EquivalenteLocal", () => {
  it("con cotización viva muestra el equivalente", () => {
    setMoneda({})
    render(<EquivalenteLocal monto={50} moneda="USD" />)
    const el = screen.getByText(/hoy \(Blue, 1\.200\)/)
    expect(el.textContent).toContain("60.000")
  })

  it("con referencia indica hace cuánto", () => {
    setMoneda({}, { ...vivo, estado: "referencia", en: new Date(Date.now() - 3 * 3_600_000 - 60_000).toISOString() })
    render(<EquivalenteLocal monto={50} moneda="USD" />)
    expect(screen.getByText(/de hace 3 h/)).toBeInTheDocument()
  })

  it("sin cotización para esa moneda", () => {
    setMoneda({ monedaExtranjera: "EUR" })
    render(<EquivalenteLocal monto={50} moneda="USD" />)
    expect(screen.getByText("Sin cotización para USD")).toBeInTheDocument()
  })

  it("nada para local, monto null ni config cargando", () => {
    setMoneda({})
    const a = render(<EquivalenteLocal monto={50} moneda={null} />)
    expect(a.container).toBeEmptyDOMElement()
    const b = render(<EquivalenteLocal monto={null} moneda="USD" />)
    expect(b.container.textContent).toContain("Sin cotización")
    setMoneda(undefined)
    const c = render(<EquivalenteLocal monto={50} moneda="USD" />)
    expect(c.container).toBeEmptyDOMElement()
  })
})
