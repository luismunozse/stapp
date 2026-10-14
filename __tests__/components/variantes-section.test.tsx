import { describe, it, expect, vi } from "vitest"
import { useReducer, useState } from "react"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { VariantesSection } from "@/components/inventario/variantes/variantes-section"
import { crearReductor, estadoInicial, stockTotal, type VariantesState } from "@/lib/variantes-filas"
import { aplicar, reductor, filaDe, grupoColor, grupoColorTalle, hidratar, leida, opcionId, valorId } from "../helpers/variantes-filas"
import { estadoActivo, estadoColor, montar } from "../helpers/variantes-ui"

vi.mock("@/components/inventario/quick-stock-adjust", () => ({
  QuickStockAdjust: (p: { currentStock: number; onAdjusted: () => void }) => (
    <button type="button" onClick={p.onAdjusted}>
      {p.currentStock}
    </button>
  ),
}))

interface Props {
  motivoDeshabilitado?: string | null
  guardando?: boolean
  alAjustarStock?: () => void
}

const montarSeccion = (inicial: VariantesState, props: Props = {}) =>
  montar(inicial, (estado, dispatch) => <VariantesSection estado={estado} dispatch={dispatch} {...props} />)

const apagado = () => estadoInicial({ grupoId: "g-nuevo", semilla: "ui-de-prueba", codigoBase: "FX", precioBase: 1000, costoCargado: true })

// Every row is in the DOM twice (table and card; jsdom cannot tell which one `sm:` shows): use the table's.
const escribir = (etiqueta: string, valor: string) => {
  const campo = screen.getAllByLabelText(etiqueta)[0]
  fireEvent.change(campo, { target: { value: valor } })
  fireEvent.blur(campo)
}

describe("VariantesSection: the switch", () => {
  it("starts with the switch first, off, and nothing else to edit", () => {
    montarSeccion(apagado())
    const interruptor = screen.getByRole("switch", { name: "Este producto tiene variantes" })
    expect(interruptor).not.toBeChecked()
    expect(interruptor).toBeEnabled()
    expect(screen.queryByRole("group", { name: "Opciones de las variantes" })).toBeNull()
    expect(screen.queryByText("Stock total")).toBeNull()
    expect(screen.getByText(/cada una con su precio y su stock/)).toBeInTheDocument()
  })

  it("the switch is the first control inside the section, right after the header", () => {
    const { container } = montarSeccion(estadoColor())
    const controles = Array.from(container.querySelectorAll("button, input, select, textarea"))
    expect(controles[0]).toBe(screen.getByRole("button", { name: /Variantes/ }))
    expect(controles[1]).toBe(screen.getByRole("switch"))
    expect(controles.length).toBeGreaterThan(10)
  })

  it("turning it on shows the editor; turning it off hides it again", () => {
    const { salida } = montarSeccion(apagado())
    fireEvent.click(screen.getByRole("switch"))
    expect(salida.acciones).toEqual([{ tipo: "activar" }])
    expect(salida.estado.activo).toBe(true)
    expect(screen.getByRole("group", { name: "Opciones de las variantes" })).toBeInTheDocument()
    expect(screen.getByRole("switch")).toBeChecked()
    // The sales pitch is for the product that has no variants yet.
    expect(screen.queryByText(/cada una con su precio y su stock/)).toBeNull()

    fireEvent.click(screen.getByRole("switch"))
    expect(salida.acciones.at(-1)).toEqual({ tipo: "desactivar" })
    expect(screen.queryByRole("group", { name: "Opciones de las variantes" })).toBeNull()
  })

  it("a reason locks the switch and is read with it (a kit cannot have variants)", () => {
    const { salida } = montarSeccion(apagado(), { motivoDeshabilitado: "Un kit no puede tener variantes" })
    const interruptor = screen.getByRole("switch", { name: "Este producto tiene variantes" })
    expect(interruptor).toBeDisabled()
    expect(screen.getByText("Un kit no puede tener variantes")).toBeInTheDocument()
    expect(interruptor).toHaveAccessibleDescription("Un kit no puede tener variantes")
    fireEvent.click(interruptor)
    expect(salida.acciones).toEqual([])
  })

  it("without a reason the switch has no description to read", () => {
    montarSeccion(apagado())
    expect(screen.getByRole("switch")).not.toHaveAccessibleDescription(/kit/)
    expect(screen.getByRole("switch")).toBeEnabled()
  })

  it("saving locks the switch and everything under it", () => {
    montarSeccion(estadoColor({ costoCargado: true }), { guardando: true })
    expect(screen.getByRole("switch")).toBeDisabled()
    expect(screen.getByLabelText("Valor Rojo")).toBeDisabled()
    expect(screen.getAllByLabelText("Código de Rojo").every((c) => (c as HTMLInputElement).disabled)).toBe(true)
    expect(screen.getByRole("button", { name: "Aplicar precio a todas" })).toBeDisabled()
  })
})

