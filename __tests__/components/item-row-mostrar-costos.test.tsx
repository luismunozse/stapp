import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { ItemRow } from "@/components/cotizaciones/item-row"

vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({ formatPrice: (n: number) => `$${n}` }),
}))
vi.mock("@/contexts/modal-context", () => ({
  useModal: () => ({ confirm: vi.fn() }),
}))

// ItemRow renders both a mobile and a desktop layout simultaneously in jsdom
// (visibility is CSS-only), so every assertion checks both via getAllBy/queryAllBy.

describe("ItemRow (cotización) — costo y margen visibles solo con mostrarCostos", () => {
  const itemVinculadoConCosto = {
    descripcion: "Pantalla",
    cantidad: 1,
    precioUnitario: 500,
    inventarioId: "inv-1",
    precioCompra: 300,
  }

  const itemManual = {
    descripcion: "Mano de obra",
    cantidad: 1,
    precioUnitario: 100,
  }

  it("oculta costo y margen por defecto (roles no admin)", () => {
    render(<ItemRow item={itemVinculadoConCosto} index={0} onUpdate={vi.fn()} onRemove={vi.fn()} />)

    expect(screen.queryAllByText(/costo/i).length).toBe(0)
    expect(screen.queryAllByText(/margen/i).length).toBe(0)
  })

  it("muestra costo y margen cuando mostrarCostos esta activo (admin)", () => {
    render(<ItemRow item={itemVinculadoConCosto} index={0} onUpdate={vi.fn()} onRemove={vi.fn()} mostrarCostos />)

    expect(screen.getAllByText(/costo/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/margen/i).length).toBeGreaterThan(0)
  })

  it("oculta el input manual de costo unitario (item sin vincular a inventario) por defecto", () => {
    render(<ItemRow item={itemManual} index={0} onUpdate={vi.fn()} onRemove={vi.fn()} />)

    expect(screen.queryAllByText("Costo unitario (opcional, para margen)").length).toBe(0)
  })

  it("muestra el input manual de costo unitario cuando mostrarCostos esta activo", () => {
    render(<ItemRow item={itemManual} index={0} onUpdate={vi.fn()} onRemove={vi.fn()} mostrarCostos />)

    expect(screen.getAllByText("Costo unitario (opcional, para margen)").length).toBeGreaterThan(0)
  })

  it("oculta costo y margen en los resultados de busqueda de inventario por defecto", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: async () => [
            { id: "inv-2", nombre: "Batería", stock: 5, stockReservado: 0, precioVenta: 900, precioCompra: 450 },
          ],
        } as Response)
      )
    )

    render(<ItemRow item={itemManual} index={0} onUpdate={vi.fn()} onRemove={vi.fn()} />)

    fireEvent.click(screen.getAllByTitle("Buscar producto o servicio")[0])
    fireEvent.change(screen.getAllByPlaceholderText("Buscar producto o servicio...")[0], {
      target: { value: "bateria" },
    })

    await waitFor(() => expect(screen.getAllByText("Batería").length).toBeGreaterThan(0))

    expect(screen.queryAllByText(/costo/i).length).toBe(0)
    // Sale price stays visible even without mostrarCostos.
    expect(screen.getAllByText(/Venta:/).length).toBeGreaterThan(0)

    vi.unstubAllGlobals()
  })

  it("muestra costo en los resultados de busqueda cuando mostrarCostos esta activo", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: async () => [
            { id: "inv-2", nombre: "Batería", stock: 5, stockReservado: 0, precioVenta: 900, precioCompra: 450 },
          ],
        } as Response)
      )
    )

    render(<ItemRow item={itemManual} index={0} onUpdate={vi.fn()} onRemove={vi.fn()} mostrarCostos />)

    fireEvent.click(screen.getAllByTitle("Buscar producto o servicio")[0])
    fireEvent.change(screen.getAllByPlaceholderText("Buscar producto o servicio...")[0], {
      target: { value: "bateria" },
    })

    await waitFor(() => expect(screen.getAllByText("Batería").length).toBeGreaterThan(0))

    expect(screen.getAllByText(/Costo:/).length).toBeGreaterThan(0)

    vi.unstubAllGlobals()
  })
})

