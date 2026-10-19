import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { SWRConfig } from "swr"
import { ClientesList } from "@/components/clientes/clientes-list"
import { ClienteMobileCard } from "@/components/clientes/cliente-mobile-card"
import type { Cliente } from "@/types"

vi.mock("@/hooks/use-puede-cobrar", () => ({ usePuedeCobrar: () => true }))
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

const PRACTICA = {
  id: "cli-prac",
  nombre: "Ana Pérez",
  telefono: "",
  email: "ana@taller.test",
  tipoCliente: "INDIVIDUAL",
  esPractica: true,
  createdAt: "2026-10-11",
  updatedAt: "2026-10-11",
  ordenesCount: 1,
  deudaPendiente: 0,
}
const REAL = { ...PRACTICA, id: "cli-1", nombre: "Juan Gómez", esPractica: false }

const BLOCKED = ["Cobrar órdenes", "Cuenta corriente", "Eliminar"]

function stubFetch(clientes: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.startsWith("/api/clientes?")) {
        return { ok: true, status: 200, json: async () => ({ data: clientes, total: clientes.length, totalDeuda: 0 }) }
      }
      return { ok: true, status: 200, json: async () => ({}) }
    })
  )
}

function renderList() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ClientesList />
    </SWRConfig>
  )
}

function openAllMenus() {
  for (const trigger of screen.getAllByTitle("Más acciones")) fireEvent.click(trigger)
}

describe("ClientesList — practice client", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Known, unrelated warning: the DataTable loading skeleton renders a <tr>
    // inside a <td>. Silence only that one so other errors still surface.
    const original = console.error
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      const msg = String(args[0])
      if (msg.includes("cannot be a child of") || msg.includes("cannot contain a nested")) return
      original(...args)
    })
  })

  it("badges the practice client", async () => {
    stubFetch([PRACTICA])
    renderList()

    await screen.findAllByText("Ana Pérez")
    expect(screen.getAllByText("Práctica").length).toBeGreaterThan(0)
  })

  it("does not badge a real client", async () => {
    stubFetch([REAL])
    renderList()

    await screen.findAllByText("Juan Gómez")
    expect(screen.queryByText("Práctica")).not.toBeInTheDocument()
  })

  it("hides collect, account and delete actions for the practice client", async () => {
    stubFetch([PRACTICA])
    renderList()

    await screen.findAllByText("Ana Pérez")
    openAllMenus()

    expect(screen.getAllByText("Nueva orden").length).toBeGreaterThan(0)
    for (const label of BLOCKED) expect(screen.queryByText(label)).not.toBeInTheDocument()
  })

  it("keeps collect, account and delete actions for a real client", async () => {
    stubFetch([REAL])
    renderList()

    await screen.findAllByText("Juan Gómez")
    openAllMenus()

    for (const label of BLOCKED) expect(screen.getAllByText(label).length).toBeGreaterThan(0)
  })
})

describe("ClienteMobileCard — practice client", () => {
  const handlers = {
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onWhatsApp: vi.fn(),
    onCuentaCorriente: vi.fn(),
    onCobrar: vi.fn(),
    deleting: false,
  }

  it("hides collect, account and delete even when the handlers are passed", () => {
    render(<ClienteMobileCard cliente={PRACTICA as unknown as Cliente} {...handlers} />)
    fireEvent.click(screen.getByTitle("Más acciones"))

    expect(screen.getByText("Práctica")).toBeInTheDocument()
    for (const label of BLOCKED) expect(screen.queryByText(label)).not.toBeInTheDocument()
  })

  it("shows the actions for a real client", () => {
    render(<ClienteMobileCard cliente={REAL as unknown as Cliente} {...handlers} />)
    fireEvent.click(screen.getByTitle("Más acciones"))

    expect(screen.queryByText("Práctica")).not.toBeInTheDocument()
    for (const label of BLOCKED) expect(screen.getByText(label)).toBeInTheDocument()
  })
})
