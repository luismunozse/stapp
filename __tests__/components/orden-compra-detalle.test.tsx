import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { SWRConfig } from "swr"
import { OrdenCompraDetalle } from "@/components/ordenes-compra/orden-compra-detalle"

vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({
    formatPrice: (n: number) => `$${n}`,
    formatDate: (d: string) => d,
  }),
}))

/**
 * El detalle de una OC nunca se construyó: existía el GET
 * /api/ordenes-compra/[id] con todo lo necesario, pero el único cliente que lo
 * llamaba era el diálogo de recepción. Desde el listado solo se veían estado,
 * proveedor, total y fecha.
 *
 * Lo que más importa acá es la cantidad recibida contra la pedida y qué ítems
 * quedaron sin vincular al inventario: un ítem sin vincular NO mueve stock al
 * recibirse, y esa es justamente la información que el listado escondía.
 */

const OC = {
  id: "oc1",
  numeroOC: "OC-0001",
  estado: "RECIBIDA_PARCIAL",
  proveedor: { id: "p1", nombre: "Repuestos del Sur" },
  fechaEmision: "2026-08-01",
  fechaRecepcionEsperada: "2026-08-15",
  fechaRecepcionReal: null,
  subtotal: 30000,
  total: 30000,
  notas: "Entregar en el depósito de atrás",
  createdBy: { id: "u1", nombre: "Ana" },
  createdAt: "2026-08-01",
  items: [
    {
      id: "it1",
      descripcion: "Pantalla Samsung A55",
      inventarioId: "i1",
      inventario: { id: "i1", codigo: "PAN001", nombre: "Pantalla A55", stock: 4, stockReservado: 0 },
      cantidadPedida: 10,
      cantidadRecibida: 4,
      precioUnitario: 2000,
      subtotal: 20000,
    },
    {
      id: "it2",
      descripcion: "Flex de carga generico",
      inventarioId: null,
      inventario: null,
      cantidadPedida: 5,
      cantidadRecibida: 0,
      precioUnitario: 2000,
      subtotal: 10000,
    },
  ],
}

function mockFetch(response: unknown, ok = true, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok,
      status,
      json: async () => response,
    })
  )
}

function renderDetalle(id = "oc1") {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <OrdenCompraDetalle ordenCompraId={id} />
    </SWRConfig>
  )
}

describe("OrdenCompraDetalle", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("muestra la cabecera con proveedor, fechas y quién la creó", async () => {
    mockFetch(OC)
    renderDetalle()

    expect(await screen.findByText("OC-0001")).toBeInTheDocument()
    expect(screen.getByText("Repuestos del Sur")).toBeInTheDocument()
    expect(screen.getByText("Parcial")).toBeInTheDocument()
    expect(screen.getByText("2026-08-01")).toBeInTheDocument()
    expect(screen.getByText("2026-08-15")).toBeInTheDocument()
    expect(screen.getByText("Ana")).toBeInTheDocument()
    expect(screen.getByText("Entregar en el depósito de atrás")).toBeInTheDocument()
  })

  it("lista los ítems con lo pedido, lo recibido y el subtotal", async () => {
    mockFetch(OC)
    renderDetalle()

    expect(await screen.findByText("Pantalla Samsung A55")).toBeInTheDocument()
    expect(screen.getByText("Flex de carga generico")).toBeInTheDocument()
    // El artículo vinculado se identifica por código.
    expect(screen.getByText(/PAN001/)).toBeInTheDocument()
    expect(screen.getByText("$20000")).toBeInTheDocument()
    expect(screen.getByText("$10000")).toBeInTheDocument()
  })

  it("marca el ítem que no está vinculado a un artículo del inventario", async () => {
    mockFetch(OC)
    renderDetalle()

    // Es la señal de que ese ítem no va a mover stock cuando se reciba.
    expect(await screen.findByText(/sin vincular/i)).toBeInTheDocument()
  })

  it("muestra el avance de recepción de cada ítem", async () => {
    mockFetch(OC)
    renderDetalle()

    // 4 de 10 recibidas en el primero, 0 de 5 en el segundo.
    expect(await screen.findByText("4 / 10")).toBeInTheDocument()
    expect(screen.getByText("0 / 5")).toBeInTheDocument()
  })

  it("muestra el total de la orden", async () => {
    mockFetch(OC)
    renderDetalle()

    expect(await screen.findByText("$30000")).toBeInTheDocument()
  })

  it("avisa cuando la orden no existe en vez de quedarse en blanco", async () => {
    mockFetch({ error: "Orden de compra no encontrada" }, false, 404)
    renderDetalle("no-existe")

    await waitFor(() => {
      expect(screen.getByText(/no encontrada/i)).toBeInTheDocument()
    })
  })

  it("no rompe cuando la orden no tiene proveedor ni notas", async () => {
    mockFetch({ ...OC, proveedor: null, notas: null, createdBy: null })
    renderDetalle()

    expect(await screen.findByText("OC-0001")).toBeInTheDocument()
    expect(screen.getByText("Pantalla Samsung A55")).toBeInTheDocument()
  })
})
