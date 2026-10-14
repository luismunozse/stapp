import type { Dispatch, ReactNode } from "react"
import { describe, it, expect, vi } from "vitest"
import { fireEvent, screen, within } from "@testing-library/react"
import { CombinacionesTabla } from "@/components/inventario/variantes/combinaciones-tabla"
import { CombinacionCard, CombinacionesCards } from "@/components/inventario/variantes/combinacion-card"
import type { VariantesAccion, VariantesState } from "@/lib/variantes-filas"
import { aplicar, reductor, filaDe, grupoColor, grupoColorTalle, hidratar, leida, opcionId, valorId } from "../helpers/variantes-filas"
import { estadoActivo, estadoColor, montar } from "../helpers/variantes-ui"

// QuickStockAdjust talks to a modal context and the network; the rows only decide WHEN to render it.
vi.mock("@/components/inventario/quick-stock-adjust", () => ({
  QuickStockAdjust: (p: { itemId: string; currentStock: number; esStockBajo?: boolean; sinStock?: boolean; onAdjusted: () => void }) => (
    <button
      type="button"
      data-testid={`ajuste-${p.itemId}`}
      data-bajo={String(!!p.esStockBajo)}
      data-sin-stock={String(!!p.sinStock)}
      onClick={p.onAdjusted}
    >
      {p.currentStock}
    </button>
  ),
}))

interface PropsVista {
  alAjustarStock?: () => void
  deshabilitado?: boolean
}

type Vista = (estado: VariantesState, dispatch: Dispatch<VariantesAccion>, props: PropsVista) => ReactNode

const VISTAS: [string, Vista][] = [
  ["tabla", (estado, dispatch, props) => <CombinacionesTabla estado={estado} dispatch={dispatch} {...props} />],
  ["tarjetas", (estado, dispatch, props) => <CombinacionesCards estado={estado} dispatch={dispatch} {...props} />],
]

const escribir = (etiqueta: string, valor: string) => {
  const campo = screen.getByLabelText(etiqueta)
  fireEvent.change(campo, { target: { value: valor } })
  fireEvent.blur(campo)
}

const sinRojo = (inicial: VariantesState) => aplicar(reductor(), inicial, { tipo: "quitarValor", valorId: valorId(inicial, "Color", "Rojo") })

