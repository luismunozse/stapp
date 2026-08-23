// __tests__/components/cotizacion-list-prefill-repuestos.test.tsx
//
// El boton "Desde Repuestos" lo usa el TECNICO (orden-detail lo habilita con
// readOnly={!isAdmin && userRole !== "TECNICO"}), y a ese rol el servidor le
// devuelve `precioUnitario` en NULL porque es el COSTO de compra congelado.
// El prefill tiene que llevar el precio de VENTA, que es lo que se le cobra al
// cliente, y nunca puede dejar el formulario en un estado imposible de guardar.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { ModalProvider } from "@/contexts/modal-context"
import { CotizacionList } from "@/components/cotizaciones/cotizacion-list"

vi.mock("swr", () => ({
  default: () => ({ data: [], isLoading: false, mutate: vi.fn() }),
}))

vi.mock("@/hooks/use-subscription", () => ({
  useHasFeature: () => ({ hasFeature: true, loading: false }),
}))

vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({
    formatPrice: (n: number) => `$${n}`,
    formatDate: (d: string) => String(d),
  }),
}))

/** Repuesto tal como lo ve un rol sin acceso a inventario: el costo viene en
 *  NULL, el precio de venta (posterior a la migracion 286) si llega. */
const repuestoGatedConVenta = {
  id: "r1",
  inventarioId: "inv-1",
  inventario: { id: "inv-1", nombre: "Pantalla iPhone 12", stock: 3 },
  cantidad: 2,
  precioUnitario: null,
  precioVentaUnitario: 4500,
}

/** Fila anterior a la migracion 286 leida por un rol gateado: no queda ningun
 *  precio utilizable. */
const repuestoGatedLegacy = {
  id: "r2",
  inventarioId: null,
  nombre: "Flex de carga",
  cantidad: 1,
  precioUnitario: null,
  precioVentaUnitario: null,
}

function renderList(repuestos: any[]) {
  render(
    <ModalProvider>
      <CotizacionList ordenId="orden-1" repuestos={repuestos as any} mostrarCostos={false} />
    </ModalProvider>
  )
}

/** Body del POST a /api/cotizaciones. */
function postBody(mockFetch: ReturnType<typeof vi.fn>) {
  const call = mockFetch.mock.calls.find(
    ([url, opts]) => url === "/api/cotizaciones" && (opts as RequestInit)?.method === "POST"
  )
  return call ? JSON.parse((call[1] as RequestInit).body as string) : null
}

describe("CotizacionList — prefill 'Desde Repuestos' con el costo oculto", () => {
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch = vi.fn(() => Promise.resolve({ ok: true, json: async () => ({}) } as Response))
    vi.stubGlobal("fetch", mockFetch)
  })

  it("el TECNICO puede prefilear y guardar: los items salen a precio de venta", async () => {
    renderList([repuestoGatedConVenta])

    fireEvent.click(screen.getByRole("button", { name: /Desde Repuestos/i }))
    fireEvent.click(await screen.findByRole("button", { name: /Crear Cotización/i }))

    await waitFor(() => {
      const body = postBody(mockFetch)
      expect(body).not.toBeNull()
      expect(body.items).toHaveLength(1)
      expect(body.items[0]).toMatchObject({
        descripcion: "Pantalla iPhone 12",
        cantidad: 2,
        precioUnitario: 4500,
        inventarioId: "inv-1",
      })
    })

    expect(screen.queryByText(/al menos un item v[aá]lido/i)).not.toBeInTheDocument()
  })

  it("muestra el precio prefileado en vez de dejar la fila en cero", async () => {
    renderList([repuestoGatedConVenta])

    fireEvent.click(screen.getByRole("button", { name: /Desde Repuestos/i }))

    // Subtotal bruto = 2 × 4500. Con el costo gateado daba 0.
    expect((await screen.findAllByText("$9000")).length).toBeGreaterThan(0)
    expect(screen.queryByText("$0")).not.toBeInTheDocument()
  })

  it("avisa cuando hay repuestos sin precio de venta y los deja afuera del prefill", async () => {
    renderList([repuestoGatedConVenta, repuestoGatedLegacy])

    expect(screen.getByText(/sin precio de venta/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /Desde Repuestos/i }))
    fireEvent.click(await screen.findByRole("button", { name: /Crear Cotización/i }))

    await waitFor(() => {
      const body = postBody(mockFetch)
      expect(body).not.toBeNull()
      expect(body.items).toHaveLength(1)
      expect(body.items[0].descripcion).toBe("Pantalla iPhone 12")
    })
  })

  it("no ofrece el prefill cuando ningun repuesto tiene precio de venta", () => {
    renderList([repuestoGatedLegacy])

    expect(screen.queryByRole("button", { name: /Desde Repuestos/i })).not.toBeInTheDocument()
    expect(screen.getByText(/sin precio de venta/i)).toBeInTheDocument()
  })

  it("para ADMIN, una fila vieja sin precio de venta cae al costo y sigue prefileando", async () => {
    renderList([
      {
        id: "r3",
        inventarioId: "inv-3",
        inventario: { id: "inv-3", nombre: "Bateria", stock: 5 },
        cantidad: 1,
        precioUnitario: 3000,
        precioVentaUnitario: null,
      },
    ])

    expect(screen.queryByText(/sin precio de venta/i)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /Desde Repuestos/i }))
    fireEvent.click(await screen.findByRole("button", { name: /Crear Cotización/i }))

    await waitFor(() => {
      const body = postBody(mockFetch)
      expect(body).not.toBeNull()
      expect(body.items[0].precioUnitario).toBe(3000)
    })
  })
})
