import { afterEach, beforeEach, describe, it, expect, vi } from "vitest"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import type { ReactNode } from "react"
import { AgruparDialog } from "@/components/inventario/agrupar-dialog"
import { nombreVariante } from "@/lib/variantes"
import type { Inventario } from "@/types"

// A native-like Select: the list is always open, each SelectItem is a button, and every Select registers
// its onValueChange so a test can fire the value a closed Radix Select echoes back (G11).
const { manejadores } = vi.hoisted(() => ({ manejadores: [] as ((valor: string) => void)[] }))

vi.mock("@/components/ui/select", async () => {
  const React = await import("react")
  const Contexto = React.createContext<{ value?: string; onValueChange?: (v: string) => void }>({})
  return {
    Select: ({ value, onValueChange, children }: { value?: string; onValueChange?: (v: string) => void; children: ReactNode }) => {
      if (onValueChange) manejadores.push(onValueChange)
      return <Contexto.Provider value={{ value, onValueChange }}>{children}</Contexto.Provider>
    },
    SelectTrigger: ({ children, ...props }: Record<string, unknown> & { children: ReactNode }) => (
      <button type="button" role="combobox" {...props}>
        {children}
      </button>
    ),
    SelectValue: ({ placeholder }: { placeholder?: string }) => {
      const { value } = React.useContext(Contexto)
      return <span data-testid="valor-elegido">{value || placeholder}</span>
    },
    SelectContent: ({ children }: { children: ReactNode }) => <div role="listbox">{children}</div>,
    SelectItem: ({ value, children }: { value: string; children: ReactNode }) => {
      const { onValueChange } = React.useContext(Contexto)
      return (
        <button type="button" role="option" aria-selected="false" onClick={() => onValueChange?.(value)}>
          {children}
        </button>
      )
    },
  }
})

const item = (id: string, nombre: string, extra: Partial<Inventario> = {}): Inventario =>
  ({
    id,
    codigo: `C-${id}`,
    nombre,
    categoria: "Fundas",
    tipoDispositivo: "CELULAR",
    stock: 5,
    stockReservado: 0,
    precioCompra: 100,
    precioVenta: 200,
    imagenUrl: null,
    ...extra,
  }) as Inventario

const ROJO = item("a1", "Funda X Rojo", { imagenUrl: "https://storage.test/rojo.jpg" })
const AZUL = item("a2", "Funda X Azul")

let fetchMock: ReturnType<typeof vi.fn>
const alCerrar = vi.fn()
const alAgrupar = vi.fn()

beforeEach(() => {
  manejadores.length = 0
  alCerrar.mockClear()
  alAgrupar.mockClear()
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ grupo: { id: "x" } }), { status: 200 }))
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function abrir(items: Inventario[] = [ROJO, AZUL]) {
  return render(<AgruparDialog open items={items} onClose={alCerrar} onAgrupado={alAgrupar} />)
}

const fila = (id: string) => screen.getByTestId(`item-${id}`)

function agregarValor(opcion: string, valor: string) {
  const entrada = screen.getByLabelText(`Valor nuevo de ${opcion}`)
  fireEvent.change(entrada, { target: { value: valor } })
  fireEvent.keyDown(entrada, { key: "Enter" })
}

function elegir(id: string, valor: string) {
  fireEvent.click(within(fila(id)).getByRole("option", { name: valor }))
}

/** Color {Rojo, Azul}, Rojo -> a1 and Azul -> a2. */
function completar() {
  agregarValor("Color", "Rojo")
  agregarValor("Color", "Azul")
  elegir("a1", "Rojo")
  elegir("a2", "Azul")
}

const confirmar = () => screen.getByRole("button", { name: "Agrupar" })
const cuerpoEnviado = () => JSON.parse((fetchMock.mock.calls.at(-1)![1] as RequestInit).body as string)
const urlEnviada = () => String(fetchMock.mock.calls.at(-1)![0])

