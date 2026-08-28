import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { RecibirOCDialog } from "@/components/ordenes-compra/recibir-oc-dialog"

const showError = vi.fn()
vi.mock("@/contexts/modal-context", () => ({
  useModal: () => ({ showError, showSuccess: vi.fn(), showWarning: vi.fn(), confirm: vi.fn() }),
}))

vi.mock("@/components/inventario/inventario-form", () => ({
  InventarioForm: ({
    onSuccess,
  }: {
    onSuccess: (saved?: { id: string; codigo: string; nombre: string; precioCompra?: number | null }) => void
  }) => (
    <button
      type="button"
      onClick={() => onSuccess({ id: "nuevo1", codigo: "FLX999", nombre: "Flex nuevo", precioCompra: 800 })}
    >
      guardar-articulo-stub
    </button>
  ),
}))

/**
 * El diálogo de recepción tenía su propia copia del buscador de inventario:
 * mismo debounce, mismo dropdown, pero sin alta de artículo. Si llegaba algo
 * que no estaba en el catálogo, no se podía vincular y el stock no se movía.
 *
 * Ahora comparte el buscador con el alta de OC. Ojo con el caso del alta
 * inline: abrir el formulario de artículo NO puede cerrar el buscador, o el
 * diálogo se desmonta con el formulario adentro.
 */

const ITEM_SIN_VINCULO = {
  id: "it1",
  descripcion: "Flex de carga generico",
  inventarioId: null,
  inventario: null,
  cantidadPedida: 5,
  cantidadRecibida: 0,
  precioUnitario: 800,
}

const RESULTADO = {
  id: "i1",
  codigo: "FLX001",
  nombre: "Flex de carga A55",
  stock: 2,
  precioCompra: 800,
}

function mockFetch(overrides: { searchResults?: unknown[] } = {}) {
  const fn = vi.fn(async (url: string, _init?: RequestInit) => {
    if (url.startsWith("/api/inventario/search")) {
      return { ok: true, status: 200, json: async () => overrides.searchResults ?? [RESULTADO] }
    }
    if (url.includes("/recibir")) {
      return { ok: true, status: 200, json: async () => ({ success: true }) }
    }
    // Detalle de la OC
    return { ok: true, status: 200, json: async () => ({ items: [ITEM_SIN_VINCULO] }) }
  })
  vi.stubGlobal("fetch", fn)
  return fn
}

function renderDialog() {
  return render(
    <RecibirOCDialog
      open
      onOpenChange={vi.fn()}
      ordenCompraId="oc1"
      numeroOC="OC-0001"
      onReceived={vi.fn()}
    />
  )
}

async function abrirBuscador() {
  // Por rol, porque el encabezado de la columna también dice "Vincular".
  fireEvent.click(await screen.findByRole("button", { name: /^vincular$/i }))
  return screen.findByPlaceholderText(/buscar/i)
}

describe("RecibirOCDialog — buscador compartido", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    showError.mockClear()
  })

  it("busca en inventario y vincula el resultado elegido", async () => {
    mockFetch()
    renderDialog()

    const input = await abrirBuscador()
    fireEvent.change(input, { target: { value: "flex" } })

    fireEvent.mouseDown(await screen.findByText("Flex de carga A55", {}, { timeout: 2000 }))

    expect(await screen.findByText(/FLX001/)).toBeInTheDocument()
  })

  it("ofrece crear el artículo cuando no está en el catálogo", async () => {
    mockFetch({ searchResults: [] })
    renderDialog()

    const input = await abrirBuscador()
    fireEvent.change(input, { target: { value: "algo que no existe" } })

    expect(await screen.findByText(/crear artículo/i, {}, { timeout: 2000 })).toBeInTheDocument()
  })

  it("deja vinculado el artículo recién creado", async () => {
    mockFetch({ searchResults: [] })
    renderDialog()

    const input = await abrirBuscador()
    fireEvent.change(input, { target: { value: "flex nuevo" } })

    fireEvent.mouseDown(await screen.findByText(/crear artículo/i, {}, { timeout: 2000 }))
    // Abrir el alta no puede desmontar el buscador: si el diálogo se cierra,
    // este botón no existe.
    fireEvent.click(await screen.findByText("guardar-articulo-stub"))

    expect(await screen.findByText(/FLX999/)).toBeInTheDocument()
  })

  it("manda el inventarioId vinculado al confirmar la recepción", async () => {
    const fetchFn = mockFetch()
    renderDialog()

    const input = await abrirBuscador()
    fireEvent.change(input, { target: { value: "flex" } })
    fireEvent.mouseDown(await screen.findByText("Flex de carga A55", {}, { timeout: 2000 }))
    await screen.findByText(/FLX001/)

    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "2" } })
    fireEvent.click(screen.getByText(/confirmar recepción/i))

    await waitFor(() => {
      const post = fetchFn.mock.calls.find(([u]) => String(u).includes("/recibir"))
      expect(post).toBeTruthy()
      const body = JSON.parse((post![1] as RequestInit).body as string)
      expect(body.items[0].inventarioId).toBe("i1")
      // La clave de idempotencia de la migración 313 sigue viajando.
      expect(body.requestId).toBeTruthy()
    })
  })

  it("permite desvincular lo que se acaba de vincular", async () => {
    mockFetch()
    renderDialog()

    const input = await abrirBuscador()
    fireEvent.change(input, { target: { value: "flex" } })
    fireEvent.mouseDown(await screen.findByText("Flex de carga A55", {}, { timeout: 2000 }))
    expect(await screen.findByText(/FLX001/)).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText(/desvincular/i))

    await waitFor(() => {
      expect(screen.queryByText(/FLX001/)).not.toBeInTheDocument()
    })
  })
})
