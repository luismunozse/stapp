// Una ACEPTADA no se edita: se revisa. Revisar crea una cotizacion nueva
// (POST /api/cotizaciones/[id]/revisar) que el cliente tiene que volver a
// firmar; la aceptada original queda congelada, con su firma intacta. Una
// fila ya reemplazada (reemplazadaPor no nulo) no puede ofrecer Revisar de
// nuevo: ya tiene una revision. Ver docs/superpowers/specs/
// 2026-08-25-revision-cotizacion-aceptada-design.md
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

const cotizacionBase = (overrides: Record<string, any>) => ({
  id: "cot-1",
  numeroCotizacion: "COT-0001",
  estado: "ACEPTADA",
  total: 1000,
  publicToken: "tok-1",
  clienteNombre: "Cliente",
  reemplazadaPor: null,
  revisionDe: null,
  firmaAprobacion: null,
  firmaMime: null,
  fechaAprobacion: null,
  items: [],
  ...overrides,
})

const renderConCotizaciones = (items: any[]) => {
  cotizaciones.value = items
  render(
    <ModalProvider>
      <CotizacionList ordenId="orden-1" />
    </ModalProvider>
  )
}

describe("CotizacionList — revisar una aceptada", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("ofrece Revisar en una ACEPTADA, y no Editar", () => {
    renderConCotizaciones([cotizacionBase({})])

    expect(screen.getByRole("button", { name: /Revisar/ })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^Editar/ })).not.toBeInTheDocument()
  })

  it("no ofrece Revisar sobre una cotizacion ya reemplazada", () => {
    renderConCotizaciones([
      cotizacionBase({ reemplazadaPor: "rev-1" }),
    ])

    expect(screen.queryByRole("button", { name: /Revisar/ })).not.toBeInTheDocument()
  })

  it("avisa que la orden tiene una revision sin firmar", () => {
    renderConCotizaciones([
      cotizacionBase({ reemplazadaPor: "rev-1" }),
      cotizacionBase({
        id: "rev-1",
        numeroCotizacion: "COT-0001",
        estado: "ENVIADA",
        revisionDe: "cot-1",
      }),
    ])

    expect(screen.getByText(/revisión pendiente de firma/i)).toBeInTheDocument()
  })
})
