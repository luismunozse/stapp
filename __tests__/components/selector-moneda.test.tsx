/**
 * Currency selector of a catalog item: local or the organization's foreign currency, plus the item's
 * stored currency when the organization has switched to another one since.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { SelectorMoneda } from "@/components/moneda/selector-moneda"

const { useMonedaMock } = vi.hoisted(() => ({ useMonedaMock: vi.fn() }))
vi.mock("@/hooks/use-moneda", () => ({ useMoneda: useMonedaMock }))

const config = (extra: Record<string, unknown> = {}) => ({
  config: { monedaLocal: "ARS", monedaExtranjera: "EUR", habilitada: true, ...extra },
})

beforeEach(() => {
  vi.clearAllMocks()
  useMonedaMock.mockReturnValue(config())
})

describe("SelectorMoneda", () => {
  it("shows local and the organization's currency", () => {
    render(<SelectorMoneda value={null} onChange={vi.fn()} />)
    const opciones = screen.getAllByRole("option").map((o) => o.textContent)
    expect(opciones).toEqual(["ARS (local)", "EUR"])
  })

  it("an item still in USD after the organization switched to EUR shows USD, flagged", () => {
    render(<SelectorMoneda value="USD" onChange={vi.fn()} />)
    const select = screen.getByLabelText("Moneda del precio") as HTMLSelectElement
    expect(select.value).toBe("USD")
    expect(screen.getByRole("option", { name: "USD (ya no es la divisa de la organización)" })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "EUR" })).toBeInTheDocument()
  })

  it("choosing local from the stale currency fires a change to null", () => {
    const onChange = vi.fn()
    render(<SelectorMoneda value="USD" onChange={onChange} />)
    fireEvent.change(screen.getByLabelText("Moneda del precio"), { target: { value: "" } })
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it("the current foreign currency gets no extra option", () => {
    render(<SelectorMoneda value="EUR" onChange={vi.fn()} />)
    expect(screen.getAllByRole("option")).toHaveLength(2)
  })

  it("with the feature off a stale currency still shows (to move back to local)", () => {
    useMonedaMock.mockReturnValue(config({ habilitada: false }))
    render(<SelectorMoneda value="USD" onChange={vi.fn()} />)
    expect((screen.getByLabelText("Moneda del precio") as HTMLSelectElement).value).toBe("USD")
  })
})
