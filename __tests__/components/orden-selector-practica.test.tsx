import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, act } from "@testing-library/react"
import { OrdenSelector } from "@/components/cotizaciones/orden-selector"

vi.mock("@/contexts/currency-context", () => ({
  useTerminologia: () => (key: string) => (key === "orden" ? "Orden" : "Equipo"),
}))

const base = { estado: "RECIBIDO", cliente: null }
const REAL = { ...base, id: "o-real", numeroOrden: 7, dispositivo: "iPhone Real", esPractica: false }
const PRACTICA = { ...base, id: "o-prac", numeroOrden: 1, dispositivo: "Equipo de práctica", esPractica: true }

describe("OrdenSelector — practice orders", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: [PRACTICA, REAL] }) }))
    )
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("does not offer a practice order", async () => {
    render(<OrdenSelector value={null} onChange={vi.fn()} />)

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "1" } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })

    expect(screen.getByText(/iPhone Real/)).toBeInTheDocument()
    expect(screen.queryByText(/Equipo de práctica/)).not.toBeInTheDocument()
  })
})