describe("VariantesSection: the header", () => {
  it("counts the active combinations in the badge", () => {
    montarSeccion(estadoColor())
    expect(screen.getByText("2 variantes")).toBeInTheDocument()
  })

  it("says 1 variante in the singular and does not count rows pending archive", () => {
    const guardado = hidratar(grupoColor())
    montarSeccion(aplicar(reductor(), guardado, { tipo: "quitarValor", valorId: valorId(guardado, "Color", "Rojo") }))
    expect(screen.getByText("1 variante")).toBeInTheDocument()
    expect(screen.queryByText("2 variantes")).toBeNull()
  })

  it("shows no badge while the switch is off", () => {
    montarSeccion(apagado())
    expect(screen.queryByText(/^\d+ variantes?$/)).toBeNull()
  })

  it("is a collapsible section titled Variantes", () => {
    montarSeccion(estadoColor())
    const cabecera = screen.getByRole("button", { name: /Variantes/ })
    expect(cabecera).toHaveAttribute("aria-expanded", "true")
    fireEvent.click(cabecera)
    expect(screen.queryByRole("switch")).toBeNull()
  })
})

describe("VariantesSection: building the variants", () => {
  it("guides the first steps from an empty product to priced combinations", () => {
    const { salida } = montarSeccion(apagado())
    fireEvent.click(screen.getByRole("switch"))

    expect(screen.getByText(/Agregá una opción/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("Nombre de la nueva opción"), { target: { value: "Color" } })
    fireEvent.keyDown(screen.getByLabelText("Nombre de la nueva opción"), { key: "Enter" })
    fireEvent.change(screen.getByLabelText("Agregar valor a Color"), { target: { value: "Rojo, Azul," } })

    expect(screen.queryByText(/Agregá una opción/)).toBeNull()
    expect(screen.getByText("2 variantes")).toBeInTheDocument()
    expect(screen.getAllByLabelText("Código de Rojo")).toHaveLength(2)
    escribir("Precio de Rojo", "1500")
    expect(filaDe(salida.estado, "Rojo").precioVenta).toBe(1500)
    expect(filaDe(salida.estado, "Azul").precioVenta).toBe(1000)
  })

  it("renders the table and the cards together, each with its class contract (jsdom cannot evaluate sm:)", () => {
    montarSeccion(estadoColor())
    const tabla = screen.getByRole("table").parentElement!
    expect(tabla).toHaveClass("hidden", "sm:block")
    const tarjeta = screen.getByRole("heading", { level: 3, name: "Rojo" }).closest("article")!
    expect(tarjeta).toHaveClass("sm:hidden")
    expect(tarjeta.parentElement).toHaveClass("sm:hidden")
  })

  it("shows the cost column only when the role has cost access", () => {
    const { unmount } = montarSeccion(estadoColor({ costoCargado: true }))
    expect(screen.getByRole("columnheader", { name: "Costo" })).toBeInTheDocument()
    expect(screen.getAllByLabelText("Costo de Rojo")).toHaveLength(2)
    unmount()
    montarSeccion(estadoColor({ costoCargado: false }))
    expect(screen.queryByRole("columnheader", { name: "Costo" })).toBeNull()
    expect(screen.queryAllByLabelText(/^Costo de /)).toEqual([])
  })

  it("blocks at 100 combinations: says so, and refuses the value that would pass it", () => {
    const diez = Array.from({ length: 10 }, (_, i) => `V${i + 1}`)
    const lleno = aplicar(
      reductor(),
      estadoActivo(),
      { tipo: "agregarOpcion", nombre: "Color", valores: diez },
      { tipo: "agregarOpcion", nombre: "Talle", valores: diez }
    )
    const { salida } = montarSeccion(lleno)
    expect(screen.getByText("100 variantes")).toBeInTheDocument()
    expect(screen.getByText("Llegaste al máximo de 100 variantes")).toBeInTheDocument()

    const entrada = screen.getByLabelText("Agregar valor a Color")
    fireEvent.change(entrada, { target: { value: "V11" } })
    fireEvent.keyDown(entrada, { key: "Enter" })
    expect(salida.estado.opciones[0].valores).toHaveLength(10)
    expect(screen.getByRole("status", { name: "Aviso" })).toHaveTextContent("Las opciones generan 110 combinaciones y el máximo es 100")
  })

  it("below the limit there is no limit message, not even one short of it", () => {
    montarSeccion(estadoColor())
    expect(screen.queryByText(/Llegaste al máximo de 100/)).toBeNull()
  })

  it("99 combinations is still one short of the limit", () => {
    const nueve = Array.from({ length: 9 }, (_, i) => `V${i + 1}`)
    const once = Array.from({ length: 11 }, (_, i) => `T${i + 1}`)
    montarSeccion(
      aplicar(reductor(), estadoActivo(), { tipo: "agregarOpcion", nombre: "Color", valores: nueve }, { tipo: "agregarOpcion", nombre: "Talle", valores: once })
    )
    expect(screen.getByText("99 variantes")).toBeInTheDocument()
    expect(screen.queryByText(/Llegaste al máximo de 100/)).toBeNull()
  })
})

describe("VariantesSection: the reason an action was refused", () => {
  it("has a status region from the start, empty, so a screen reader hears the first message", () => {
    montarSeccion(estadoColor())
    const estado = screen.getByRole("status", { name: "Aviso" })
    expect(estado).toBeEmptyDOMElement()
    expect(estado).toHaveAttribute("aria-live", "polite")
  })

  it("shows what the reducer said when a value is refused", () => {
    montarSeccion(estadoColor())
    const entrada = screen.getByLabelText("Agregar valor a Color")
    fireEvent.change(entrada, { target: { value: "rojo" } })
    fireEvent.keyDown(entrada, { key: "Enter" })
    expect(screen.getByRole("status", { name: "Aviso" })).toHaveTextContent('El valor "rojo" está repetido en Color')
  })

  it("shows the refusal of an undo that cannot be done", () => {
    const inicial = hidratar(grupoColorTalle())
    montarSeccion(aplicar(reductor(), inicial, { tipo: "quitarOpcion", opcionId: opcionId(inicial, "Talle") }))
    fireEvent.click(screen.getAllByRole("button", { name: /^Deshacer archivo de / })[0])
    expect(screen.getByRole("status", { name: "Aviso" })).toHaveTextContent('Para deshacerlo, volvé a agregar la opción "Talle"')
  })

  it("clears the message once an action goes through", () => {
    montarSeccion(estadoColor())
    const entrada = screen.getByLabelText("Agregar valor a Color")
    fireEvent.change(entrada, { target: { value: "rojo" } })
    fireEvent.keyDown(entrada, { key: "Enter" })
    expect(screen.getByRole("status", { name: "Aviso" })).not.toBeEmptyDOMElement()
    fireEvent.change(entrada, { target: { value: "Verde" } })
    fireEvent.keyDown(entrada, { key: "Enter" })
    expect(screen.getByRole("status", { name: "Aviso" })).toBeEmptyDOMElement()
  })
})

describe("VariantesSection: Stock total", () => {
  it("is a read-only sum of the active rows: saved stock plus the initial stock of the new ones", () => {
    const guardado = hidratar(grupoColor())
    const conNegro = aplicar(reductor(), guardado, { tipo: "agregarValor", opcionId: opcionId(guardado, "Color"), texto: "Negro" })
    const { salida } = montarSeccion(conNegro)
    expect(screen.getByText("Stock total").nextElementSibling).toHaveTextContent("8")
    escribir("Stock inicial de Negro", "4")
    expect(screen.getByText("Stock total").nextElementSibling).toHaveTextContent("12")
    expect(stockTotal(salida.estado)).toBe(12)
    // It is a figure, not a field.
    expect(screen.queryByRole("textbox", { name: /Stock total/ })).toBeNull()
  })

  it("leaves out the rows pending archive", () => {
    const guardado = hidratar(grupoColor())
    montarSeccion(aplicar(reductor(), guardado, { tipo: "quitarValor", valorId: valorId(guardado, "Color", "Rojo") }))
    expect(screen.getByText("Stock total").nextElementSibling).toHaveTextContent("3")
  })
})

describe("VariantesSection: Aplicar precio a todas", () => {
  it("applies the base price straight away when no row would change", () => {
    const { salida } = montarSeccion(estadoColor())
    fireEvent.click(screen.getByRole("button", { name: "Aplicar precio a todas" }))
    expect(salida.acciones.at(-1)).toEqual({ tipo: "aplicarPrecioATodas" })
    expect(screen.queryByText(/¿Cambiar el precio/)).toBeNull()
  })

  it("asks first when it would overwrite a price somebody typed, saying how many", () => {
    const { salida } = montarSeccion(estadoColor())
    escribir("Precio de Rojo", "1500")
    const antes = salida.acciones.length
    fireEvent.click(screen.getByRole("button", { name: "Aplicar precio a todas" }))
    expect(salida.acciones).toHaveLength(antes)
    expect(screen.getByText("¿Cambiar el precio de 1 variante?")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }))
    expect(screen.queryByText(/¿Cambiar el precio/)).toBeNull()
    expect(filaDe(salida.estado, "Rojo").precioVenta).toBe(1500)

    fireEvent.click(screen.getByRole("button", { name: "Aplicar precio a todas" }))
    fireEvent.click(screen.getByRole("button", { name: "Sí, cambiar" }))
    expect(salida.acciones.at(-1)).toEqual({ tipo: "aplicarPrecioATodas" })
    expect(filaDe(salida.estado, "Rojo").precioVenta).toBe(1000)
    expect(screen.queryByText(/¿Cambiar el precio/)).toBeNull()
  })

  it("counts every row it would change, in the plural", () => {
    const guardado = hidratar(grupoColor(), { precioBase: 700 })
    montarSeccion(guardado)
    fireEvent.click(screen.getByRole("button", { name: "Aplicar precio a todas" }))
    expect(screen.getByText("¿Cambiar el precio de 2 variantes?")).toBeInTheDocument()
  })

  it("asks for a row brought back from the archive even when its price looks like the base: its real price is unknown", () => {
    const guardado = hidratar(grupoColor())
    const conVerde = aplicar(reductor(), guardado, { tipo: "agregarValor", opcionId: opcionId(guardado, "Color"), texto: "Verde" })
    expect(filaDe(conVerde, "Verde").precioVenta).toBe(conVerde.precioBase)
    montarSeccion(conVerde)
    fireEvent.click(screen.getByRole("button", { name: "Aplicar precio a todas" }))
    expect(screen.getByText("¿Cambiar el precio de 1 variante?")).toBeInTheDocument()
  })

  it("does not count a row that is pending archive: its price is not going to change anything", () => {
    const lectura = grupoColor()
    const guardado = hidratar({
      ...lectura,
      variantes: [leida("r1", [{ opcion: "Color", valor: "Rojo" }], { stock: 5, precioVenta: 1500 }), ...lectura.variantes.slice(1)],
    })
    const sinRojo = aplicar(reductor(), guardado, { tipo: "quitarValor", valorId: valorId(guardado, "Color", "Rojo") })
    const { salida } = montarSeccion(sinRojo)
    fireEvent.click(screen.getByRole("button", { name: "Aplicar precio a todas" }))
    expect(screen.queryByText(/¿Cambiar el precio/)).toBeNull()
    expect(salida.acciones.at(-1)).toEqual({ tipo: "aplicarPrecioATodas" })
  })

  it("is not offered with no combinations", () => {
    montarSeccion(estadoActivo())
    expect(screen.queryByRole("button", { name: "Aplicar precio a todas" })).toBeNull()
  })
})

