/**
 * REQ-4.1 — el badge "Mayorista" debe verse en cada superficie donde aparece
 * un cliente. Este archivo cubre los tres sub-componentes presentacionales
 * que reciben `cliente`/`selected` directo por props (ClienteMobileCard,
 * ClienteDetalleHeader, ClienteSelector) — la columna desktop de
 * ClientesList usa el mismo <TipoPrecioBadge/> ya cubierto por
 * tipo-precio-badge.test.tsx, y ClientesList en sí requiere stubear SWR +
 * media query + varios diálogos hijos para un beneficio marginal; se deja a
 * verificación manual (mismo criterio que design §6 para casos de alto
 * costo de setup y bajo valor incremental de test).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { ClienteMobileCard } from "@/components/clientes/cliente-mobile-card"
import { ClienteDetalleHeader } from "@/components/clientes/detalle/cliente-detalle-header"
import { ClienteSelector } from "@/components/cotizaciones/cliente-selector"
import { ModalProvider } from "@/contexts/modal-context"
import type { Cliente } from "@/types"

vi.mock("@/hooks/use-subscription", () => ({
  useHasFeature: () => ({ hasFeature: true, loading: false }),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

// ClienteSelector monta ClienteForm (para "crear nuevo cliente") aunque el
// dialog esté cerrado — ClienteForm llama useSession() incondicionalmente.
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: null }),
}))

function makeCliente(overrides: Partial<Cliente> = {}): Cliente {
  return {
    id: "c1",
    nombre: "Juan Perez",
    telefono: "1100000000",
    email: null,
    tipoPrecio: "MINORISTA",
    descuentoPct: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

describe("ClienteMobileCard — badge de tier", () => {
  it("muestra el badge Mayorista cuando el cliente es MAYORISTA", () => {
    render(
      <ClienteMobileCard
        cliente={makeCliente({ tipoPrecio: "MAYORISTA" })}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        deleting={false}
      />,
    )
    expect(screen.getByText("Mayorista")).toBeInTheDocument()
  })

  it("no muestra el badge para MINORISTA", () => {
    render(
      <ClienteMobileCard cliente={makeCliente()} onEdit={vi.fn()} onDelete={vi.fn()} deleting={false} />,
    )
    expect(screen.queryByText("Mayorista")).not.toBeInTheDocument()
  })
})

describe("ClienteDetalleHeader — badge de tier", () => {
  it("muestra el badge Mayorista cuando el cliente es MAYORISTA", () => {
    render(
      <ClienteDetalleHeader
        cliente={makeCliente({ tipoPrecio: "MAYORISTA" })}
        saldo={0}
        deudaPendiente={0}
        totalOrdenes={0}
        onEdit={vi.fn()}
        onWhatsApp={vi.fn()}
      />,
    )
    expect(screen.getByText("Mayorista")).toBeInTheDocument()
  })

  it("no muestra el badge para MINORISTA", () => {
    render(
      <ClienteDetalleHeader
        cliente={makeCliente()}
        saldo={0}
        deudaPendiente={0}
        totalOrdenes={0}
        onEdit={vi.fn()}
        onWhatsApp={vi.fn()}
      />,
    )
    expect(screen.queryByText("Mayorista")).not.toBeInTheDocument()
  })
})

describe("ClienteSelector — badge de tier en resultados y en el valor seleccionado", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (typeof url === "string" && url.includes("/api/clientes?search=")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              data: [
                { id: "c1", nombre: "Mayorista SA", telefono: "123", tipoPrecio: "MAYORISTA" },
              ],
            }),
          })
        }
        return Promise.resolve({ ok: false, json: async () => ({}) })
      }),
    )
  })

  it("muestra el badge en la fila de resultados de búsqueda", async () => {
    render(
      <ModalProvider>
        <ClienteSelector value={null} onChange={vi.fn()} />
      </ModalProvider>,
    )
    fireEvent.change(screen.getByPlaceholderText("Buscar cliente por nombre..."), {
      target: { value: "Mayor" },
    })
    expect(await screen.findByText("Mayorista SA")).toBeInTheDocument()
    expect(screen.getByText("Mayorista")).toBeInTheDocument()
  })

  it("muestra el badge junto al valor seleccionado tras elegir un cliente mayorista", async () => {
    const onChange = vi.fn()
    render(
      <ModalProvider>
        <ClienteSelector value={null} onChange={onChange} />
      </ModalProvider>,
    )
    fireEvent.change(screen.getByPlaceholderText("Buscar cliente por nombre..."), {
      target: { value: "Mayor" },
    })
    fireEvent.click(await screen.findByText("Mayorista SA"))

    await waitFor(() => expect(onChange).toHaveBeenCalledWith("c1", expect.objectContaining({ id: "c1" })))
    expect(screen.getByText("Mayorista")).toBeInTheDocument()
  })
})
