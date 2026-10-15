import { afterEach, beforeEach, describe, it, expect, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { ElegirExistentesDialog } from "@/components/inventario/elegir-existentes-dialog"
import type { Inventario } from "@/types"

const item = (id: string, nombre: string, extra: Partial<Inventario> = {}): Inventario =>
  ({ id, codigo: `C-${id}`, nombre, categoria: "Fundas", tipoDispositivo: "CELULAR", stock: 1, stockReservado: 0, precioCompra: 1, precioVenta: 2, ...extra }) as Inventario

const TODOS = [
  item("a", "Funda roja"),
  item("b", "Funda azul"),
  item("k", "Kit cargador", { esKit: true }),
  item("x", "Funda archivada", { deletedAt: "2026-01-01" }),
  item("g", "Funda agrupada", { grupoId: "g-1" }),
]

let fetchMock: ReturnType<typeof vi.fn>
const alElegir = vi.fn()
const alCerrar = vi.fn()

beforeEach(() => {
  alElegir.mockClear()
  alCerrar.mockClear()
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: TODOS, total: TODOS.length }), { status: 200 }))
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

const abrir = (props: Partial<React.ComponentProps<typeof ElegirExistentesDialog>> = {}) =>
  render(<ElegirExistentesDialog open onClose={alCerrar} onElegidos={alElegir} {...props} />)
const seguir = () => screen.getByRole("button", { name: /^Seguir/ })

describe("ElegirExistentesDialog", () => {
  it("loads the first products when it opens, with no search term", async () => {
    abrir()
    await screen.findByText("Funda roja")
    const url = new URL(String(fetchMock.mock.calls[0][0]), "http://x")
    expect(url.pathname).toBe("/api/inventario")
    expect(url.searchParams.get("limit")).toBe("20")
    expect(url.searchParams.has("search")).toBe(false)
  })

  it("lists only products that can join a group: no kits, archived or already grouped", async () => {
    abrir()
    await screen.findByText("Funda roja")
    expect(screen.getByText("Funda azul")).toBeInTheDocument()
    for (const oculto of ["Kit cargador", "Funda archivada", "Funda agrupada"]) expect(screen.queryByText(oculto)).toBeNull()
  })

  it("searches by what is typed", async () => {
    abrir()
    await screen.findByText("Funda roja")
    fireEvent.change(screen.getByLabelText("Buscar producto"), { target: { value: "funda" } })
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => new URL(String(c[0]), "http://x").searchParams.get("search") === "funda")).toBe(true), { timeout: 2000 })
  })

  it("needs two products to continue, and hands over exactly the chosen ones", async () => {
    abrir()
    await screen.findByText("Funda roja")
    expect(seguir()).toBeDisabled()
    fireEvent.click(screen.getByRole("checkbox", { name: "Funda roja" }))
    expect(seguir()).toBeDisabled()
    fireEvent.click(screen.getByRole("checkbox", { name: "Funda azul" }))
    expect(seguir()).toBeEnabled()
    expect(seguir()).toHaveTextContent("Seguir con 2 productos")
    fireEvent.click(seguir())
    expect(alElegir).toHaveBeenCalledTimes(1)
    expect(alElegir.mock.calls[0][0].map((i: Inventario) => i.id).sort()).toEqual(["a", "b"])
  })

  it("unchecking removes it from the selection", async () => {
    abrir()
    await screen.findByText("Funda roja")
    fireEvent.click(screen.getByRole("checkbox", { name: "Funda roja" }))
    fireEvent.click(screen.getByRole("checkbox", { name: "Funda azul" }))
    fireEvent.click(screen.getByRole("checkbox", { name: "Funda azul" }))
    expect(seguir()).toBeDisabled()
  })

  it("the product being edited comes already chosen", async () => {
    abrir({ incluir: item("a", "Funda roja") })
    await screen.findByText("Funda azul")
    expect(screen.getByRole("checkbox", { name: "Funda roja" })).toBeChecked()
    fireEvent.click(screen.getByRole("checkbox", { name: "Funda azul" }))
    expect(seguir()).toBeEnabled()
  })

  it("a failed search says so and can be retried", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 500 }))
    abrir()
    expect(await screen.findByText("No pudimos buscar los productos. Probá de nuevo")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }))
    expect(await screen.findByText("Funda roja")).toBeInTheDocument()
  })

  it("no results says so", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: [], total: 0 }), { status: 200 }))
    abrir()
    expect(await screen.findByText("No encontramos productos para agrupar")).toBeInTheDocument()
  })

  it("renders nothing when closed, and Cancelar closes", async () => {
    const { unmount } = render(<ElegirExistentesDialog open={false} onClose={alCerrar} onElegidos={alElegir} />)
    expect(screen.queryByRole("dialog")).toBeNull()
    unmount()
    abrir()
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }))
    expect(alCerrar).toHaveBeenCalledTimes(1)
  })
})