describe("AgruparDialog: the items", () => {
  it("shows each item's own thumbnail, and a placeholder (no img) for one without a photo", () => {
    abrir()
    expect(within(fila("a1")).getByRole("img", { name: "Foto de Funda X Rojo" })).toHaveAttribute("src", "https://storage.test/rojo.jpg")
    expect(within(fila("a2")).queryByRole("img")).toBeNull()
  })

  it("never borrows a sibling's photo for the thumbnail", () => {
    abrir([ROJO, item("a2", "Funda X Azul", { imagenRespaldo: { url: "https://storage.test/prestada.jpg", etiqueta: "Rojo" } })])
    expect(within(fila("a2")).queryByRole("img")).toBeNull()
  })

  it("defaults the base name to the common word prefix, and it stays editable", () => {
    abrir()
    const base = screen.getByLabelText("Nombre del producto") as HTMLInputElement
    expect(base.value).toBe("Funda X")
    fireEvent.change(base, { target: { value: "Funda Premium" } })
    expect(base.value).toBe("Funda Premium")
  })

  it("an empty base name blocks the confirm", () => {
    abrir()
    completar()
    expect(confirmar()).toBeEnabled()
    fireEvent.change(screen.getByLabelText("Nombre del producto"), { target: { value: "  " } })
    expect(confirmar()).toBeDisabled()
    expect(screen.getByText("Escribí el nombre del producto")).toBeInTheDocument()
  })
})

describe("AgruparDialog: options and combinations", () => {
  it("starts with a Color option without values and nothing assigned, so the confirm is off", () => {
    abrir()
    expect(screen.getByLabelText("Nombre de la opción 1")).toHaveValue("Color")
    expect(confirmar()).toBeDisabled()
  })

  it("values typed with Enter become chips, can be removed, and feed every item's Select", () => {
    abrir()
    agregarValor("Color", "Rojo")
    agregarValor("Color", "Azul")
    expect(screen.getByText("Rojo", { selector: "[data-chip]" })).toBeInTheDocument()
    expect(within(fila("a1")).getAllByRole("option").map((o) => o.textContent)).toEqual(["Rojo", "Azul"])
    fireEvent.click(screen.getByRole("button", { name: "Quitar Azul" }))
    expect(within(fila("a1")).getAllByRole("option").map((o) => o.textContent)).toEqual(["Rojo"])
  })

  it("comma separated text adds several values at once, ignoring blanks and repeats", () => {
    abrir()
    agregarValor("Color", "Rojo, Azul, , rojo")
    expect(within(fila("a1")).getAllByRole("option").map((o) => o.textContent)).toEqual(["Rojo", "Azul"])
  })

  it("removing a chip drops the assignment that used it", () => {
    abrir()
    completar()
    expect(confirmar()).toBeEnabled()
    fireEvent.click(screen.getByRole("button", { name: "Quitar Azul" }))
    expect(confirmar()).toBeDisabled()
    expect(screen.getByText("Elegí la variante de cada producto")).toBeInTheDocument()
  })

  it("the same combination twice blocks the confirm and says so", () => {
    abrir()
    agregarValor("Color", "Rojo")
    agregarValor("Color", "Azul")
    elegir("a1", "Rojo")
    elegir("a2", "Rojo")
    expect(confirmar()).toBeDisabled()
    expect(screen.getByText("Dos productos tienen la misma combinación")).toBeInTheDocument()
    elegir("a2", "Azul")
    expect(confirmar()).toBeEnabled()
  })

  it("adds a second option with its own Select per item, up to three", () => {
    abrir()
    fireEvent.click(screen.getByRole("button", { name: "Agregar otra opción" }))
    expect(screen.getByLabelText("Nombre de la opción 2")).toBeInTheDocument()
    expect(within(fila("a1")).getAllByRole("combobox")).toHaveLength(2)
    fireEvent.click(screen.getByRole("button", { name: "Agregar otra opción" }))
    expect(screen.queryByRole("button", { name: "Agregar otra opción" })).toBeNull()
  })

  it("G11: an empty value echoed by a closed Select does not erase the assignment", () => {
    abrir()
    completar()
    expect(confirmar()).toBeEnabled()
    act(() => {
      for (const manejador of manejadores) manejador("")
    })
    expect(confirmar()).toBeEnabled()
    expect(within(fila("a1")).getAllByTestId("valor-elegido")[0]).toHaveTextContent("Rojo")
  })
})

