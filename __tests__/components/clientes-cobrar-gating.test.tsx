import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { SWRConfig } from "swr"
import { ClientesList } from "@/components/clientes/clientes-list"
import { ClienteOrdenesPendientes } from "@/components/clientes/detalle/cliente-ordenes-pendientes"

// puedeCobrar is the single switch: ADMIN / VENDEDOR with permission = true,
// VENDEDOR without permission or still unknown = false (fail-closed).
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

const REAL = {
  id: "cli-1",
  nombre: "Juan Gómez",
  telefono: "",
  email: "j@taller.test",
  tipoCliente: "INDIVIDUAL",
  esPractica: false,
  createdAt: "2026-10-11",
  updatedAt: "2026-10-11",
  ordenesCount: 1,
  deudaPendiente: 0,
}

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.startsWith("/api/clientes?")) {
        return { ok: true, status: 200, json: async () => ({ data: [REAL], total: 1, totalDeuda: 0 }) }
      }
      if (url.includes("/ordenes-pendientes")) {
        return {
          ok: true,
          status: 200,
          json: async () => [{ id: "o1", numeroOrden: 1, dispositivo: "Phone", pendiente: 500, estadoCobro: "PENDIENTE" }],
        }
      }
      return { ok: true, status: 200, json: async () => ({}) }
    })
  )
}

const wrap = (ui: React.ReactNode) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>
)

describe("ClientesList — Cobrar órdenes gated by usePuedeCobrar", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    stubFetch()
    const original = console.error
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      const msg = String(args[0])
      if (msg.includes("cannot be a child of") || msg.includes("cannot contain a nested")) return
      original(...args)
    })
  })

  async function open() {
    render(wrap(<ClientesList />))
    await screen.findAllByText("Juan Gómez")
    for (const t of screen.getAllByTitle("Más acciones")) fireEvent.click(t)
  }

  it("shows the action when the user can collect", async () => {
    puedeCobrarMock.mockReturnValue(true)
    await open()
    expect(screen.getAllByText("Cobrar órdenes").length).toBeGreaterThan(0)
  })

  it("hides the action when the user cannot (or does not yet know)", async () => {
    puedeCobrarMock.mockReturnValue(false)
    await open()
    expect(screen.queryByText("Cobrar órdenes")).not.toBeInTheDocument()
    // The rest of the menu is untouched.
    expect(screen.getAllByText("Cuenta corriente").length).toBeGreaterThan(0)
  })
})

describe("ClienteOrdenesPendientes — Cobrar todo gated by usePuedeCobrar", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    stubFetch()
  })

  it("shows the button when the user can collect", async () => {
    puedeCobrarMock.mockReturnValue(true)
    render(wrap(<ClienteOrdenesPendientes clienteId="cli-1" clienteNombre="Juan" />))
    expect(await screen.findByText(/Cobrar todo/)).toBeInTheDocument()
  })

  it("hides the button when the user cannot, but still lists the pending orders", async () => {
    puedeCobrarMock.mockReturnValue(false)
    render(wrap(<ClienteOrdenesPendientes clienteId="cli-1" clienteNombre="Juan" />))
    expect(await screen.findByText(/#1 · Phone/)).toBeInTheDocument()
    expect(screen.queryByText(/Cobrar todo/)).not.toBeInTheDocument()
  })
})

describe("ClienteMobileCard — Cobrar without handler", () => {
  it("renders no Cobrar action when onCobrar is undefined", async () => {
    const { ClienteMobileCard } = await import("@/components/clientes/cliente-mobile-card")
    render(
      <ClienteMobileCard
        cliente={REAL as never}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onWhatsApp={vi.fn()}
        onCuentaCorriente={vi.fn()}
        deleting={false}
      />
    )
    fireEvent.click(screen.getByTitle("Más acciones"))
    expect(screen.queryByText("Cobrar órdenes")).not.toBeInTheDocument()
    expect(screen.getByText("Cuenta corriente")).toBeInTheDocument()
  })
})