describe.each(VISTAS)("combinaciones (%s): editing a row", (_nombre, vista) => {
  const montarVista = (inicial: VariantesState, props: PropsVista = {}) => montar(inicial, (estado, dispatch) => vista(estado, dispatch, props))

  it("lists the active combinations in option order with the label of each", () => {
    const inicial = aplicar(reductor(), estadoColor(), { tipo: "agregarOpcion", nombre: "Talle", valores: ["S", "M"] })
    montarVista(inicial)
    for (const etiqueta of ["Rojo / S", "Rojo / M", "Azul / S", "Azul / M"]) {
      expect(screen.getAllByText(etiqueta).length).toBeGreaterThan(0)
      expect(screen.getByLabelText(`Código de ${etiqueta}`)).toBeInTheDocument()
    }
    const codigos = screen.getAllByLabelText(/^Código de /).map((el) => el.getAttribute("aria-label"))
    expect(codigos).toEqual(["Código de Rojo / S", "Código de Rojo / M", "Código de Azul / S", "Código de Azul / M"])
  })

  it("shows the generated code and the base price, and edits the code as typed", () => {
    const inicial = estadoColor()
    const { salida } = montarVista(inicial)
    expect(screen.getByLabelText("Código de Rojo")).toHaveValue(filaDe(inicial, "Rojo").codigo)
    expect(screen.getByLabelText("Precio de Rojo")).toHaveValue("1000")

    fireEvent.change(screen.getByLabelText("Código de Rojo"), { target: { value: "ROJO-1 " } })
    const rojo = filaDe(salida.estado, "Rojo")
    expect(rojo.codigo).toBe("ROJO-1 ")
    expect(rojo.codigoTocado).toBe(true)
    expect(salida.acciones.at(-1)).toEqual({ tipo: "editarFila", filaId: rojo.id, cambios: { codigo: "ROJO-1 " } })
  })

  it("a code the reducer refuses leaves the field on the saved text and the reason in the state", () => {
    const { salida } = montarVista(estadoColor())
    const antes = filaDe(salida.estado, "Rojo").codigo
    fireEvent.change(screen.getByLabelText("Código de Rojo"), { target: { value: "x".repeat(101) } })
    expect(screen.getByLabelText("Código de Rojo")).toHaveValue(antes)
    expect(salida.estado.aviso).toBe("El código puede tener hasta 100 caracteres")
  })

  it("commits the price on blur, reading it the way the product form does", () => {
    const { salida } = montarVista(estadoColor())
    escribir("Precio de Rojo", "1.500,50")
    expect(filaDe(salida.estado, "Rojo").precioVenta).toBe(1500.5)
    expect(filaDe(salida.estado, "Rojo").precioTocado).toBe(true)
    escribir("Precio de Azul", "2.500")
    expect(filaDe(salida.estado, "Azul").precioVenta).toBe(2500)
    expect(screen.getByLabelText("Precio de Rojo")).toHaveValue("1500.5")
  })

  it("typing a price and putting the old one back sends nothing", () => {
    const { salida } = montarVista(estadoColor())
    fireEvent.change(screen.getByLabelText("Precio de Rojo"), { target: { value: "1001" } })
    fireEvent.change(screen.getByLabelText("Precio de Rojo"), { target: { value: "1000" } })
    fireEvent.blur(screen.getByLabelText("Precio de Rojo"))
    expect(salida.acciones).toEqual([])
  })

  it("Enter commits the number and does not submit the form; Escape drops it", () => {
    const { salida } = montarVista(estadoColor())
    const precio = screen.getByLabelText("Precio de Rojo")
    fireEvent.change(precio, { target: { value: "1300" } })
    expect(fireEvent.keyDown(precio, { key: "Enter" })).toBe(false)
    expect(filaDe(salida.estado, "Rojo").precioVenta).toBe(1300)

    fireEvent.change(screen.getByLabelText("Precio de Azul"), { target: { value: "999" } })
    fireEvent.keyDown(screen.getByLabelText("Precio de Azul"), { key: "Escape" })
    expect(screen.getByLabelText("Precio de Azul")).toHaveValue("1000")
    fireEvent.blur(screen.getByLabelText("Precio de Azul"))
    expect(filaDe(salida.estado, "Azul").precioVenta).toBe(1000)
  })

  it("Enter in the code and the other fields never reaches the product form", () => {
    montarVista(hidratar(grupoColor()))
    for (const campo of ["Código de Rojo", "Precio de Rojo", "Costo de Rojo"]) {
      expect(fireEvent.keyDown(screen.getByLabelText(campo), { key: "Enter" })).toBe(false)
    }
  })

  it("does not commit the price while typing: a half-typed number is not refused key by key", () => {
    const { salida } = montarVista(estadoColor())
    fireEvent.change(screen.getByLabelText("Precio de Rojo"), { target: { value: "15" } })
    expect(salida.acciones).toEqual([])
    expect(screen.getByLabelText("Precio de Rojo")).toHaveValue("15")
  })

  it("a price that is not a number is refused with the reducer's reason and shows the saved price again", () => {
    const { salida } = montarVista(estadoColor())
    escribir("Precio de Rojo", "")
    expect(salida.estado.aviso).toBe("El precio tiene que ser un número")
    expect(screen.getByLabelText("Precio de Rojo")).toHaveValue("1000")
    escribir("Precio de Rojo", "-5")
    expect(salida.estado.aviso).toBe("El precio no puede ser negativo")
  })

  it("a row follows the base price until it is touched, and the field shows it", () => {
    const { salida } = montarVista(estadoColor())
    escribir("Precio de Rojo", "1200")
    // The base price moves from outside (the product's own Precio base field).
    salida.despachar({ tipo: "cambiarPrecioBase", precio: 1500 })
    expect(screen.getByLabelText("Precio de Azul")).toHaveValue("1500")
    expect(screen.getByLabelText("Precio de Rojo")).toHaveValue("1200")
  })

  it("the field shows a new value that arrives while it is being edited elsewhere (Aplicar precio a todas)", () => {
    const { salida } = montarVista(estadoColor())
    escribir("Precio de Rojo", "1200")
    salida.despachar({ tipo: "aplicarPrecioATodas" })
    expect(screen.getByLabelText("Precio de Rojo")).toHaveValue("1000")
  })

  it("new rows take an initial stock; saved rows get the quick adjust instead", () => {
    const { salida } = montarVista(estadoColor())
    escribir("Stock inicial de Rojo", "7")
    expect(filaDe(salida.estado, "Rojo").stockInicial).toBe(7)
    expect(screen.queryByTestId(/^ajuste-/)).toBeNull()
  })

  it("an initial stock that is not a whole number is refused naming the field", () => {
    const { salida } = montarVista(estadoColor())
    escribir("Stock inicial de Rojo", "2,5")
    expect(salida.estado.aviso).toBe("El stock inicial tiene que ser un número entero")
    escribir("Stock inicial de Rojo", "-1")
    expect(salida.estado.aviso).toBe("El stock inicial no puede ser negativo")
    expect(filaDe(salida.estado, "Rojo").stockInicial).toBe(0)
  })

  it("a blank initial stock is refused, not read as zero", () => {
    const { salida } = montarVista(estadoColor())
    escribir("Stock inicial de Rojo", "4")
    escribir("Stock inicial de Rojo", "")
    expect(salida.estado.aviso).toBe("El stock inicial tiene que ser un número entero")
    expect(filaDe(salida.estado, "Rojo").stockInicial).toBe(4)
  })

  it("flags a saved row that is out of stock or under its minimum, and only then", () => {
    const lectura = grupoColor()
    montarVista(
      hidratar({
        ...lectura,
        variantes: [
          leida("r1", [{ opcion: "Color", valor: "Rojo" }], { stock: 2, stockMinimo: 3 }),
          leida("a1", [{ opcion: "Color", valor: "Azul" }], { stock: 0 }),
          leida("n1", [{ opcion: "Color", valor: "Negro" }], { stock: 9, stockMinimo: 3 }),
        ],
        grupo: { ...lectura.grupo, opciones: [{ nombre: "Color", valores: ["Rojo", "Azul", "Negro"] }] },
      })
    )
    expect(screen.getByTestId("ajuste-r1")).toHaveAttribute("data-bajo", "true")
    expect(screen.getByTestId("ajuste-r1")).toHaveAttribute("data-sin-stock", "false")
    expect(screen.getByTestId("ajuste-a1")).toHaveAttribute("data-sin-stock", "true")
    expect(screen.getByTestId("ajuste-a1")).toHaveAttribute("data-bajo", "false")
    expect(screen.getByTestId("ajuste-n1")).toHaveAttribute("data-bajo", "false")
    expect(screen.getByTestId("ajuste-n1")).toHaveAttribute("data-sin-stock", "false")
  })

  it("a saved row shows its stock through the quick adjust and reports when it was adjusted", () => {
    const alAjustarStock = vi.fn()
    const guardado = hidratar(grupoColor())
    montarVista(guardado, { alAjustarStock })
    expect(screen.getByTestId("ajuste-r1")).toHaveTextContent("5")
    expect(screen.getByTestId("ajuste-a1")).toHaveTextContent("3")
    expect(screen.queryByLabelText("Stock inicial de Rojo")).toBeNull()
    fireEvent.click(screen.getByTestId("ajuste-a1"))
    expect(alAjustarStock).toHaveBeenCalledTimes(1)
  })

  it("shows the cost column only when the role can see costs", () => {
    const { salida } = montarVista(estadoColor({ costoCargado: true }))
    expect(screen.getByLabelText("Costo de Rojo")).toBeInTheDocument()
    escribir("Costo de Rojo", "400")
    expect(filaDe(salida.estado, "Rojo").precioCompra).toBe(400)
  })

  it("renders no cost field at all without cost access", () => {
    montarVista(estadoColor({ costoCargado: false }))
    expect(screen.queryByLabelText(/^Costo de /)).toBeNull()
    expect(screen.queryByText("Costo")).toBeNull()
  })

  it("a row brought back from the archive says its code, price and cost are kept, not zero", () => {
    const guardado = hidratar(grupoColor())
    const conVerde = aplicar(reductor(), guardado, { tipo: "agregarValor", opcionId: opcionId(guardado, "Color"), texto: "Verde" })
    const { salida } = montarVista(conVerde)
    const verde = filaDe(salida.estado, "Verde")
    expect(verde.restaurada).toBe(true)
    for (const campo of ["Código de Verde", "Precio de Verde", "Costo de Verde"]) {
      expect(screen.getByLabelText(campo)).toHaveValue("")
      expect(screen.getByLabelText(campo)).toHaveAttribute("placeholder", "Se conserva")
    }
    // The other rows are not affected.
    expect(screen.getByLabelText("Precio de Rojo")).toHaveValue("1000")
    expect(screen.getByLabelText("Código de Rojo")).toHaveAttribute("placeholder", "Código")
    expect(screen.getByLabelText("Costo de Rojo")).toHaveAttribute("placeholder", "0.00")
    // Its stock is shown, but cannot be adjusted until the row is saved.
    expect(screen.queryByTestId(`ajuste-${verde.id}`)).toBeNull()
    expect(screen.getByText("7")).toBeInTheDocument()
  })

  it("typing a price on a restored row sends that price and from then on shows it", () => {
    const guardado = hidratar(grupoColor())
    const conVerde = aplicar(reductor(), guardado, { tipo: "agregarValor", opcionId: opcionId(guardado, "Color"), texto: "Verde" })
    const { salida } = montarVista(conVerde)
    escribir("Precio de Verde", "900")
    expect(filaDe(salida.estado, "Verde").precioVenta).toBe(900)
    expect(filaDe(salida.estado, "Verde").precioTocado).toBe(true)
    expect(screen.getByLabelText("Precio de Verde")).toHaveValue("900")
    expect(screen.getByLabelText("Código de Verde")).toHaveAttribute("placeholder", "Se conserva")
  })

  it("typing the code of a restored row stops saying the code is kept", () => {
    const guardado = hidratar(grupoColor())
    const conVerde = aplicar(reductor(), guardado, { tipo: "agregarValor", opcionId: opcionId(guardado, "Color"), texto: "Verde" })
    const { salida } = montarVista(conVerde)
    fireEvent.change(screen.getByLabelText("Código de Verde"), { target: { value: "V-1" } })
    expect(filaDe(salida.estado, "Verde").codigoTocado).toBe(true)
    expect(screen.getByLabelText("Código de Verde")).toHaveAttribute("placeholder", "Código")
  })

  it("a new row's cost field is not marked as kept either", () => {
    montarVista(estadoColor({ costoCargado: true }))
    expect(screen.getByLabelText("Costo de Rojo")).toHaveAttribute("placeholder", "0.00")
    expect(screen.getByLabelText("Código de Rojo")).toHaveAttribute("placeholder", "Código")
    expect(screen.getByLabelText("Precio de Rojo")).toHaveAttribute("placeholder", "0.00")
  })

  it("marks the item being converted so the user knows which row is the existing product", () => {
    const item = { id: "item1", codigo: "ABC-1", precioVenta: 900, precioCompra: 300, stock: 4 }
    const promovido = aplicar(reductor(), estadoColor({ costoCargado: true }), { tipo: "promover", item })
    montarVista(promovido)
    const marcas = screen.getAllByText("Es este producto")
    expect(marcas).toHaveLength(1)
    expect(screen.getByLabelText("Código de Rojo")).toHaveValue("ABC-1")
    expect(screen.getByTestId("ajuste-item1")).toHaveTextContent("4")
  })

  it("locks every control while disabled", () => {
    montarVista(hidratar(grupoColor()), { deshabilitado: true })
    expect(screen.getByLabelText("Código de Rojo")).toBeDisabled()
    expect(screen.getByLabelText("Precio de Rojo")).toBeDisabled()
    expect(screen.getByLabelText("Costo de Rojo")).toBeDisabled()
    expect(screen.getByRole("button", { name: "Más datos de Rojo" })).toBeDisabled()
  })

  it("keeps the undo of a row pending archive from being used while disabled", () => {
    montarVista(sinRojo(hidratar(grupoColor())), { deshabilitado: true })
    expect(screen.getByRole("button", { name: "Deshacer archivo de Rojo" })).toBeDisabled()
  })
})