describe("AgruparDialog: renaming (VB-2)", () => {
  it("'Renombrar productos' is checked by default and previews before and after for EVERY item", () => {
    abrir()
    completar()
    expect(screen.getByLabelText("Renombrar productos")).toBeChecked()
    for (const [id, antes, valor] of [["a1", "Funda X Rojo", "Rojo"], ["a2", "Funda X Azul", "Azul"]] as const) {
      const vista = screen.getByTestId(`vista-${id}`)
      expect(within(vista).getByText(antes)).toBeInTheDocument()
      expect(within(vista).getByText(nombreVariante("Funda X", [{ opcion: "Color", valor }]))).toBeInTheDocument()
    }
  })

  it("the preview follows the base name", () => {
    abrir()
    completar()
    fireEvent.change(screen.getByLabelText("Nombre del producto"), { target: { value: "Cámara" } })
    expect(within(screen.getByTestId("vista-a1")).getByText("Cámara - Rojo")).toBeInTheDocument()
  })

  it("unchecked: 'Sin cambios' for every item, a note about codes and barcodes, and renombrar:false in the body", async () => {
    abrir()
    completar()
    fireEvent.click(screen.getByLabelText("Renombrar productos"))
    expect(screen.getByLabelText("Renombrar productos")).not.toBeChecked()
    for (const id of ["a1", "a2"]) expect(within(screen.getByTestId(`vista-${id}`)).getByText("Sin cambios")).toBeInTheDocument()
    expect(screen.getByText(/códigos de barras no cambian/i)).toBeInTheDocument()

    fireEvent.click(confirmar())
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(cuerpoEnviado().grupo.renombrar).toBe(false)
  })

  it("checked: the body carries renombrar:true", async () => {
    abrir()
    completar()
    fireEvent.click(confirmar())
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(cuerpoEnviado().grupo.renombrar).toBe(true)
  })

  it("a fresh dialog starts checked again", () => {
    const { unmount } = abrir()
    completar()
    fireEvent.click(screen.getByLabelText("Renombrar productos"))
    unmount()
    abrir()
    expect(screen.getByLabelText("Renombrar productos")).toBeChecked()
  })
})

describe("AgruparDialog: items that cannot join", () => {
  it.each([
    ["a kit", { esKit: true }, "Es un kit y no puede ser una variante"],
    ["an archived item", { deletedAt: "2026-01-01" }, "Está archivado"],
    ["an item already in a group", { grupoId: "g-9" }, "Ya es parte de un grupo de variantes"],
  ])("%s is flagged with its reason and blocks the confirm until it is taken out", (_t, extra, motivo) => {
    abrir([ROJO, item("a2", "Funda X Azul", extra as Partial<Inventario>), item("a3", "Funda X Verde")])
    agregarValor("Color", "Rojo")
    agregarValor("Color", "Azul")
    agregarValor("Color", "Verde")
    elegir("a1", "Rojo")
    elegir("a3", "Verde")
    expect(within(fila("a2")).getByText(motivo)).toBeInTheDocument()
    expect(within(fila("a2")).queryByRole("combobox")).toBeNull()
    expect(confirmar()).toBeDisabled()

    fireEvent.click(within(fila("a2")).getByRole("button", { name: "Sacar de la lista" }))
    expect(screen.queryByTestId("item-a2")).toBeNull()
    expect(confirmar()).toBeEnabled()
  })

  it("with fewer than two items left the confirm stays off", () => {
    abrir([ROJO, item("a2", "Funda X Azul", { esKit: true })])
    fireEvent.click(within(fila("a2")).getByRole("button", { name: "Sacar de la lista" }))
    expect(confirmar()).toBeDisabled()
    expect(screen.getByText("Elegí al menos dos productos para agrupar")).toBeInTheDocument()
  })
})

