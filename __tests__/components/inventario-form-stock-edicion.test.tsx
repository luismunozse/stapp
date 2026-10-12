import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import { InventarioForm } from "@/components/inventario/inventario-form"
import type { Inventario } from "@/types"

/**
 * El stock de la lista es una foto vieja: si el formulario lo reenvia sin que
 * el operador lo haya tocado, el PUT lo compara contra el valor fresco de la DB
 * y lo pisa en modo absoluto (una venta del POS entre medio "reaparece").
 * El stock viaja solo cuando el operador lo cambio.
 */

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

const item: Inventario = {
  id: "i1",
  codigo: "ABC123",
  nombre: "Producto Test",
  categoria: "Pantallas",
  tipoDispositivo: "CELULAR" as Inventario["tipoDispositivo"],
  stock: 10,
  stockReservado: 0,
  precioCompra: 100,
  precioVenta: 500,
  barcode: "7890001234567",
  proveedorId: null,
}

describe("InventarioForm — el stock en la edicion", () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
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

  async function guardarYLeerPut() {
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }))
    let payload: Record<string, unknown> = {}
    await waitFor(() => {
      const put = fetchMock.mock.calls.find(([, init]: any[]) => init?.method === "PUT")
      expect(put).toBeDefined()
      payload = JSON.parse((put![1] as RequestInit).body as string)
    })
    return payload
  }

  it("NO manda stock cuando el operador solo cambio el precio", async () => {
    render(<InventarioForm item={item} onClose={vi.fn()} onSuccess={vi.fn()} />)
    fireEvent.change(screen.getByLabelText("Precio Venta *"), { target: { value: "650" } })

    const payload = await guardarYLeerPut()

    expect(payload.precioVenta).toBe(650)
    expect(payload).not.toHaveProperty("stock")
  })

  it("manda stock cuando el operador lo cambio", async () => {
    render(<InventarioForm item={item} onClose={vi.fn()} onSuccess={vi.fn()} />)
    fireEvent.change(screen.getByLabelText("Stock *"), { target: { value: "7" } })

    const payload = await guardarYLeerPut()

    expect(payload.stock).toBe(7)
  })

  it("un borrador escrito con otro stock de base se descarta: no se reenvia un stock viejo", async () => {
    // Borrador real: se edita el stock con el item en 10 y el debounce lo persiste.
    const primero = render(<InventarioForm item={item} onClose={vi.fn()} onSuccess={vi.fn()} />)
    fireEvent.change(screen.getByLabelText("Stock *"), { target: { value: "7" } })
    await waitFor(
      () => expect(Object.keys(window.localStorage).some((k) => k.includes("inventario-form"))).toBe(true),
      { timeout: 4000 },
    )
    primero.unmount()

    // Mientras tanto una venta bajo el stock de la ficha a 9.
    render(<InventarioForm item={{ ...item, stock: 9 }} onClose={vi.fn()} onSuccess={vi.fn()} />)
    expect(screen.queryByText(/se restauró un borrador no guardado/i)).not.toBeInTheDocument()
    expect(screen.getByLabelText("Stock *")).toHaveValue("9")

    fireEvent.change(screen.getByLabelText("Precio Venta *"), { target: { value: "650" } })
    const payload = await guardarYLeerPut()

    expect(payload.precioVenta).toBe(650)
    expect(payload).not.toHaveProperty("stock")
  })
})
