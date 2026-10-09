import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"

vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({
    timezone: "America/Argentina/Buenos_Aires",
    currency: "ARS",
    formatPrice: (n: number) => `$${n}`,
  }),
}))

import { CajaResumen } from "@/components/caja/caja-resumen"

const base = {
  totalDia: 0,
  movimientos: [] as any[],
  porMetodo: {},
  porTipo: {},
  totalIngresos: 0,
  totalEgresos: 0,
}

const props = {
  filtroMetodo: "",
  filtroTipo: "",
  onFiltroMetodoChange: vi.fn(),
  onFiltroTipoChange: vi.fn(),
}

describe("CajaResumen: ordenes sin cobrar", () => {
  it("avisa que no esta disponible cuando sinCobrar es null (no lo muestra como 0)", () => {
    render(<CajaResumen {...props} data={{ ...base, sinCobrar: null }} />)

    expect(screen.getByText(/no se pudo cargar.*sin cobrar/i)).toBeTruthy()
  })

  it("no muestra aviso cuando hay datos y la lista esta vacia", () => {
    render(<CajaResumen {...props} data={{ ...base, sinCobrar: { count: 0, ordenes: [] } }} />)

    expect(screen.queryByText(/no se pudo cargar/i)).toBeNull()
  })

  it("lista las ordenes cuando hay sin cobrar", () => {
    render(
      <CajaResumen
        {...props}
        data={{
          ...base,
          sinCobrar: { count: 1, ordenes: [{ id: "o1", numeroOrden: 12, pendiente: 500, totalCobrado: 0 }] },
        }}
      />
    )

    expect(screen.getByText(/Orden #0012/)).toBeTruthy()
  })
})
