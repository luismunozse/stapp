// El boton "Editar" de una cotizacion se mostraba solo en BORRADOR, pero el
// servidor acepta cambios en cualquier estado salvo ACEPTADA y RECHAZADA
// (app/api/cotizaciones/[id]/route.ts:316) y ya recalcula el presupuesto de la
// orden vinculada cuando cambian los items. La UI era mas estricta que la regla
// real: una cotizacion ENVIADA que el cliente pide corregir no se podia tocar.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { ModalProvider } from "@/contexts/modal-context"
import { CotizacionList } from "@/components/cotizaciones/cotizacion-list"

const cotizaciones = { value: [] as any[] }

vi.mock("swr", () => ({
  default: () => ({ data: cotizaciones.value, isLoading: false, mutate: vi.fn() }),
}))

vi.mock("@/hooks/use-subscription", () => ({
  useHasFeature: () => ({ hasFeature: true, loading: false }),
}))

vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({
    formatPrice: (n: number) => `$${n}`,
    formatDate: (d: string) => String(d),
    pais: "AR",
  }),
  useTerminologia: () => (key: string) => key,
}))

const cotizacionEn = (estado: string) => ({
  id: "cot-1",
  numeroCotizacion: "COT-0001",
  estado,
  total: 1000,
  publicToken: "tok-1",
  clienteNombre: "Cliente",
  items: [],
})

const renderEnEstado = (estado: string) => {
  cotizaciones.value = [cotizacionEn(estado)]
  render(
    <ModalProvider>
      <CotizacionList ordenId="orden-1" />
    </ModalProvider>
  )
  return screen.queryByRole("button", { name: /Editar/ })
}

describe("CotizacionList — quien puede editarse", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("ofrece editar una cotizacion ENVIADA", () => {
    expect(renderEnEstado("ENVIADA")).toBeInTheDocument()
  })

  it("sigue ofreciendo editar un BORRADOR", () => {
    expect(renderEnEstado("BORRADOR")).toBeInTheDocument()
  })

  it("ofrece editar una ACEPTADA: al guardar se elige si sigue aceptada o pide firma", () => {
    expect(renderEnEstado("ACEPTADA")).toBeInTheDocument()
  })

  it("no ofrece editar una ACEPTADA ya convertida en venta", () => {
    cotizaciones.value = [{ ...cotizacionEn("ACEPTADA"), ventaId: "venta-1" }]
    render(
      <ModalProvider>
        <CotizacionList ordenId="orden-1" />
      </ModalProvider>
    )
    expect(screen.queryByRole("button", { name: /Editar/ })).not.toBeInTheDocument()
  })

  it("no ofrece editar una RECHAZADA", () => {
    expect(renderEnEstado("RECHAZADA")).not.toBeInTheDocument()
  })
})
