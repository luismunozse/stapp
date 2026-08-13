import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { ModalProvider } from "@/contexts/modal-context"
import { ClienteForm } from "@/components/clientes/cliente-form"
import type { Cliente } from "@/types"

let mockSession: any = { data: { user: { role: "ADMIN" } } }
vi.mock("next-auth/react", () => ({
  useSession: () => mockSession,
}))

function makeCliente(overrides: Partial<Cliente> = {}): Cliente {
  return {
    id: "c1",
    nombre: "Juan Perez",
    telefono: "1100000000",
    email: null,
    tipoPrecio: "MAYORISTA",
    descuentoPct: 15,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

describe("ClienteForm — precio mayorista (ADMIN-only, REQ-2/REQ-4.2)", () => {
  beforeEach(() => {
    mockSession = { data: { user: { role: "ADMIN" } } }
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: "c1" }),
      }),
    )
  })

  it("ADMIN ve el selector de precio y el campo de descuento cuando el cliente es MAYORISTA", () => {
    render(
      <ModalProvider>
        <ClienteForm cliente={makeCliente()} open onClose={vi.fn()} onSuccess={vi.fn()} />
      </ModalProvider>,
    )
    expect(screen.getByText("Precio")).toBeInTheDocument()
    expect(screen.getByLabelText("Descuento mayorista (%)")).toBeInTheDocument()
  })

  it("un no-ADMIN no ve el selector de precio en absoluto", () => {
    mockSession = { data: { user: { role: "VENDEDOR" } } }
    render(
      <ModalProvider>
        <ClienteForm cliente={makeCliente()} open onClose={vi.fn()} onSuccess={vi.fn()} />
      </ModalProvider>,
    )
    expect(screen.queryByText("Precio")).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Descuento mayorista/)).not.toBeInTheDocument()
  })

  it("al volver un cliente MAYORISTA a MINORISTA, el submit envía descuentoPct: null", async () => {
    render(
      <ModalProvider>
        <ClienteForm cliente={makeCliente()} open onClose={vi.fn()} onSuccess={vi.fn()} />
      </ModalProvider>,
    )
    fireEvent.click(screen.getByRole("button", { name: "Minorista" }))
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }))

    await waitFor(() => expect(fetch).toHaveBeenCalled())
    const [, options] = (fetch as any).mock.calls[0]
    const body = JSON.parse(options.body)
    expect(body.tipoPrecio).toBe("MINORISTA")
    expect(body.descuentoPct).toBeNull()
  })

  it("un no-ADMIN editando otros campos de un cliente MAYORISTA no reenvía tipoPrecio/descuentoPct", async () => {
    mockSession = { data: { user: { role: "VENDEDOR" } } }
    render(
      <ModalProvider>
        <ClienteForm cliente={makeCliente()} open onClose={vi.fn()} onSuccess={vi.fn()} />
      </ModalProvider>,
    )
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }))

    await waitFor(() => expect(fetch).toHaveBeenCalled())
    const [, options] = (fetch as any).mock.calls[0]
    const body = JSON.parse(options.body)
    expect(body).not.toHaveProperty("tipoPrecio")
    expect(body).not.toHaveProperty("descuentoPct")
  })
})