/**
 * El PUT de cotizaciones vuelve a derivar el costo desde inventario cuando el
 * link cambia, pero SOLO para los roles que no ven costos: al ADMIN se le confía
 * el costoUnitario del payload. Y el input manual de costo está oculto mientras
 * el item está vinculado, así que un costo viejo arrastrado desde otro producto
 * queda guardado con un margen equivocado que el ADMIN no puede ver ni corregir.
 * El cliente tiene que re-derivarlo igual que el servidor.
 */
describe("ItemRow (cotización) — costo unitario al vincular/desvincular inventario", () => {
  type OnUpdate = (index: number, field: string, value: string | number | null) => void

  const inventarioResult = (precioCompra: number | null) => [
    { id: "inv-2", nombre: "Batería", stock: 5, stockReservado: 0, precioVenta: 900, precioCompra },
  ]

  function stubInventarioSearch(precioCompra: number | null) {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: async () => inventarioResult(precioCompra),
        } as Response)
      )
    )
  }

  // Item guardado con el costo de OTRO producto: es el estado exacto que deja
  // una cotización editada por un ADMIN antes de re-vincular.
  const itemConCostoViejo = {
    descripcion: "Pantalla",
    cantidad: 1,
    precioUnitario: 500,
    costoUnitario: 300,
  }

  async function seleccionarDelInventario(onUpdate: OnUpdate) {
    render(<ItemRow item={itemConCostoViejo} index={0} onUpdate={onUpdate} onRemove={vi.fn()} mostrarCostos />)

    fireEvent.click(screen.getAllByTitle("Buscar producto o servicio")[0])
    fireEvent.change(screen.getAllByPlaceholderText("Buscar producto o servicio...")[0], {
      target: { value: "bateria" },
    })

    await waitFor(() => expect(screen.getAllByText("Batería").length).toBeGreaterThan(0))
    fireEvent.click(screen.getAllByText("Batería")[0])
  }

  it("al vincular un producto reescribe el costo unitario con el costo del producto nuevo", async () => {
    stubInventarioSearch(450)
    const onUpdate = vi.fn<OnUpdate>()

    await seleccionarDelInventario(onUpdate)

    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(0, "costoUnitario", 450))
    expect(onUpdate).toHaveBeenCalledWith(0, "inventarioId", "inv-2")
    expect(onUpdate).toHaveBeenCalledWith(0, "precioCompra", 450)

    vi.unstubAllGlobals()
  })

  // Mismo criterio que el servidor: sin precio_compra el costo es desconocido,
  // no cero. Un cero se lee como "me sale gratis" y pinta 100% de margen.
  it("al vincular un producto sin costo deja el costo unitario en null", async () => {
    stubInventarioSearch(null)
    const onUpdate = vi.fn<OnUpdate>()

    await seleccionarDelInventario(onUpdate)

    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(0, "costoUnitario", null))

    vi.unstubAllGlobals()
  })

  it("al desvincular limpia el costo unitario junto con el link", () => {
    const onUpdate = vi.fn<OnUpdate>()
    render(
      <ItemRow
        item={{ ...itemConCostoViejo, inventarioId: "inv-1", precioCompra: 300 }}
        index={0}
        onUpdate={onUpdate}
        onRemove={vi.fn()}
        mostrarCostos
      />
    )

    fireEvent.click(screen.getAllByTitle("Desvincular del catálogo")[0])

    expect(onUpdate).toHaveBeenCalledWith(0, "inventarioId", null)
    expect(onUpdate).toHaveBeenCalledWith(0, "precioCompra", null)
    expect(onUpdate).toHaveBeenCalledWith(0, "costoUnitario", null)
  })
})
