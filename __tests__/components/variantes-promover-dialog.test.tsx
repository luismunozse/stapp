import { StrictMode } from "react"
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { PromoverDialog } from "@/components/inventario/variantes/promover-dialog"
import type { VariantesState } from "@/lib/variantes-filas"
import { aplicar, reductor, filaDe, grupoColor, hidratar, opcionId } from "../helpers/variantes-filas"
import { estadoActivo, estadoColor } from "../helpers/variantes-ui"

const DEPOSITOS = {
  item: { id: "item1", nombre: "Funda X", stockTotal: 10 },
  data: [
    { depositoId: "d1", depositoNombre: "Principal", principal: true, activo: true, stock: 7, stockReservado: 0, disponible: 7 },
    { depositoId: "d2", depositoNombre: "Norte", principal: false, activo: true, stock: 3, stockReservado: 0, disponible: 3 },
    { depositoId: "d3", depositoNombre: "Sur", principal: false, activo: true, stock: 0, stockReservado: 0, disponible: 0 },
  ],
  discrepancia: 0,
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn(async () => new Response(JSON.stringify(DEPOSITOS), { status: 200 }))
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const ITEM = { id: "item1", nombre: "Funda X", stock: 10 }

const montar = (
  estado: VariantesState,
  props: Partial<{ open: boolean; item: typeof ITEM }> = {}
) => {
  const alConfirmar = vi.fn()
  const alCancelar = vi.fn()
  const vista = (extra: Partial<{ open: boolean; item: typeof ITEM }> = {}) => (
    <PromoverDialog open={props.open ?? true} item={props.item ?? ITEM} estado={estado} alConfirmar={alConfirmar} alCancelar={alCancelar} {...extra} />
  )
  const resultado = render(vista())
  return { ...resultado, alConfirmar, alCancelar, vista }
}

describe("PromoverDialog: a product with stock", () => {
  it("asks which combination the product becomes and shows the units it holds in each depósito", async () => {
    montar(estadoColor())
    const dialogo = await screen.findByRole("dialog")
    expect(within(dialogo).getByText("¿Qué variante es este producto?")).toBeInTheDocument()
    expect(within(dialogo).getByText(/Funda X/)).toBeInTheDocument()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe("/api/inventario/item1/depositos")
    expect(await within(dialogo).findByText("7 unidades")).toBeInTheDocument()
    const principal = within(dialogo).getByText("Principal").closest("li")!
    expect(principal).toHaveTextContent("7 unidades")
    expect(within(dialogo).getByText("Norte").closest("li")).toHaveTextContent("3 unidades")
    // A depósito with nothing is noise.
    expect(within(dialogo).queryByText("Sur")).toBeNull()
  })

  it("says 1 unidad in the singular", async () => {
    fetchMock.mockImplementation(
      async () => new Response(JSON.stringify({ ...DEPOSITOS, data: [{ ...DEPOSITOS.data[0], stock: 1 }] }), { status: 200 })
    )
    montar(estadoColor(), { item: { ...ITEM, stock: 1 } })
    expect(await screen.findByText("1 unidad")).toBeInTheDocument()
  })

  it("offers the new combinations, with the first one chosen, and confirms it", async () => {
    const estado = estadoColor()
    const { alConfirmar } = montar(estado)
    const grupo = await screen.findByRole("radiogroup", { name: "Combinación" })
    const opciones = within(grupo).getAllByRole("radio")
    expect(opciones.map((o) => o.getAttribute("aria-label") ?? o.closest("label")?.textContent)).toEqual(["Rojo", "Azul"])
    expect(opciones[0]).toBeChecked()
    expect(opciones[1]).not.toBeChecked()

    fireEvent.click(screen.getByRole("button", { name: "Usar esta combinación" }))
    expect(alConfirmar).toHaveBeenCalledTimes(1)
    expect(alConfirmar).toHaveBeenCalledWith(filaDe(estado, "Rojo").id)
  })

  it("confirms the combination the user picked", async () => {
    const estado = estadoColor()
    const { alConfirmar } = montar(estado)
    fireEvent.click(await screen.findByLabelText("Azul"))
    expect(screen.getByLabelText("Azul")).toBeChecked()
    expect(screen.getByLabelText("Rojo")).not.toBeChecked()
    fireEvent.click(screen.getByRole("button", { name: "Usar esta combinación" }))
    expect(alConfirmar).toHaveBeenCalledWith(filaDe(estado, "Azul").id)
  })

  it("never offers a saved combination: only the new ones", async () => {
    const guardado = hidratar(grupoColor())
    const conNegro = aplicar(reductor(), guardado, { tipo: "agregarValor", opcionId: opcionId(guardado, "Color"), texto: "Negro" })
    const { alConfirmar } = montar(conNegro)
    const grupo = await screen.findByRole("radiogroup", { name: "Combinación" })
    expect(within(grupo).getAllByRole("radio")).toHaveLength(1)
    expect(within(grupo).getByLabelText("Negro")).toBeChecked()
    fireEvent.click(screen.getByRole("button", { name: "Usar esta combinación" }))
    expect(alConfirmar).toHaveBeenCalledWith(filaDe(conNegro, "Negro").id)
  })

  it("an item already placed starts on the combination it holds, which stays on offer", async () => {
    const colocado = aplicar(reductor(), estadoColor(), { tipo: "promover", item: { id: "item1", codigo: "ABC", precioVenta: 900, stock: 10 }, filaId: filaDe(estadoColor(), "Azul").id })
    expect(colocado.promocionId).toBe("item1")
    const { alConfirmar } = montar(colocado)
    const grupo = await screen.findByRole("radiogroup", { name: "Combinación" })
    expect(within(grupo).getByLabelText("Azul")).toBeChecked()
    expect(within(grupo).getAllByRole("radio")).toHaveLength(2)
    fireEvent.click(screen.getByRole("button", { name: "Usar esta combinación" }))
    expect(alConfirmar).toHaveBeenCalledWith("item1")
  })

  it("cancel closes without choosing", async () => {
    const { alConfirmar, alCancelar } = montar(estadoColor())
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }))
    expect(alCancelar).toHaveBeenCalledTimes(1)
    expect(alConfirmar).not.toHaveBeenCalled()
  })

  it("Escape also cancels", async () => {
    const { alConfirmar, alCancelar } = montar(estadoColor())
    fireEvent.keyDown(await screen.findByRole("dialog"), { key: "Escape" })
    await waitFor(() => expect(alCancelar).toHaveBeenCalledTimes(1))
    expect(alConfirmar).not.toHaveBeenCalled()
  })
})