describe("VariantesSection: warnings before saving", () => {
  it("the warning's region exists, empty, before anything is archived, and the text appears inside that same node", () => {
    montarSeccion(hidratar(grupoColor()))
    const region = screen.getByRole("status", { name: "Variantes con stock que se archivan" })
    expect(region).toBeEmptyDOMElement()
    expect(region).toHaveAttribute("aria-live", "polite")

    fireEvent.click(screen.getByRole("button", { name: "Quitar Rojo de Color" }))
    expect(screen.getByRole("status", { name: "Variantes con stock que se archivan" })).toBe(region)
    expect(region).toHaveTextContent("Se van a archivar variantes con stock")
    expect(region).toHaveTextContent("Rojo")

    fireEvent.click(screen.getAllByRole("button", { name: "Deshacer archivo de Rojo" })[0])
    expect(screen.getByRole("status", { name: "Variantes con stock que se archivan" })).toBe(region)
    expect(region).toBeEmptyDOMElement()
  })

  const sinRojoConStock = () => {
    const guardado = hidratar(grupoColor())
    return aplicar(reductor(), guardado, { tipo: "quitarValor", valorId: valorId(guardado, "Color", "Rojo") })
  }

  it("warns about saved rows that will be archived with stock, with their units", () => {
    montarSeccion(sinRojoConStock())
    const alerta = screen.getByRole("status", { name: "Variantes con stock que se archivan" })
    expect(alerta).toHaveTextContent("Se van a archivar variantes con stock")
    expect(within(alerta).getByText("Rojo")).toBeInTheDocument()
    expect(alerta).toHaveTextContent("5 unidades")
    expect(alerta).toHaveTextContent("El stock se conserva")
  })

  it("lists each row, and the warning goes away once the undo is pressed", () => {
    const inicial = hidratar(grupoColorTalle())
    montarSeccion(aplicar(reductor(), inicial, { tipo: "quitarValor", valorId: valorId(inicial, "Talle", "S") }))
    const alerta = screen.getByRole("status", { name: "Variantes con stock que se archivan" })
    expect(within(alerta).getByText("Rojo / S")).toBeInTheDocument()
    expect(within(alerta).getByText("Azul / S")).toBeInTheDocument()
    expect(alerta).toHaveTextContent("1 unidad")
    expect(alerta).toHaveTextContent("3 unidades")

    fireEvent.click(screen.getAllByRole("button", { name: "Deshacer archivo de Rojo / S" })[0])
    expect(screen.getByRole("status", { name: "Variantes con stock que se archivan" })).toBeEmptyDOMElement()
  })

  it("does not warn about new rows, rows without stock, or rows with reserved units (those block instead)", () => {
    const nuevas = estadoColor()
    const { unmount } = montarSeccion(aplicar(reductor(), nuevas, { tipo: "quitarValor", valorId: valorId(nuevas, "Color", "Rojo") }))
    expect(screen.getByRole("status", { name: "Variantes con stock que se archivan" })).toBeEmptyDOMElement()
    unmount()

    const guardado = hidratar({
      ...grupoColor(),
      variantes: [leida("r1", [{ opcion: "Color", valor: "Rojo" }], { stock: 0 }), ...grupoColor().variantes.slice(1)],
    })
    montarSeccion(aplicar(reductor(), guardado, { tipo: "quitarValor", valorId: valorId(guardado, "Color", "Rojo") }))
    expect(screen.getByRole("status", { name: "Variantes con stock que se archivan" })).toBeEmptyDOMElement()
  })

  it("shows why a row cannot be archived once, on the row, and not again in the list of what is missing", () => {
    const reservada = hidratar({
      ...grupoColor(),
      variantes: [leida("r1", [{ opcion: "Color", valor: "Rojo" }], { stock: 5, stockReservado: 2 }), ...grupoColor().variantes.slice(1)],
    })
    montarSeccion(aplicar(reductor(), reservada, { tipo: "quitarValor", valorId: valorId(reservada, "Color", "Rojo") }))
    const motivo = 'No se puede archivar "Rojo": tiene 2 unidades reservadas'
    expect(screen.getAllByText(motivo)).toHaveLength(2) // the table row and the card
    expect(screen.queryByText("Para guardar, falta:")).toBeNull()
    // And it does not also claim the stock will be archived.
    expect(screen.queryByText("Se van a archivar variantes con stock")).toBeNull()
  })

  it("lists what is missing to save: codes that are blank or repeated", () => {
    const { salida } = montarSeccion(estadoColor())
    fireEvent.change(screen.getAllByLabelText("Código de Rojo")[0], { target: { value: "" } })
    const faltante = screen.getByText("Para guardar, falta:")
    expect(faltante.nextElementSibling).toHaveTextContent('Falta el código de "Rojo"')

    fireEvent.change(screen.getAllByLabelText("Código de Rojo")[0], { target: { value: "AB" } })
    fireEvent.change(screen.getAllByLabelText("Código de Azul")[0], { target: { value: "ab" } })
    expect(screen.getByText("Para guardar, falta:").nextElementSibling).toHaveTextContent('El código "AB" está repetido')

    fireEvent.change(screen.getAllByLabelText("Código de Azul")[0], { target: { value: "AZ" } })
    expect(screen.queryByText("Para guardar, falta:")).toBeNull()
    expect(filaDe(salida.estado, "Azul").codigo).toBe("AZ")
  })

  it("says nothing is missing while the switch is off", () => {
    montarSeccion(apagado())
    expect(screen.queryByText("Para guardar, falta:")).toBeNull()
  })
})

