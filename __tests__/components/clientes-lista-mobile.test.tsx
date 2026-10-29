import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { SWRConfig } from "swr"
import { ClientesList } from "@/components/clientes/clientes-list"
import { ClienteMobileCard } from "@/components/clientes/cliente-mobile-card"

const puedeCobrarMock = vi.fn(() => true)
vi.mock("@/hooks/use-puede-cobrar", () => ({ usePuedeCobrar: () => puedeCobrarMock() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }))
vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({ formatPrice: (n: number) => `$${n}`, formatDate: (d: string) => d, pais: "AR" }),
}))
vi.mock("@/contexts/modal-context", () => ({ useModal: () => ({ confirm: vi.fn(), showError: vi.fn() }) }))
vi.mock("@/hooks/use-subscription", () => ({ useHasFeature: () => ({ hasFeature: true, loading: false }) }))
vi.mock("@/components/clientes/cliente-form", () => ({ ClienteForm: () => null }))
vi.mock("@/components/clientes/cuenta-corriente-dialog", () => ({ CuentaCorrienteDialog: () => null }))
vi.mock("@/components/clientes/cliente-whatsapp-dialog", () => ({ ClienteWhatsAppDialog: () => null }))
vi.mock("@/components/ordenes/cobrar-multiple-dialog", () => ({ CobrarMultipleDialog: () => null }))
vi.mock("@/components/import/import-modal", () => ({ ImportModal: () => null }))

const BASE = {
  id: "cli-1",
  nombre: "Juan Gómez",
  telefono: "(011) 4555-1234",
  tipoCliente: "INDIVIDUAL",
  esPractica: false,
  createdAt: "2026-10-11",
  updatedAt: "2026-10-11",
  ordenesCount: 1,
  deudaPendiente: 0,
}

function renderCard(cliente: Record<string, unknown>, handlers: { onCobrar?: () => void } = {}) {
  return render(
    <ClienteMobileCard
      cliente={{ ...BASE, ...cliente } as never}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
      onWhatsApp={vi.fn()}
      onCuentaCorriente={vi.fn()}
      onCobrar={handlers.onCobrar}
      deleting={false}
    />
  )
}

describe("ClienteMobileCard — direct counter actions", () => {
  it("renders Llamar as a normalized tel: link", () => {
    renderCard({})
    expect(screen.getByRole("link", { name: /Llamar a Juan/ })).toHaveAttribute("href", "tel:01145551234")
  })

  it("renders a WhatsApp button that fires the handler", () => {
    const onWhatsApp = vi.fn()
    render(
      <ClienteMobileCard cliente={BASE as never} onEdit={vi.fn()} onDelete={vi.fn()} onWhatsApp={onWhatsApp} deleting={false} />
    )
    fireEvent.click(screen.getByRole("button", { name: /WhatsApp a Juan/ }))
    expect(onWhatsApp).toHaveBeenCalledTimes(1)
  })

  it("shows Cobrar only with debt and a handler", () => {
    renderCard({ deudaPendiente: 500 }, { onCobrar: vi.fn() })
    expect(screen.getByRole("button", { name: /Cobrar a Juan/ })).toBeInTheDocument()
  })

  it("hides Cobrar without debt", () => {
    renderCard({ deudaPendiente: 0 }, { onCobrar: vi.fn() })
    expect(screen.queryByRole("button", { name: /Cobrar a Juan/ })).not.toBeInTheDocument()
  })

  it("hides Cobrar when the user cannot collect (no handler), even with debt", () => {
    renderCard({ deudaPendiente: 500 })
    expect(screen.queryByRole("button", { name: /Cobrar a Juan/ })).not.toBeInTheDocument()
  })

  it("makes the whole card a link to the detail", () => {
    renderCard({})
    expect(screen.getByRole("link", { name: "Juan Gómez" })).toHaveAttribute("href", "/clientes/cli-1")
  })

  it("shows the Debe chip, and A favor when there is only credit", () => {
    const { unmount } = renderCard({ deudaPendiente: 500 })
    expect(screen.getByText("Debe $500")).toBeInTheDocument()
    unmount()
    renderCard({ saldoCuenta: 200 })
    expect(screen.getByText("A favor $200")).toBeInTheDocument()
  })

  it("does not show the registration date", () => {
    renderCard({})
    expect(screen.queryByText(/Registrado/)).not.toBeInTheDocument()
  })
})

describe("ClientesList — empty state with filters", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.startsWith("/api/clientes?")) {
          const empty = url.includes("search=zzz")
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: empty ? [] : [BASE],
              total: empty ? 0 : 1,
              totalDeuda: 0,
              resumenDeuda: { total: 1500, clientes: 3 },
            }),
          }
        }
        return { ok: true, status: 200, json: async () => ({}) }
      })
    )
  })

  const wrap = (ui: React.ReactNode) => (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>
  )

  it("shows the always-visible debt strip and turns on the debt filter on tap", async () => {
    render(wrap(<ClientesList />))
    const strip = await screen.findByRole("button", { name: /Total adeudado/ })
    expect(strip).toHaveTextContent("$1500")
    expect(strip).toHaveTextContent("3 clientes")
    fireEvent.click(strip)
    expect(await screen.findByRole("button", { name: /Total adeudado/ })).toHaveAttribute("aria-pressed", "true")
    expect(vi.mocked(fetch).mock.calls.some((c) => String(c[0]).includes("conDeuda=true"))).toBe(true)
  })

  it("offers Limpiar filtros when a search returns nothing, and resets the search", async () => {
    render(wrap(<ClientesList />))
    await screen.findAllByText("Juan Gómez")
    fireEvent.change(screen.getByPlaceholderText(/Buscar por nombre/), { target: { value: "zzz" } })
    const clear = await screen.findByRole("button", { name: "Limpiar filtros" })
    expect(screen.getAllByText("Sin resultados").length).toBeGreaterThan(0)
    expect(screen.queryByText("No hay clientes registrados")).not.toBeInTheDocument()
    fireEvent.click(clear)
    expect(screen.getByPlaceholderText(/Buscar por nombre/)).toHaveValue("")
    expect((await screen.findAllByText("Juan Gómez")).length).toBeGreaterThan(0)
  })
})
