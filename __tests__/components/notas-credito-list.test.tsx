// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { SWRConfig } from "swr"
import type { NotaCreditoFila } from "@/lib/notas-credito/listado"

vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({ formatPrice: (n: number) => `$${n}`, formatDate: (d: string) => `dia(${d})` }),
}))

import { NotasCreditoList } from "@/components/notas-credito/notas-credito-list"

const fila = (extra: Partial<NotaCreditoFila>): NotaCreditoFila => ({
  id: "nc-1", origen: "VENTA", origenId: "v-1", origenNumero: "V0042", numero: "NC-000010",
  fecha: "2026-10-13", modo: "ITEMS", motivoNc: null, motivo: "Producto con falla", detalle: "Producto con falla",
  monto: 1500, montoAplicadoDeuda: 500, montoReembolso: 1000, metodo: "EFECTIVO", metodoLabel: "Efectivo",
  clienteId: null, clienteNombre: "Consumidor final", sucursalId: null, sucursalNombre: null,
  usuarioNombre: null, anulada: false, ...extra,
})

const FILAS = [
  fila({}),
  fila({ id: "nc-2", origen: "ORDEN", origenId: "o-1", origenNumero: "CEL099", numero: "NC-000011", clienteNombre: "Juan Pérez", anulada: true }),
]

function stubFetch(resp: { ok: boolean; body: unknown }) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: resp.ok, status: resp.ok ? 200 : 500, json: async () => resp.body })))
}

const renderList = (clienteId: string | null = null) =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <NotasCreditoList clienteId={clienteId} />
    </SWRConfig>
  )

const urlsPedidas = () => vi.mocked(fetch).mock.calls.map((c) => String(c[0]))

describe("NotasCreditoList", () => {
  beforeEach(() => vi.clearAllMocks())

  it("muestra cada NC con su operación enlazada y el estado anulada", async () => {
    stubFetch({ ok: true, body: { data: FILAS, total: 2 } })
    renderList()
    expect((await screen.findAllByText("NC-000010")).length).toBeGreaterThan(0)
    const venta = screen.getAllByRole("link", { name: "Venta V0042" })[0]
    expect(venta).toHaveAttribute("href", "/ventas/v-1")
    const orden = screen.getAllByRole("link", { name: "Orden CEL099" })[0]
    expect(orden).toHaveAttribute("href", "/ordenes/o-1")
    expect(screen.getAllByText("Juan Pérez").length).toBeGreaterThan(0)
    // Solo la NC-000011 está anulada (tabla + tarjeta mobile = 2 badges).
    expect(screen.getAllByText("Anulada")).toHaveLength(2)
  })

  it("pide la primera página de 20 y, desde la ficha del cliente, filtra por ese cliente", async () => {
    stubFetch({ ok: true, body: { data: [], total: 0 } })
    renderList("cli-7")
    await waitFor(() => expect(urlsPedidas().length).toBeGreaterThan(0))
    const url = new URL(urlsPedidas()[0], "http://x")
    expect(url.pathname).toBe("/api/notas-credito")
    expect(url.searchParams.get("cliente")).toBe("cli-7")
    expect(url.searchParams.get("page")).toBe("1")
    expect(url.searchParams.get("limit")).toBe("20")
    expect(screen.getByText("Filtrado por cliente")).toBeInTheDocument()
  })

  it("buscar por número manda q", async () => {
    stubFetch({ ok: true, body: { data: [], total: 0 } })
    renderList()
    fireEvent.change(screen.getByLabelText("Buscar por número"), { target: { value: "NC-0001" } })
    await waitFor(() => expect(urlsPedidas().some((u) => u.includes("q=NC-0001"))).toBe(true))
  })

  it("sin resultados lo dice", async () => {
    stubFetch({ ok: true, body: { data: [], total: 0 } })
    renderList()
    expect((await screen.findAllByText("Todavía no hay notas de crédito")).length).toBeGreaterThan(0)
  })

  it("un error de la API se muestra, no queda una tabla vacía muda", async () => {
    stubFetch({ ok: false, body: { error: "boom" } })
    renderList()
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudieron cargar las notas de crédito")
  })
})

describe("página /notas-credito", () => {
  it("le pasa al listado el cliente de ?cliente= y nada si no viene", async () => {
    const { default: Pagina } = await import("@/app/(dashboard)/notas-credito/page")
    const conCliente = await Pagina({ searchParams: Promise.resolve({ cliente: "cli-1" }) })
    const sinCliente = await Pagina({ searchParams: Promise.resolve({}) })
    const listado = (el: any): any =>
      el?.type === NotasCreditoList ? el : [].concat(el?.props?.children ?? []).map(listado).find(Boolean)
    expect(listado(conCliente).props.clienteId).toBe("cli-1")
    expect(listado(sinCliente).props.clienteId).toBeNull()
  })
})