describe("VariantesSection: the same message twice", () => {
  const rechazar = () => {
    const entrada = screen.getByLabelText("Agregar valor a Color")
    fireEvent.change(entrada, { target: { value: "rojo" } })
    fireEvent.keyDown(entrada, { key: "Enter" })
  }

  it("is announced again: the text is put in the live region as a new node each time, and the region itself stays", () => {
    montarSeccion(estadoColor())
    const region = screen.getByRole("status", { name: "Aviso" })
    rechazar()
    const primero = region.firstElementChild
    expect(primero).toHaveTextContent('El valor "rojo" está repetido en Color')

    rechazar()
    const segundo = region.firstElementChild
    expect(segundo).toHaveTextContent('El valor "rojo" está repetido en Color')
    expect(segundo).not.toBe(primero)
    expect(primero?.isConnected).toBe(false)
    expect(screen.getByRole("status", { name: "Aviso" })).toBe(region)
  })
})

describe("VariantesSection: confirming Aplicar precio a todas", () => {
  const conPrecioDistinto = () => {
    const { salida } = montarSeccion(estadoColor())
    escribir("Precio de Rojo", "1500")
    fireEvent.click(screen.getByRole("button", { name: "Aplicar precio a todas" }))
    return salida
  }

  it("moves the focus to the first button of the question, so the keyboard user lands on it", () => {
    conPrecioDistinto()
    expect(screen.getByRole("button", { name: "Cancelar" })).toHaveFocus()
  })

  it("names the question (an inline, non-modal group read as its question) and describes what happens", () => {
    conPrecioDistinto()
    const grupo = screen.getByRole("group", { name: "¿Cambiar el precio de 1 variante?" })
    expect(grupo).toHaveAccessibleDescription("Todas pasan a tener el precio base.")
    expect(within(grupo).getAllByRole("button")).toHaveLength(2)
  })

  it("gives the focus back to the trigger on Cancelar", () => {
    conPrecioDistinto()
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }))
    expect(screen.getByRole("button", { name: "Aplicar precio a todas" })).toHaveFocus()
  })

  it("and on 'Sí, cambiar', after applying the price", () => {
    const salida = conPrecioDistinto()
    fireEvent.click(screen.getByRole("button", { name: "Sí, cambiar" }))
    expect(filaDe(salida.estado, "Rojo").precioVenta).toBe(1000)
    expect(screen.getByRole("button", { name: "Aplicar precio a todas" })).toHaveFocus()
  })

  it("does not steal the focus when it applies straight away", () => {
    montarSeccion(estadoColor())
    const boton = screen.getByRole("button", { name: "Aplicar precio a todas" })
    boton.focus()
    fireEvent.click(boton)
    expect(screen.getByRole("button", { name: "Aplicar precio a todas" })).toHaveFocus()
  })

  it("locks both answers while a save runs", () => {
    function Anfitrion() {
      const [estado, dispatch] = useReducer(crearReductor(), estadoColor())
      const [guardando, setGuardando] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setGuardando(true)}>
            guardar
          </button>
          <VariantesSection estado={estado} dispatch={dispatch} guardando={guardando} />
        </>
      )
    }
    render(<Anfitrion />)
    escribir("Precio de Rojo", "1500")
    fireEvent.click(screen.getByRole("button", { name: "Aplicar precio a todas" }))
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeEnabled()
    fireEvent.click(screen.getByRole("button", { name: "guardar" }))
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Sí, cambiar" })).toBeDisabled()
  })
})

describe("VariantesSection: what it passes down", () => {
  it("reports a saved row's stock adjustment, from the table and from the card, so the form can reload the group", () => {
    const alAjustarStock = vi.fn()
    montarSeccion(hidratar(grupoColor()), { alAjustarStock })
    const botones = screen.getAllByRole("button", { name: "5" })
    expect(botones).toHaveLength(2)
    fireEvent.click(botones[0])
    fireEvent.click(botones[1])
    expect(alAjustarStock).toHaveBeenCalledTimes(2)
  })
})
