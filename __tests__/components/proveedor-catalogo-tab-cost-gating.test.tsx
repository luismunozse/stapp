import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import { SWRConfig } from "swr"

vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({
    formatPrice: (n: number) => `$${n}`,
    timezone: "America/Argentina/Buenos_Aires",
  }),
}))

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

import { ProveedorCatalogoTab } from "@/components/proveedores/proveedor-catalogo-tab"

/**
 * /api/proveedores/[id]/catalogo devuelve precioReferencia en null para los
 * roles sin acceso a costos de inventario, y reporta canViewCost.
 *
 * La tab no puede inferir el permiso desde el valor: precioReferencia es
 * nullable de por sí, así que "null" también es un item sin precio cargado.
 * De ahí el flag explícito — y de ahí que haya que probar las dos caras:
 * ocultar la columna cuando el costo está gateado, y NO mandar el campo en el
 * PUT, porque el input arrancaría vacío y borraría el precio guardado.
 */

const item = {
  id: "item-1",
  codigoProveedor: "SKU-1",
  nombre: "Pantalla iPhone 12",
  descripcion: null,
  precioReferencia: null as number | null,
  moneda: "ARS",
  unidad: "unidad",
  notas: null,
  precioActualizadoAt: "2026-08-01T00:00:00.000Z",
  inventarioId: "inv-1",
  inventario: { id: "inv-1", codigo: "C1", nombre: "Pantalla iPhone 12" },
}

function stubFetch(canViewCost: boolean, precioReferencia: number | null) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, init })
      if (init?.method === "PUT" || init?.method === "POST") {
        return Promise.resolve({ ok: true, json: async () => ({}) } as Response)
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          items: [{ ...item, precioReferencia }],
          canViewCost,
        }),
      } as Response)
    }),
  )
  return calls
}

function renderTab() {
  return render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <ProveedorCatalogoTab proveedorId="prov-1" />
    </SWRConfig>,
  )
}

describe("ProveedorCatalogoTab — precio de referencia gateado", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("muestra la columna de precio cuando el rol puede verlo", async () => {
    stubFetch(true, 4500)
    renderTab()

    await waitFor(() => expect(screen.getByText("Pantalla iPhone 12")).toBeInTheDocument())
    expect(screen.getByText("Precio ref.")).toBeInTheDocument()
    expect(screen.getByText("$4500")).toBeInTheDocument()
  })

  it("oculta la columna de precio cuando el costo está gateado", async () => {
    stubFetch(false, null)
    renderTab()

    await waitFor(() => expect(screen.getByText("Pantalla iPhone 12")).toBeInTheDocument())

    expect(screen.queryByText("Precio ref.")).not.toBeInTheDocument()
    expect(screen.queryByText("$0")).not.toBeInTheDocument()
    // Lo que no es costo sigue disponible.
    expect(screen.getByText("SKU-1")).toBeInTheDocument()
    expect(screen.getByText("C1")).toBeInTheDocument()
  })

  it("oculta el input de precio en el formulario cuando el costo está gateado", async () => {
    stubFetch(false, null)
    renderTab()

    await waitFor(() => expect(screen.getByText("Pantalla iPhone 12")).toBeInTheDocument())
    fireEvent.click(screen.getByLabelText("Editar item"))

    await waitFor(() => expect(screen.getByLabelText("Nombre *")).toBeInTheDocument())
    expect(screen.queryByLabelText("Precio referencia")).not.toBeInTheDocument()
  })

  it("no manda precioReferencia en el PUT cuando el costo está gateado", async () => {
    const calls = stubFetch(false, null)
    renderTab()

    await waitFor(() => expect(screen.getByText("Pantalla iPhone 12")).toBeInTheDocument())
    fireEvent.click(screen.getByLabelText("Editar item"))
    await waitFor(() => expect(screen.getByLabelText("Nombre *")).toBeInTheDocument())
    fireEvent.click(screen.getByRole("button", { name: /Guardar/i }))

    await waitFor(() => {
      expect(calls.some((c) => c.init?.method === "PUT")).toBe(true)
    })

    const put = calls.find((c) => c.init?.method === "PUT")!
    const payload = JSON.parse(put.init!.body as string)
    // Ausente, no null: el PUT sólo pisa precio_referencia si la clave viene.
    expect("precioReferencia" in payload).toBe(false)
    expect(payload.nombre).toBe("Pantalla iPhone 12")
  })

  it("sigue mandando precioReferencia cuando el rol puede verlo", async () => {
    const calls = stubFetch(true, 4500)
    renderTab()

    await waitFor(() => expect(screen.getByText("Pantalla iPhone 12")).toBeInTheDocument())
    fireEvent.click(screen.getByLabelText("Editar item"))
    await waitFor(() => expect(screen.getByLabelText("Precio referencia")).toBeInTheDocument())
    fireEvent.click(screen.getByRole("button", { name: /Guardar/i }))

    await waitFor(() => {
      expect(calls.some((c) => c.init?.method === "PUT")).toBe(true)
    })

    const put = calls.find((c) => c.init?.method === "PUT")!
    const payload = JSON.parse(put.init!.body as string)
    expect(payload.precioReferencia).toBe(4500)
  })
})
