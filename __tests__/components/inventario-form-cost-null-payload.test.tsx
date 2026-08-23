import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import { InventarioForm } from "@/components/inventario/inventario-form"
import type { Inventario } from "@/types"

/**
 * Defense in depth for the purchase cost.
 *
 * The form has to seed the "Costo" input with a number, so an item loaded with
 * precioCompra: null lands on 0. That 0 must never reach the PUT: the payload
 * is spread wholesale and there is no dirty-field filtering, so writing it
 * replaces the row's real precio_compra with zero.
 *
 * The PUT guard (requireInventarioAccess) covers roles that cannot see cost,
 * but not a role that CAN write and merely received null from a source that
 * did not opt into cost. Corrupting a cost should take two mistakes, not one.
 */

// El formulario persiste borradores (hooks/use-form-draft.ts) y el hook arma la
// key con la sesion.
vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { id: "user-1", organizationId: "org-1", role: "ADMIN" } },
    status: "authenticated",
  }),
}))

vi.mock("@/contexts/modal-context", () => ({
  useModal: () => ({
    confirm: vi.fn().mockResolvedValue(false),
    alert: vi.fn().mockResolvedValue(undefined),
    showSuccess: vi.fn().mockResolvedValue(undefined),
    showError: vi.fn().mockResolvedValue(undefined),
    showWarning: vi.fn().mockResolvedValue(undefined),
    showInfo: vi.fn().mockResolvedValue(undefined),
  }),
}))

vi.mock("@/hooks/use-tipos-dispositivo", () => ({
  useTiposDispositivo: () => ({
    tipos: [{ id: "t1", codigo: "CELULAR", nombre: "Celular", config: null }],
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
}))

function makeItem(precioCompra: number | null): Inventario {
  return {
    id: "i1",
    codigo: "ABC123",
    nombre: "Producto Test",
    categoria: "Pantallas",
    tipoDispositivo: "CELULAR" as Inventario["tipoDispositivo"],
    stock: 10,
    stockReservado: 1,
    precioCompra,
    precioVenta: 500,
    barcode: "7890001234567",
    proveedorId: null,
  }
}

describe("InventarioForm — PUT payload when the item loaded without a cost", () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    // Un borrador escrito por un test anterior se restauraria sobre el
    // siguiente y lo haria medir otra cosa.
    window.localStorage.clear()
    fetchMock = vi.fn((url: string) => {
      if (typeof url === "string" && url.includes("/api/proveedores")) {
        return Promise.resolve({ ok: true, json: async () => [] } as Response)
      }
      return Promise.resolve({ ok: true, json: async () => ({ id: "i1" }) } as Response)
    })
    vi.stubGlobal("fetch", fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function saveAndReadPutPayload(item: Inventario) {
    render(<InventarioForm item={item} onClose={vi.fn()} onSuccess={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }))

    let payload: Record<string, unknown> = {}
    await waitFor(() => {
      const put = fetchMock.mock.calls.find(([, init]: any[]) => init?.method === "PUT")
      expect(put).toBeDefined()
      payload = JSON.parse((put![1] as RequestInit).body as string)
    })
    return payload
  }

  it("omits precioCompra entirely when the item arrived with a null cost", async () => {
    const payload = await saveAndReadPutPayload(makeItem(null))

    expect(payload).not.toHaveProperty("precioCompra")
    // The rest of the edit still goes through.
    expect(payload.nombre).toBe("Producto Test")
    expect(payload.precioVenta).toBe(500)
  })

  it("sends precioCompra when the item did arrive with a cost", async () => {
    const payload = await saveAndReadPutPayload(makeItem(150))

    expect(payload.precioCompra).toBe(150)
  })
})

/**
 * The same null, one layer up: the input itself.
 *
 * Seeding "Costo *" with 0 shows the operator an invented cost — the exact
 * thing this branch avoids everywhere else ("un 0 se lee como gratis";
 * inventario-list renders "—" for the same null). It is reachable: the
 * /inventario page only redirects VENDEDOR, so a TECNICO can open it, and the
 * barcode-scan flow feeds this dialog directly.
 *
 * The field is hidden, not zeroed, and the operator is told why — matching the
 * submit path, which already omits the field for exactly this item.
 */
describe("InventarioForm — the cost input when the item loaded without a cost", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, json: async () => [] } as Response)),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("hides the cost input when the item arrived with a null cost", () => {
    render(<InventarioForm item={makeItem(null)} onClose={vi.fn()} onSuccess={vi.fn()} />)

    expect(screen.queryByLabelText("Costo *")).not.toBeInTheDocument()
    // The rest of the form still works: only the cost is withheld.
    expect(screen.getByLabelText("Precio Venta *")).toBeInTheDocument()
  })

  it("explains the absence instead of leaving a silent gap", () => {
    render(<InventarioForm item={makeItem(null)} onClose={vi.fn()} onSuccess={vi.fn()} />)

    expect(screen.getByText(/sin permiso para ver el costo/i)).toBeInTheDocument()
  })

  it("shows the cost input, seeded with the real value, when the item did arrive with a cost", () => {
    render(<InventarioForm item={makeItem(150)} onClose={vi.fn()} onSuccess={vi.fn()} />)

    expect(screen.getByLabelText("Costo *")).toHaveValue("150")
  })

  it("shows the cost input on a new item, where 0 is a real starting value", () => {
    render(<InventarioForm onClose={vi.fn()} onSuccess={vi.fn()} />)

    expect(screen.getByLabelText("Costo *")).toBeInTheDocument()
  })
})