describe.each(VISTAS)("combinaciones (%s): the rest of the data of a row", (_nombre, vista) => {
  const montarVista = (inicial: VariantesState) => montar(inicial, (estado, dispatch) => vista(estado, dispatch, {}))

  it("is folded away until asked for, and the toggle says so", () => {
    montarVista(estadoColor())
    const boton = screen.getByRole("button", { name: "Más datos de Rojo" })
    expect(boton).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByLabelText("Código de barras de Rojo")).toBeNull()
    fireEvent.click(boton)
    expect(screen.getByRole("button", { name: "Más datos de Rojo" })).toHaveAttribute("aria-expanded", "true")
    for (const campo of ["Código de barras de Rojo", "Stock mínimo de Rojo", "Stock máximo de Rojo", "Punto de reorden de Rojo", "Ubicación de Rojo"]) {
      expect(screen.getByLabelText(campo)).toBeInTheDocument()
    }
    // Only that row opened.
    expect(screen.queryByLabelText("Código de barras de Azul")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Más datos de Rojo" }))
    expect(screen.queryByLabelText("Código de barras de Rojo")).toBeNull()
  })

  it("edits the barcode, the stock limits, the reorder point and the location", () => {
    const { salida } = montarVista(estadoColor())
    fireEvent.click(screen.getByRole("button", { name: "Más datos de Rojo" }))
    escribir("Código de barras de Rojo", " 7791234567890 ")
    escribir("Stock mínimo de Rojo", "2")
    escribir("Stock máximo de Rojo", "10")
    escribir("Punto de reorden de Rojo", "4")
    escribir("Ubicación de Rojo", "Estante 3")
    const rojo = filaDe(salida.estado, "Rojo")
    expect(rojo.barcode).toBe("7791234567890")
    expect(rojo.extra).toEqual({ stockMinimo: 2, stockMaximo: 10, puntoReorden: 4, ubicacion: "Estante 3" })
    expect(screen.getByLabelText("Código de barras de Rojo")).toHaveValue("7791234567890")
  })

  it("an emptied minimum, maximum or reorder point goes back to none", () => {
    const { salida } = montarVista(estadoColor())
    fireEvent.click(screen.getByRole("button", { name: "Más datos de Rojo" }))
    for (const [campo, clave] of [
      ["Stock mínimo de Rojo", "stockMinimo"],
      ["Stock máximo de Rojo", "stockMaximo"],
      ["Punto de reorden de Rojo", "puntoReorden"],
    ] as const) {
      escribir(campo, "8")
      expect(filaDe(salida.estado, "Rojo").extra[clave]).toBe(8)
      escribir(campo, "")
      expect(filaDe(salida.estado, "Rojo").extra[clave]).toBeNull()
    }
  })

  it("an emptied limit goes back to none, and a minimum above the maximum is refused", () => {
    const { salida } = montarVista(estadoColor())
    fireEvent.click(screen.getByRole("button", { name: "Más datos de Rojo" }))
    escribir("Stock máximo de Rojo", "10")
    escribir("Stock máximo de Rojo", "")
    expect(filaDe(salida.estado, "Rojo").extra.stockMaximo).toBeNull()
    escribir("Stock máximo de Rojo", "3")
    escribir("Stock mínimo de Rojo", "9")
    expect(salida.estado.aviso).toBe("El stock mínimo no puede superar al máximo")
    expect(filaDe(salida.estado, "Rojo").extra.stockMinimo).toBeNull()
  })
})

