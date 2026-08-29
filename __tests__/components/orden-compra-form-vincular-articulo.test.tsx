import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { OrdenCompraForm } from "@/components/ordenes-compra/orden-compra-form"

vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({ formatPrice: (n: number) => `$${n}`, formatDate: (d: string) => d }),
}))

const showError = vi.fn()
vi.mock("@/contexts/modal-context", () => ({
  useModal: () => ({ showError, showSuccess: vi.fn(), showWarning: vi.fn(), confirm: vi.fn() }),
}))

// El alta de artículo real es un formulario de 1200 líneas con su propio fetch.
// Acá solo importa el contrato: al guardar devuelve el item creado y el picker
// lo deja vinculado.
vi.mock("@/components/inventario/inventario-form", () => ({
  InventarioForm: ({
    onSuccess,
  }: {
    onSuccess: (saved?: { id: string; codigo: string; nombre: string; precioCompra?: number | null }) => void
  }) => (
    <button
      type="button"
      onClick={() =>
        onSuccess({ id: "nuevo1", codigo: "PAN999", nombre: "Pantalla nueva", precioCompra: 4500 })
      }
    >
      guardar-articulo-stub
    </button>
  ),
}))

/**
 * Hasta ahora el ítem de una OC era solo texto libre: el vínculo al inventario
 * se hacía recién al recibir la mercadería, así que el operador escribía el
 * mismo producto dos veces. El backend ya aceptaba `inventarioId` al crear la
 * OC — solo faltaba la UI.
 */

const RESULTADO = {
  id: "i1",
  codigo: "PAN001",
  nombre: "Pantalla Samsung A55",
  stock: 3,
  precioCompra: 2000,
  precioVenta: 5000,
}

function mockFetch(overrides: Record<string, unknown> = {}) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith("/api/proveedores")) {
      return { ok: true, status: 200, json: async () => ({ data: [{ id: "p1", nombre: "Repuestos del Sur" }] }) }
    }
    if (url.startsWith("/api/inventario/search")) {
      return { ok: true, status: 200, json: async () => overrides.searchResults ?? [RESULTADO] }
    }
    if (url.startsWith("/api/ordenes-compra")) {
      return { ok: true, status: 201, json: async () => ({ id: "oc1" }) }
    }
    return { ok: true, status: 200, json: async () => ({}) }
  })
  vi.stubGlobal("fetch", fn)
  return fn
}

async function agregarItemYBuscar(texto = "pantalla") {
  // El form muestra "Agregar ítem" en el estado vacío y otra vez debajo de la
  // tabla; cualquiera de los dos sirve.
  fireEvent.click(screen.getAllByText(/agregar ítem/i)[0])
  const input = await screen.findByPlaceholderText(/buscar o escribir/i)
  fireEvent.change(input, { target: { value: texto } })
  return input
}

describe("OrdenCompraForm — vincular artículo desde el alta", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    showError.mockClear()
  })

  it("busca en inventario mientras se escribe la descripción", async () => {
    const fetchFn = mockFetch()
    render(<OrdenCompraForm onClose={vi.fn()} onCreated={vi.fn()} />)

    await agregarItemYBuscar()

    expect(await screen.findByText("Pantalla Samsung A55", {}, { timeout: 2000 })).toBeInTheDocument()
    expect(
      fetchFn.mock.calls.some(([u]) => String(u).startsWith("/api/inventario/search"))
    ).toBe(true)
  })

  it("al elegir un resultado completa la descripción, el código y el precio de compra", async () => {
    mockFetch()
    render(<OrdenCompraForm onClose={vi.fn()} onCreated={vi.fn()} />)
    await agregarItemYBuscar()

    fireEvent.mouseDown(await screen.findByText("Pantalla Samsung A55", {}, { timeout: 2000 }))

    expect(await screen.findByText(/PAN001/)).toBeInTheDocument()
    // El precio de compra del artículo pasa a ser el costo unitario del ítem.
    await waitFor(() => {
      expect(screen.getByDisplayValue("2000")).toBeInTheDocument()
    })
  })

  it("manda inventarioId al crear la OC cuando el ítem quedó vinculado", async () => {
    const fetchFn = mockFetch()
    render(<OrdenCompraForm onClose={vi.fn()} onCreated={vi.fn()} />)
    await agregarItemYBuscar()
    fireEvent.mouseDown(await screen.findByText("Pantalla Samsung A55", {}, { timeout: 2000 }))

    fireEvent.click(screen.getByText(/crear oc/i))

    await waitFor(() => {
      const post = fetchFn.mock.calls.find(
        ([u, init]) => String(u).startsWith("/api/ordenes-compra") && (init as RequestInit)?.method === "POST"
      )
      expect(post).toBeTruthy()
      const body = JSON.parse((post![1] as RequestInit).body as string)
      expect(body.items[0].inventarioId).toBe("i1")
    })
  })

  it("deja seguir con texto libre sin vincular nada", async () => {
    const fetchFn = mockFetch({ searchResults: [] })
    render(<OrdenCompraForm onClose={vi.fn()} onCreated={vi.fn()} />)
    await agregarItemYBuscar("algo que no existe")

    fireEvent.click(screen.getByText(/crear oc/i))

    await waitFor(() => {
      const post = fetchFn.mock.calls.find(
        ([u, init]) => String(u).startsWith("/api/ordenes-compra") && (init as RequestInit)?.method === "POST"
      )
      expect(post).toBeTruthy()
      const body = JSON.parse((post![1] as RequestInit).body as string)
      expect(body.items[0].descripcion).toBe("algo que no existe")
      expect(body.items[0].inventarioId).toBeNull()
    })
  })

  it("permite crear un artículo nuevo y lo deja vinculado", async () => {
    mockFetch({ searchResults: [] })
    render(<OrdenCompraForm onClose={vi.fn()} onCreated={vi.fn()} />)
    await agregarItemYBuscar("pantalla que no existe")

    fireEvent.mouseDown(await screen.findByText(/crear artículo/i, {}, { timeout: 2000 }))
    fireEvent.click(await screen.findByText("guardar-articulo-stub"))

    expect(await screen.findByText(/PAN999/)).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByDisplayValue("4500")).toBeInTheDocument()
    })
  })

  it("permite desvincular y volver a texto libre", async () => {
    mockFetch()
    render(<OrdenCompraForm onClose={vi.fn()} onCreated={vi.fn()} />)
    await agregarItemYBuscar()
    fireEvent.mouseDown(await screen.findByText("Pantalla Samsung A55", {}, { timeout: 2000 }))
    expect(await screen.findByText(/PAN001/)).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText(/desvincular/i))

    await waitFor(() => {
      expect(screen.queryByText(/PAN001/)).not.toBeInTheDocument()
    })
  })
})