describe("AgruparDialog: source of the shared fields (VB-3)", () => {
  const CON_DIFERENCIAS = () => [
    item("a1", "Funda X Rojo", { categoria: "Fundas", imagenUrl: "https://storage.test/rojo.jpg" }),
    item("a2", "Funda X Azul", { categoria: "Accesorios", imagenUrl: "https://storage.test/azul.jpg" }),
  ]

  it("no difference: no prompt and no source in the body", async () => {
    abrir()
    completar()
    expect(screen.queryByTestId("datos-distintos")).toBeNull()
    fireEvent.click(confirmar())
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(cuerpoEnviado()).not.toHaveProperty("fuenteCompartidosId")
  })

  it("lists the differing field with every item's value and requires a source", async () => {
    abrir(CON_DIFERENCIAS())
    completar()
    const bloque = screen.getByTestId("datos-distintos")
    expect(within(bloque).getByText("Categoría")).toBeInTheDocument()
    expect(within(bloque).getByText("Fundas")).toBeInTheDocument()
    expect(within(bloque).getByText("Accesorios")).toBeInTheDocument()
    expect(confirmar()).toBeDisabled()
    expect(screen.getByText("Elegí de qué producto se toman los datos")).toBeInTheDocument()

    fireEvent.click(within(bloque).getByRole("radio", { name: "Usar los datos de Funda X Azul" }))
    expect(confirmar()).toBeEnabled()
    fireEvent.click(confirmar())
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(cuerpoEnviado().fuenteCompartidosId).toBe("a2")
  })

  it("the photo never appears as a field (S3)", () => {
    abrir(CON_DIFERENCIAS())
    completar()
    const bloque = screen.getByTestId("datos-distintos")
    expect(within(bloque).queryByText(/foto|imagen/i)).toBeNull()
    expect(bloque.querySelector("img")).toBeNull()
    expect(bloque.textContent).not.toMatch(/jpg/)
  })
})

describe("AgruparDialog: saving", () => {
  it("sends PUT /api/inventario/grupos/{new client id} with the group and {id, atributos} per item", async () => {
    abrir()
    completar()
    fireEvent.click(confirmar())
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(urlEnviada()).toMatch(/^\/api\/inventario\/grupos\/c[0-9a-f]{24}$/)
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("PUT")
    expect(cuerpoEnviado()).toStrictEqual({
      grupo: { nombre: "Funda X", opciones: [{ nombre: "Color", valores: ["Rojo", "Azul"] }], renombrar: true },
      variantes: [
        { id: "a1", atributos: [{ opcion: "Color", valor: "Rojo" }] },
        { id: "a2", atributos: [{ opcion: "Color", valor: "Azul" }] },
      ],
    })
  })

  it("calls onAgrupado after a successful save", async () => {
    abrir()
    completar()
    fireEvent.click(confirmar())
    await waitFor(() => expect(alAgrupar).toHaveBeenCalledTimes(1))
  })

  it("a failed save shows the server message, stays open, and the retry reuses the SAME group id", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "Un producto ya pertenece a otro grupo de variantes", code: "ITEM_EN_OTRO_GRUPO" }), { status: 409 }))
    abrir()
    completar()
    fireEvent.click(confirmar())
    expect(await screen.findByText("Un producto ya pertenece a otro grupo de variantes")).toBeInTheDocument()
    expect(alAgrupar).not.toHaveBeenCalled()
    const primera = urlEnviada()

    fireEvent.click(confirmar())
    await waitFor(() => expect(alAgrupar).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(urlEnviada()).toBe(primera)
  })

  it("a network failure shows a retryable message", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"))
    abrir()
    completar()
    fireEvent.click(confirmar())
    expect(await screen.findByText("No pudimos agrupar los productos. Revisá la conexión y probá de nuevo")).toBeInTheDocument()
    expect(confirmar()).toBeEnabled()
  })

  it("a double click sends one request", async () => {
    let resolver: (r: Response) => void = () => {}
    fetchMock.mockImplementationOnce(() => new Promise<Response>((r) => (resolver = r)))
    abrir()
    completar()
    fireEvent.click(confirmar())
    fireEvent.click(screen.getByRole("button", { name: "Agrupando…" }))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await act(async () => resolver(new Response("{}", { status: 200 })))
    await waitFor(() => expect(alAgrupar).toHaveBeenCalledTimes(1))
  })

  it("Cancelar closes without a request", () => {
    abrir()
    completar()
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }))
    expect(alCerrar).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("renders nothing when closed", () => {
    render(<AgruparDialog open={false} items={[ROJO, AZUL]} onClose={alCerrar} onAgrupado={alAgrupar} />)
    expect(screen.queryByRole("dialog")).toBeNull()
  })
})