describe.each(VISTAS)("combinaciones (%s): rows pending archive", (_nombre, vista) => {
  const montarVista = (inicial: VariantesState) => montar(inicial, (estado, dispatch) => vista(estado, dispatch, {}))

  it("keeps them apart from the combinations, marked 'Se archivará', with no fields to edit", () => {
    montarVista(sinRojo(hidratar(grupoColor())))
    const grupo = screen.getByRole("group", { name: "Se archivarán al guardar" })
    expect(within(grupo).getByText("Rojo")).toBeInTheDocument()
    expect(within(grupo).getByText("Se archivará")).toBeInTheDocument()
    expect(within(grupo).queryByLabelText("Código de Rojo")).toBeNull()
    expect(screen.queryByLabelText("Código de Rojo")).toBeNull()
    // The active row stays editable, outside that group.
    expect(screen.getByLabelText("Código de Azul")).toBeInTheDocument()
    expect(within(grupo).queryByLabelText("Código de Azul")).toBeNull()
  })

  it("shows no archive group when nothing is pending", () => {
    montarVista(hidratar(grupoColor()))
    expect(screen.queryByRole("group", { name: "Se archivarán al guardar" })).toBeNull()
    expect(screen.queryByText("Se archivará")).toBeNull()
  })

  it("says how much stock the row keeps", () => {
    montarVista(sinRojo(hidratar(grupoColor())))
    expect(screen.getByText(/Conserva 5 unidades/)).toBeInTheDocument()
  })

  it("undo brings the row back to the combinations", () => {
    const { salida } = montarVista(sinRojo(hidratar(grupoColor())))
    fireEvent.click(screen.getByRole("button", { name: "Deshacer archivo de Rojo" }))
    expect(salida.acciones.at(-1)).toMatchObject({ tipo: "deshacerArchivo" })
    expect(filaDe(salida.estado, "Rojo").archivar).toBe(false)
    expect(screen.queryByRole("group", { name: "Se archivarán al guardar" })).toBeNull()
    expect(screen.getByLabelText("Código de Rojo")).toBeInTheDocument()
  })

  it("warns BEFORE the undo that it also brings back the other rows of the same value", () => {
    const inicial = hidratar(grupoColorTalle())
    const archivado = aplicar(reductor(), inicial, { tipo: "quitarValor", valorId: valorId(inicial, "Talle", "S") })
    const { salida } = montarVista(archivado)
    const grupo = screen.getByRole("group", { name: "Se archivarán al guardar" })
    expect(within(grupo).getByText("Al deshacer se vuelve a agregar S y también vuelve Azul / S")).toBeInTheDocument()
    expect(within(grupo).getByText("Al deshacer se vuelve a agregar S y también vuelve Rojo / S")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Deshacer archivo de Rojo / S" }))
    expect(salida.estado.filas[filaDe(salida.estado, "Azul / S").id].archivar).toBe(false)
    expect(screen.queryByRole("group", { name: "Se archivarán al guardar" })).toBeNull()
  })

  it("also announces the rows the undo creates again, not only the ones that come back (a Verde / S appears)", () => {
    const inicial = hidratar(grupoColorTalle())
    const conVerde = aplicar(reductor(), inicial, { tipo: "agregarValor", opcionId: opcionId(inicial, "Color"), texto: "Verde" })
    const archivado = aplicar(reductor(), conVerde, { tipo: "quitarValor", valorId: valorId(conVerde, "Talle", "S") })
    const { salida } = montarVista(archivado)
    const grupo = screen.getByRole("group", { name: "Se archivarán al guardar" })
    expect(within(grupo).getAllByText("Al deshacer se vuelve a agregar S, también vuelve Azul / S y se agrega Verde / S").length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole("button", { name: "Deshacer archivo de Rojo / S" }))
    expect(screen.queryByRole("group", { name: "Se archivarán al guardar" })).toBeNull()
    expect(salida.estado.filas[filaDe(salida.estado, "Verde / S").id]).toBeDefined()
  })

  it("says up front why an undo will not work when the option is gone, and the refusal reaches the state", () => {
    const inicial = hidratar(grupoColorTalle())
    const sinTalle = aplicar(reductor(), inicial, { tipo: "quitarOpcion", opcionId: opcionId(inicial, "Talle") })
    const { salida } = montarVista(sinTalle)
    const grupo = screen.getByRole("group", { name: "Se archivarán al guardar" })
    expect(within(grupo).getAllByText('Para deshacerlo, volvé a agregar la opción "Talle"')).toHaveLength(2)
    fireEvent.click(within(grupo).getAllByRole("button", { name: /^Deshacer archivo de / })[0])
    expect(salida.estado.aviso).toBe('Para deshacerlo, volvé a agregar la opción "Talle"')
    expect(screen.getByRole("group", { name: "Se archivarán al guardar" })).toBeInTheDocument()
  })

  it("a row with reserved units shows why it cannot be archived", () => {
    const reservada = hidratar({
      ...grupoColor(),
      variantes: [leida("r1", [{ opcion: "Color", valor: "Rojo" }], { stock: 5, stockReservado: 2 }), ...grupoColor().variantes.slice(1)],
    })
    montarVista(sinRojo(reservada))
    expect(screen.getByText('No se puede archivar "Rojo": tiene 2 unidades reservadas')).toBeInTheDocument()
  })

  it("two rows with the same text stay apart: the pending one is in its own group with its mark", () => {
    const inicial = hidratar(grupoColor())
    const choque = aplicar(
      reductor(),
      inicial,
      { tipo: "quitarValor", valorId: valorId(inicial, "Color", "Rojo") },
      { tipo: "renombrarValor", valorId: valorId(inicial, "Color", "Azul"), texto: "Rojo" }
    )
    montarVista(choque)
    const grupo = screen.getByRole("group", { name: "Se archivarán al guardar" })
    expect(within(grupo).getByText("Rojo")).toBeInTheDocument()
    expect(within(grupo).getByText("Se archivará")).toBeInTheDocument()
    // Exactly one editable Rojo outside the group.
    expect(screen.getAllByLabelText("Código de Rojo")).toHaveLength(1)
  })
})

describe("CombinacionCard: the phone layout", () => {
  const montarCard = (inicial: VariantesState, etiqueta: string) =>
    montar(inicial, (estado, dispatch) => <CombinacionCard estado={estado} fila={estado.filas[filaDe(estado, etiqueta).id]} dispatch={dispatch} />)

  it("has the label as its header and the fields in two columns", () => {
    montarCard(estadoColor({ costoCargado: true }), "Rojo")
    expect(screen.getByRole("heading", { name: "Rojo" })).toBeInTheDocument()
    const precio = screen.getByLabelText("Precio de Rojo")
    const costo = screen.getByLabelText("Costo de Rojo")
    // Price and cost share one two-column grid.
    expect(precio.closest(".grid-cols-2")).not.toBeNull()
    expect(precio.closest(".grid-cols-2")).toBe(costo.closest(".grid-cols-2"))
  })

  it("is for phones only, with 44px targets, tabular numbers and motion-reduce on its toggle", () => {
    const { container } = montarCard(estadoColor({ costoCargado: true }), "Rojo")
    expect(container.firstElementChild).toHaveClass("sm:hidden")
    for (const campo of ["Código de Rojo", "Precio de Rojo", "Costo de Rojo", "Stock inicial de Rojo"]) {
      expect(screen.getByLabelText(campo)).toHaveClass("h-11")
    }
    for (const campo of ["Precio de Rojo", "Costo de Rojo", "Stock inicial de Rojo"]) {
      expect(screen.getByLabelText(campo)).toHaveClass("tabular-nums")
    }
    const mas = screen.getByRole("button", { name: "Más datos de Rojo" })
    expect(mas).toHaveClass("min-h-11")
    expect(mas.className).toContain("motion-reduce:")
  })

  it("the saved row's stock adjust gets a 44px target on the card", () => {
    const { container } = montarCard(hidratar(grupoColor()), "Rojo")
    expect(screen.getByTestId("ajuste-r1")).toBeInTheDocument()
    expect(container.querySelector("[data-testid='ajuste-r1']")?.parentElement?.className).toContain("min-h-11")
  })
})

describe("CombinacionesTabla: the desktop layout", () => {
  it("is for wider screens only and scrolls inside itself, never the page", () => {
    const { container } = montar(estadoColor(), (estado, dispatch) => <CombinacionesTabla estado={estado} dispatch={dispatch} />)
    expect(container.firstElementChild).toHaveClass("hidden", "sm:block")
    expect(container.firstElementChild).toHaveClass("overflow-x-auto")
  })

  it("has a header cell per column, with the cost only when it is loaded", () => {
    montar(estadoColor({ costoCargado: true }), (estado, dispatch) => <CombinacionesTabla estado={estado} dispatch={dispatch} />)
    expect(screen.getAllByRole("columnheader").map((c) => c.textContent)).toEqual(["Variante", "Código", "Precio", "Costo", "Stock", "Más"])
  })

  it("leaves the cost column out without cost access", () => {
    montar(estadoColor({ costoCargado: false }), (estado, dispatch) => <CombinacionesTabla estado={estado} dispatch={dispatch} />)
    expect(screen.getAllByRole("columnheader").map((c) => c.textContent)).toEqual(["Variante", "Código", "Precio", "Stock", "Más"])
  })

  it("the open 'Más datos' row spans every column, with or without the cost", () => {
    for (const costoCargado of [true, false]) {
      const { unmount } = montar(estadoColor({ costoCargado }), (estado, dispatch) => <CombinacionesTabla estado={estado} dispatch={dispatch} />)
      fireEvent.click(screen.getByRole("button", { name: "Más datos de Rojo" }))
      const columnas = screen.getAllByRole("columnheader").length
      expect(columnas).toBe(costoCargado ? 6 : 5)
      expect(screen.getByLabelText("Ubicación de Rojo").closest("td")).toHaveAttribute("colspan", String(columnas))
      unmount()
    }
  })

  it("renders nothing when there are no rows", () => {
    const { container } = montar(estadoActivo(), (estado, dispatch) => <CombinacionesTabla estado={estado} dispatch={dispatch} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe("CombinacionesCards: the card list", () => {
  it("renders nothing when there are no rows", () => {
    const { container } = montar(estadoActivo(), (estado, dispatch) => <CombinacionesCards estado={estado} dispatch={dispatch} />)
    expect(container).toBeEmptyDOMElement()
  })

  it("a card pending archive is also phone-only", () => {
    const { container } = montar(sinRojo(hidratar(grupoColor())), (estado, dispatch) => (
      <CombinacionCard estado={estado} fila={estado.filas[estado.orden[estado.orden.length - 1]]} dispatch={dispatch} />
    ))
    expect(screen.getByText("Se archivará")).toBeInTheDocument()
    expect(container.firstElementChild).toHaveClass("sm:hidden")
  })

  it("is hidden from sm up as a whole and renders one card per combination", () => {
    const { container } = montar(estadoColor(), (estado, dispatch) => <CombinacionesCards estado={estado} dispatch={dispatch} />)
    expect(container.firstElementChild).toHaveClass("sm:hidden")
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Rojo", "Azul"])
  })
})