describe("PromoverDialog: the depósitos", () => {
  it("says it is loading, then lists them", async () => {
    let responder: (r: Response) => void = () => {}
    fetchMock.mockImplementation(() => new Promise<Response>((resolver) => (responder = resolver)))
    montar(estadoColor())
    expect(await screen.findByText("Cargando el stock por depósito…")).toBeInTheDocument()
    await act(async () => responder(new Response(JSON.stringify(DEPOSITOS), { status: 200 })))
    expect(await screen.findByText("Norte")).toBeInTheDocument()
    expect(screen.queryByText("Cargando el stock por depósito…")).toBeNull()
  })

  it("when the breakdown cannot be read it says so, keeps the total and still lets the user confirm", async () => {
    // Even a body that looks fine is not trusted when the status says it failed.
    fetchMock.mockImplementation(async () => new Response(JSON.stringify(DEPOSITOS), { status: 500 }))
    const estado = estadoColor()
    const { alConfirmar } = montar(estado)
    expect(await screen.findByText(/No pudimos ver el stock por depósito/)).toBeInTheDocument()
    expect(screen.getByText(/En total tiene 10 unidades/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Usar esta combinación" }))
    expect(alConfirmar).toHaveBeenCalledWith(filaDe(estado, "Rojo").id)
  })

  it("a network failure is handled the same way", async () => {
    fetchMock.mockImplementation(async () => {
      throw new TypeError("network")
    })
    montar(estadoColor())
    expect(await screen.findByText(/No pudimos ver el stock por depósito/)).toBeInTheDocument()
  })

  it("stops the request when the dialog goes away", async () => {
    let senal: AbortSignal | undefined
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      senal = init?.signal ?? undefined
      return new Promise<Response>(() => {})
    })
    const { unmount } = montar(estadoColor())
    await screen.findByText("Cargando el stock por depósito…")
    expect(senal).toBeDefined()
    expect(senal?.aborted).toBe(false)
    unmount()
    expect(senal?.aborted).toBe(true)
  })

  it("asks again for another item", async () => {
    const estado = estadoColor()
    const { rerender, vista } = montar(estado)
    await screen.findByText("Norte")
    fetchMock.mockImplementation(() => new Promise<Response>(() => {}))
    rerender(vista({ item: { id: "item2", nombre: "Otra", stock: 4 } }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock.mock.calls[1][0]).toBe("/api/inventario/item2/depositos")
    // The first item's depósitos are not shown as the second one's while it loads.
    expect(screen.getByText("Cargando el stock por depósito…")).toBeInTheDocument()
    expect(screen.queryByText("Norte")).toBeNull()
  })
})

describe("PromoverDialog: every opening starts fresh", () => {
  it("a choice made in one opening is not carried into the next", async () => {
    const estado = estadoColor()
    const { vista, rerender } = montar(estado)
    fireEvent.click(await screen.findByLabelText("Azul"))
    expect(screen.getByLabelText("Azul")).toBeChecked()
    rerender(vista({ open: false }))
    expect(screen.queryByRole("dialog")).toBeNull()
    rerender(vista({ open: true }))
    expect(await screen.findByLabelText("Rojo")).toBeChecked()
    expect(screen.getByLabelText("Azul")).not.toBeChecked()
  })

  it("a choice made for one product is not kept when the dialog moves to another", async () => {
    const estado = estadoColor()
    const { vista, rerender, alConfirmar } = montar(estado)
    fireEvent.click(await screen.findByLabelText("Azul"))
    rerender(vista({ item: { id: "item2", nombre: "Otra", stock: 4 } }))
    expect(await screen.findByLabelText("Rojo")).toBeChecked()
    fireEvent.click(screen.getByRole("button", { name: "Usar esta combinación" }))
    expect(alConfirmar).toHaveBeenCalledWith(filaDe(estado, "Rojo").id)
  })

  it("the depósitos of the previous opening are not shown while the new request runs", async () => {
    const estado = estadoColor()
    const { vista, rerender } = montar(estado)
    await screen.findByText("Norte")
    rerender(vista({ open: false }))
    fetchMock.mockImplementation(() => new Promise<Response>(() => {}))
    rerender(vista({ open: true }))
    expect(await screen.findByText("Cargando el stock por depósito…")).toBeInTheDocument()
    expect(screen.queryByText("Norte")).toBeNull()
  })

  it("when the depósitos hold nothing at all it falls back to the total instead of an empty box", async () => {
    fetchMock.mockImplementation(
      async () =>
        new Response(JSON.stringify({ ...DEPOSITOS, data: DEPOSITOS.data.map((d) => ({ ...d, stock: 0 })), discrepancia: 10 }), { status: 200 })
    )
    montar(estadoColor())
    expect(await screen.findByText(/En total tiene 10 unidades/)).toBeInTheDocument()
    expect(screen.queryByRole("list")).toBeNull()
    expect(screen.queryByText("Cargando el stock por depósito…")).toBeNull()
  })
})

describe("PromoverDialog: a product with no stock", () => {
  it("confirms exactly once even when React runs the effects twice (StrictMode)", () => {
    const alConfirmar = vi.fn()
    render(
      <StrictMode>
        <PromoverDialog open item={{ ...ITEM, stock: 0 }} estado={estadoColor()} alConfirmar={alConfirmar} alCancelar={vi.fn()} />
      </StrictMode>
    )
    expect(alConfirmar).toHaveBeenCalledTimes(1)
  })

  it("shows no dialog, asks nothing and picks the first new combination", () => {
    const estado = estadoColor()
    const { alConfirmar } = montar(estado, { item: { ...ITEM, stock: 0 } })
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(alConfirmar).toHaveBeenCalledTimes(1)
    expect(alConfirmar).toHaveBeenCalledWith(filaDe(estado, "Rojo").id)
  })

  it("decides once per opening, not once per render", () => {
    const { alConfirmar, rerender, vista } = montar(estadoColor(), { item: { ...ITEM, stock: 0 } })
    rerender(vista())
    rerender(vista())
    expect(alConfirmar).toHaveBeenCalledTimes(1)
    // Closed and opened again is a new decision.
    rerender(vista({ open: false }))
    rerender(vista({ open: true }))
    expect(alConfirmar).toHaveBeenCalledTimes(2)
  })

  it("an item already placed keeps its slot", () => {
    const base = estadoColor()
    const colocado = aplicar(reductor(), base, { tipo: "promover", item: { id: "item1", codigo: "ABC", precioVenta: 900, stock: 0 }, filaId: filaDe(base, "Azul").id })
    const { alConfirmar } = montar(colocado, { item: { ...ITEM, stock: 0 } })
    expect(alConfirmar).toHaveBeenCalledWith("item1")
  })
})

describe("PromoverDialog: closed or without anywhere to go", () => {
  it("closed: nothing is shown, requested or decided", () => {
    const { alConfirmar } = montar(estadoColor(), { open: false })
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(alConfirmar).not.toHaveBeenCalled()
  })

  it("no new combination to take: it hands the decision back with no row, even with stock, so the reducer explains", () => {
    const { alConfirmar } = montar(estadoActivo())
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(alConfirmar).toHaveBeenCalledTimes(1)
    expect(alConfirmar).toHaveBeenCalledWith(undefined)
  })
})