describe("AgruparDialog: tracking changes need an acknowledgement (VB-3 S2)", () => {
  const CON_SERIES = item("a1", "Funda X Rojo", { trackeaSeries: true, trackeaLotes: false })
  const SIN_SERIES = item("a2", "Funda X Azul", { trackeaSeries: false, trackeaLotes: false })

  function responder(respuestas: Record<string, unknown>, fallos: string[] = []) {
    fetchMock.mockImplementation(async (url: unknown) => {
      const href = String(url)
      if (fallos.some((f) => href.includes(f))) return new Response("{}", { status: 500 })
      const clave = Object.keys(respuestas).find((k) => href.startsWith(k))
      return new Response(JSON.stringify(clave ? respuestas[clave] : { data: [] }), { status: 200 })
    })
  }

  /** A request that stays open until the test resolves it. */
  function pendiente(prefijo: string) {
    let resolver: (r: Response) => void = () => {}
    fetchMock.mockImplementation((url: unknown) => {
      if (String(url).startsWith(prefijo)) return new Promise<Response>((r) => (resolver = r))
      return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }))
    })
    return (cuerpo: unknown) => act(async () => resolver(new Response(JSON.stringify(cuerpo), { status: 200 })))
  }

  function elegirOrigen(nombre: string) {
    fireEvent.click(within(screen.getByTestId("datos-distintos")).getByRole("radio", { name: `Usar los datos de ${nombre}` }))
  }
  const aviso = () => screen.getByTestId("aviso-seguimiento")
  const casillas = () => within(aviso()).queryAllByRole("checkbox")

  it("the status region exists from the start, empty, so what appears in it is announced", () => {
    responder({})
    abrir([CON_SERIES, SIN_SERIES])
    completar()
    expect(aviso()).toHaveAttribute("role", "status")
    expect(aviso()).toBeEmptyDOMElement()
  })

  it("asks nothing before a source is chosen", async () => {
    responder({})
    abrir([CON_SERIES, SIN_SERIES])
    completar()
    await act(async () => {})
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("while the check runs 'Agrupar' is off and says 'Revisando…'", async () => {
    const resolver = pendiente("/api/inventario/a1/series")
    abrir([CON_SERIES, SIN_SERIES])
    completar()
    elegirOrigen("Funda X Azul")
    const boton = await screen.findByRole("button", { name: "Revisando…" })
    expect(boton).toBeDisabled()
    await resolver({ data: [] })
    await waitFor(() => expect(confirmar()).toBeEnabled())
  })

  it("series loaded ('con'): names the product, states the consequence, and needs the checkbox", async () => {
    responder({ "/api/inventario/a1/series": { data: [{ id: "s1" }] } })
    abrir([CON_SERIES, SIN_SERIES])
    completar()
    elegirOrigen("Funda X Azul")

    await waitFor(() => expect(casillas()).toHaveLength(1))
    expect(aviso().textContent).toContain("Entiendo que Funda X Rojo deja de controlar series: las ventas van a descontar stock sin marcar series vendidas")
    expect(aviso().textContent).toContain("Las series que ya cargaste se conservan")
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/inventario/a1/series?limit=1")
    expect(confirmar()).toBeDisabled()
    fireEvent.click(casillas()[0])
    expect(confirmar()).toBeEnabled()
    fireEvent.click(casillas()[0])
    expect(confirmar()).toBeDisabled()
  })

  it("lots loaded ('con') need the checkbox too", async () => {
    responder({ "/api/inventario/a1/lotes": { data: [{ id: "l1" }] } })
    abrir([item("a1", "Funda X Rojo", { trackeaLotes: true }), item("a2", "Funda X Azul", { trackeaLotes: false })])
    completar()
    elegirOrigen("Funda X Azul")
    await waitFor(() => expect(casillas()).toHaveLength(1))
    expect(aviso().textContent).toContain("Entiendo que Funda X Rojo deja de controlar lotes: no vas a ver sus lotes ni sus avisos de vencimiento. Los lotes que ya cargaste se conservan.")
    // Sales never read lots: the text must not claim they do.
    expect(aviso().textContent).not.toMatch(/ventas/)
    expect(confirmar()).toBeDisabled()
    fireEvent.click(casillas()[0])
    expect(confirmar()).toBeEnabled()
  })

  it("lots failed check ('error') needs the checkbox with the accurate effect", async () => {
    responder({}, ["/lotes"])
    abrir([item("a1", "Funda X Rojo", { trackeaLotes: true }), item("a2", "Funda X Azul", { trackeaLotes: false })])
    completar()
    elegirOrigen("Funda X Azul")
    await waitFor(() => expect(casillas()).toHaveLength(1))
    expect(aviso().textContent).toMatch(/no pudimos revisar/i)
    expect(aviso().textContent).toMatch(/no vas a ver sus lotes ni sus avisos de vencimiento/)
    expect(aviso().textContent).not.toMatch(/ventas/)
  })

  it("a failed series check uses the feminine: series cargadas", async () => {
    responder({}, ["/series"])
    abrir([CON_SERIES, SIN_SERIES])
    completar()
    elegirOrigen("Funda X Azul")
    await waitFor(() => expect(casillas()).toHaveLength(1))
    expect(aviso().textContent).toContain("si tiene series cargadas, las ventas no las van a marcar como vendidas")
  })

  it("a failed check ('error') needs the checkbox and says it could not verify", async () => {
    responder({}, ["/series"])
    abrir([CON_SERIES, SIN_SERIES])
    completar()
    elegirOrigen("Funda X Azul")
    await waitFor(() => expect(casillas()).toHaveLength(1))
    expect(aviso().textContent).toMatch(/no pudimos revisar/i)
    expect(confirmar()).toBeDisabled()
    fireEvent.click(casillas()[0])
    expect(confirmar()).toBeEnabled()
  })

  it("nothing loaded ('sin'): no checkbox and the button is enabled once the check ends", async () => {
    responder({ "/api/inventario/a1/series": { data: [] } })
    abrir([CON_SERIES, SIN_SERIES])
    completar()
    elegirOrigen("Funda X Azul")
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await waitFor(() => expect(confirmar()).toBeEnabled())
    expect(casillas()).toHaveLength(0)
    expect(aviso()).toBeEmptyDOMElement()
  })

  it("tracking turned ON: the item will ask for series when sold; it needs the checkbox and no request is made", async () => {
    responder({})
    abrir([CON_SERIES, SIN_SERIES])
    completar()
    elegirOrigen("Funda X Rojo")
    await waitFor(() => expect(casillas()).toHaveLength(1))
    expect(aviso().textContent).toContain("Entiendo que Funda X Azul va a pedir series al venderlo: si no tiene series cargadas")
    expect(aviso().textContent).toMatch(/no se va a poder vender hasta cargarlas/i)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(confirmar()).toBeDisabled()
    fireEvent.click(casillas()[0])
    expect(confirmar()).toBeEnabled()
  })

  it("lots turned ON are informative only: no checkbox, the button stays enabled, and nothing claims sales ask for lots", async () => {
    responder({})
    abrir([item("a1", "Funda X Rojo", { trackeaLotes: true }), item("a2", "Funda X Azul", { trackeaLotes: false })])
    completar()
    elegirOrigen("Funda X Rojo")
    await waitFor(() => expect(aviso().textContent).toContain("Funda X Azul va a controlar lotes: vas a ver sus lotes y vencimientos."))
    expect(casillas()).toHaveLength(0)
    expect(aviso().textContent).not.toMatch(/Entiendo|vender/)
    expect(confirmar()).toBeEnabled()
  })

  it("both directions at once: the series OFF needs its checkbox, the lots ON is only a note", async () => {
    responder({ "/api/inventario/a1/series": { data: [{ id: "s1" }] } })
    const a = item("a1", "Funda X Rojo", { trackeaSeries: true, trackeaLotes: false })
    const b = item("a2", "Funda X Azul", { trackeaSeries: false, trackeaLotes: true })
    abrir([a, b])
    completar()
    elegirOrigen("Funda X Azul")
    await waitFor(() => expect(casillas()).toHaveLength(1))
    expect(aviso().textContent).toContain("Funda X Rojo va a controlar lotes")
    expect(confirmar()).toBeDisabled()
    fireEvent.click(casillas()[0])
    expect(confirmar()).toBeEnabled()
  })

  it("switching to another source and back requires ticking again", async () => {
    responder({ "/api/inventario/a1/series": { data: [{ id: "s1" }] } })
    abrir([CON_SERIES, SIN_SERIES])
    completar()
    elegirOrigen("Funda X Azul")
    await waitFor(() => expect(casillas()).toHaveLength(1))
    fireEvent.click(casillas()[0])
    expect(confirmar()).toBeEnabled()
    elegirOrigen("Funda X Rojo")
    await waitFor(() => expect(aviso().textContent).toMatch(/va a pedir series/))
    elegirOrigen("Funda X Azul")
    await waitFor(() => expect(casillas()).toHaveLength(1))
    expect(casillas()[0]).not.toBeChecked()
    expect(confirmar()).toBeDisabled()
  })

  describe("why the button is off", () => {
    const quefalta = () => screen.getByLabelText("Qué falta")

    it("while a check is pending it says to wait", async () => {
      pendiente("/api/inventario/a1/series")
      abrir([CON_SERIES, SIN_SERIES])
      completar()
      elegirOrigen("Funda X Azul")
      await screen.findByRole("button", { name: "Revisando…" })
      expect(quefalta().textContent).toContain("Esperá que terminemos de revisar series y lotes")
    })

    it("with an acknowledgement missing it says to confirm, and the line goes away once ticked", async () => {
      responder({ "/api/inventario/a1/series": { data: [{ id: "s1" }] } })
      abrir([CON_SERIES, SIN_SERIES])
      completar()
      elegirOrigen("Funda X Azul")
      await waitFor(() => expect(casillas()).toHaveLength(1))
      expect(quefalta().textContent).toContain("Confirmá los cambios de series y lotes")
      fireEvent.click(casillas()[0])
      expect(screen.queryByLabelText("Qué falta")).toBeNull()
    })
  })

  describe("a check that never answers", () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it("after 8 seconds it counts as 'error': the button leaves 'Revisando…' and asks for the checkbox", async () => {
      fetchMock.mockImplementation((url: unknown) =>
        String(url).includes("/series") ? new Promise<Response>(() => {}) : Promise.resolve(new Response("{}", { status: 200 }))
      )
      abrir([CON_SERIES, SIN_SERIES])
      completar()
      elegirOrigen("Funda X Azul")
      expect(screen.getByRole("button", { name: "Revisando…" })).toBeDisabled()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(7_900)
      })
      expect(screen.getByRole("button", { name: "Revisando…" })).toBeDisabled()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200)
      })
      expect(screen.queryByRole("button", { name: "Revisando…" })).toBeNull()
      expect(casillas()).toHaveLength(1)
      expect(aviso().textContent).toMatch(/no pudimos revisar/i)
      expect(confirmar()).toBeDisabled()
      fireEvent.click(casillas()[0])
      expect(confirmar()).toBeEnabled()
    })
  })

  it("changing the source re-evaluates: a new set of consequences needs its own acknowledgement", async () => {
    responder({ "/api/inventario/a1/series": { data: [{ id: "s1" }] } })
    abrir([CON_SERIES, SIN_SERIES])
    completar()
    elegirOrigen("Funda X Azul")
    await waitFor(() => expect(casillas()).toHaveLength(1))
    fireEvent.click(casillas()[0])
    expect(confirmar()).toBeEnabled()
    elegirOrigen("Funda X Rojo")
    await waitFor(() => expect(aviso().textContent).toMatch(/va a pedir series/))
    expect(casillas()[0]).not.toBeChecked()
    expect(confirmar()).toBeDisabled()
  })

  it("the warning sits with the source choice, inside the same block", () => {
    responder({})
    abrir([CON_SERIES, SIN_SERIES])
    completar()
    expect(screen.getByTestId("datos-distintos").contains(aviso())).toBe(true)
  })

  it("nothing is written for series or lots: the save sends no tracking data of its own", async () => {
    responder({ "/api/inventario/a1/series": { data: [{ id: "s1" }] } })
    abrir([CON_SERIES, SIN_SERIES])
    completar()
    elegirOrigen("Funda X Azul")
    await waitFor(() => expect(casillas()).toHaveLength(1))
    fireEvent.click(casillas()[0])
    fireEvent.click(confirmar())
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === "PUT")).toBe(true))
    const put = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "PUT")!
    const cuerpo = JSON.parse((put[1] as RequestInit).body as string)
    expect(cuerpo.fuenteCompartidosId).toBe("a2")
    expect(JSON.stringify(cuerpo)).not.toMatch(/serie|lote/i)
  })

  describe("default source", () => {
    const tres = () => [
      item("a1", "Funda X Rojo", { trackeaSeries: true }),
      item("a2", "Funda X Azul", { trackeaSeries: true }),
      item("a3", "Funda X Verde", { trackeaSeries: false }),
    ]

    it("with a majority, the source that flips the fewest is preselected", () => {
      responder({})
      abrir(tres())
      expect(screen.getByRole("radio", { name: "Usar los datos de Funda X Rojo" })).toBeChecked()
      expect(screen.getByRole("radio", { name: "Usar los datos de Funda X Azul" })).not.toBeChecked()
    })

    it("on a tie nothing is preselected and the choice stays required", () => {
      responder({})
      abrir([CON_SERIES, SIN_SERIES])
      completar()
      expect(screen.getByRole("radio", { name: "Usar los datos de Funda X Rojo" })).not.toBeChecked()
      expect(screen.getByRole("radio", { name: "Usar los datos de Funda X Azul" })).not.toBeChecked()
      expect(screen.getByText("Elegí de qué producto se toman los datos")).toBeInTheDocument()
    })

    it("the user can change the preselected source", () => {
      responder({})
      abrir(tres())
      fireEvent.click(screen.getByRole("radio", { name: "Usar los datos de Funda X Verde" }))
      expect(screen.getByRole("radio", { name: "Usar los datos de Funda X Verde" })).toBeChecked()
    })
  })
})
