import { describe, it, expect } from "vitest"
import { fireEvent, screen, within } from "@testing-library/react"
import { OpcionesEditor } from "@/components/inventario/variantes/opciones-editor"
import { aplicar, reductor, opcionId } from "../helpers/variantes-filas"
import { estadoActivo, estadoColor, montar } from "../helpers/variantes-ui"

const textos = (estado: ReturnType<typeof estadoColor>, opcion: string) =>
  estado.opciones.find((o) => o.nombre === opcion)?.valores.map((v) => v.texto)

const montarEditor = (inicial = estadoColor(), props: { deshabilitado?: boolean } = {}) =>
  montar(inicial, (estado, dispatch) => <OpcionesEditor opciones={estado.opciones} dispatch={dispatch} {...props} />)

describe("OpcionesEditor: reading the options", () => {
  it("shows every option with its values as editable chips", () => {
    montarEditor()
    const color = screen.getByRole("group", { name: "Opción Color" })
    expect(within(color).getByLabelText("Nombre de la opción")).toHaveValue("Color")
    expect(within(color).getByLabelText("Valor Rojo")).toHaveValue("Rojo")
    expect(within(color).getByLabelText("Valor Azul")).toHaveValue("Azul")
    expect(within(color).getByLabelText("Agregar valor a Color")).toHaveValue("")
    expect(screen.queryByText(/Una opción es lo que cambia/)).toBeNull()
  })

  it("tells the user an option without values still needs one", () => {
    const sinValores = aplicar(reductor(), estadoColor(), { tipo: "agregarOpcion", nombre: "Talle" })
    montarEditor(sinValores)
    const talle = screen.getByRole("group", { name: "Opción Talle" })
    expect(within(talle).getByText("Agregá al menos un valor")).toBeInTheDocument()
    const color = screen.getByRole("group", { name: "Opción Color" })
    expect(within(color).queryByText("Agregá al menos un valor")).toBeNull()
  })
})

describe("OpcionesEditor: adding values", () => {
  it("Enter adds the trimmed value, clears the input and keeps the focus there", () => {
    const { salida } = montarEditor()
    const entrada = screen.getByLabelText("Agregar valor a Color")
    entrada.focus()
    fireEvent.change(entrada, { target: { value: "  Verde " } })
    fireEvent.keyDown(entrada, { key: "Enter" })

    expect(textos(salida.estado, "Color")).toEqual(["Rojo", "Azul", "Verde"])
    expect(salida.acciones.at(-1)).toMatchObject({ tipo: "agregarValor", texto: "Verde" })
    expect(screen.getByLabelText("Agregar valor a Color")).toHaveValue("")
    expect(document.activeElement).toBe(screen.getByLabelText("Agregar valor a Color"))
    expect(screen.getByLabelText("Valor Verde")).toBeInTheDocument()
  })

  it("a comma adds the values typed or pasted so far, one by one", () => {
    const { salida } = montarEditor()
    const entrada = screen.getByLabelText("Agregar valor a Color")
    fireEvent.change(entrada, { target: { value: "Verde, Negro," } })
    expect(textos(salida.estado, "Color")).toEqual(["Rojo", "Azul", "Verde", "Negro"])
    expect(screen.getByLabelText("Agregar valor a Color")).toHaveValue("")
  })

  it("what follows the last comma stays in the field to be finished", () => {
    const { salida } = montarEditor()
    fireEvent.change(screen.getByLabelText("Agregar valor a Color"), { target: { value: "Verde, Neg" } })
    expect(textos(salida.estado, "Color")).toEqual(["Rojo", "Azul", "Verde"])
    expect(screen.getByLabelText("Agregar valor a Color")).toHaveValue("Neg")
  })

  it("leaving the field with text in it adds the value too, so nothing typed is lost", () => {
    const { salida } = montarEditor()
    const entrada = screen.getByLabelText("Agregar valor a Color")
    fireEvent.change(entrada, { target: { value: "Verde" } })
    fireEvent.blur(entrada)
    expect(textos(salida.estado, "Color")).toEqual(["Rojo", "Azul", "Verde"])
  })

  it("an empty field adds nothing, on Enter or on blur", () => {
    const { salida } = montarEditor()
    const entrada = screen.getByLabelText("Agregar valor a Color")
    fireEvent.keyDown(entrada, { key: "Enter" })
    fireEvent.blur(entrada)
    expect(salida.acciones).toEqual([])
  })

  it("a refused value stays out of the options and the reason is in the state", () => {
    const { salida } = montarEditor()
    const entrada = screen.getByLabelText("Agregar valor a Color")
    fireEvent.change(entrada, { target: { value: "rojo" } })
    fireEvent.keyDown(entrada, { key: "Enter" })
    expect(textos(salida.estado, "Color")).toEqual(["Rojo", "Azul"])
    expect(salida.estado.aviso).toBe('El valor "rojo" está repetido en Color')
  })
})

describe("OpcionesEditor: values", () => {
  it("removes a value with its button, named after the value and the option", () => {
    const { salida } = montarEditor()
    fireEvent.click(screen.getByRole("button", { name: "Quitar Rojo de Color" }))
    expect(salida.acciones.at(-1)).toMatchObject({ tipo: "quitarValor" })
    expect(textos(salida.estado, "Color")).toEqual(["Azul"])
    expect(screen.queryByLabelText("Valor Rojo")).toBeNull()
  })

  it("renames a value on blur and on Enter, keeping its id", () => {
    const { salida } = montarEditor()
    const idRojo = salida.estado.opciones[0].valores[0].id
    const chip = screen.getByLabelText("Valor Rojo")
    fireEvent.change(chip, { target: { value: "Colorado" } })
    fireEvent.blur(chip)
    expect(salida.estado.opciones[0].valores[0]).toEqual({ id: idRojo, texto: "Colorado" })

    const otro = screen.getByLabelText("Valor Azul")
    fireEvent.change(otro, { target: { value: "Celeste" } })
    fireEvent.keyDown(otro, { key: "Enter" })
    expect(textos(salida.estado, "Color")).toEqual(["Colorado", "Celeste"])
  })

  it("Escape drops the edit and a refused rename shows the saved text again", () => {
    const { salida } = montarEditor()
    const chip = screen.getByLabelText("Valor Rojo")
    fireEvent.change(chip, { target: { value: "Colorado" } })
    fireEvent.keyDown(chip, { key: "Escape" })
    expect(screen.getByLabelText("Valor Rojo")).toHaveValue("Rojo")
    expect(salida.acciones).toEqual([])

    fireEvent.change(screen.getByLabelText("Valor Rojo"), { target: { value: "Azul" } })
    fireEvent.blur(screen.getByLabelText("Valor Rojo"))
    expect(salida.estado.aviso).toBe('El valor "Azul" está repetido en Color')
    expect(screen.getByLabelText("Valor Rojo")).toHaveValue("Rojo")
  })

  it("does not dispatch when the text did not change, even after typing and undoing the edit", () => {
    const { salida } = montarEditor()
    fireEvent.blur(screen.getByLabelText("Valor Rojo"))
    fireEvent.change(screen.getByLabelText("Valor Rojo"), { target: { value: "Rojo!" } })
    fireEvent.change(screen.getByLabelText("Valor Rojo"), { target: { value: "Rojo" } })
    fireEvent.blur(screen.getByLabelText("Valor Rojo"))
    expect(salida.acciones).toEqual([])
  })
})

describe("OpcionesEditor: options", () => {
  it("adds an option by name with Enter", () => {
    const { salida } = montarEditor()
    const entrada = screen.getByLabelText("Nombre de la nueva opción")
    fireEvent.change(entrada, { target: { value: " Talle " } })
    fireEvent.keyDown(entrada, { key: "Enter" })
    expect(salida.estado.opciones.map((o) => o.nombre)).toEqual(["Color", "Talle"])
    expect(salida.acciones.at(-1)).toMatchObject({ tipo: "agregarOpcion", nombre: "Talle" })
    expect(screen.getByLabelText("Nombre de la nueva opción")).toHaveValue("")
    expect(screen.getByRole("group", { name: "Opción Talle" })).toBeInTheDocument()
  })

  it("adds an option with the button too", () => {
    const { salida } = montarEditor()
    fireEvent.change(screen.getByLabelText("Nombre de la nueva opción"), { target: { value: "Talle" } })
    fireEvent.click(screen.getByRole("button", { name: "Agregar opción" }))
    expect(salida.estado.opciones.map((o) => o.nombre)).toEqual(["Color", "Talle"])
  })

  it("a blank option name adds nothing and refuses nothing", () => {
    const { salida } = montarEditor()
    const entrada = screen.getByLabelText("Nombre de la nueva opción")
    fireEvent.change(entrada, { target: { value: "   " } })
    fireEvent.keyDown(entrada, { key: "Enter" })
    fireEvent.click(screen.getByRole("button", { name: "Agregar opción" }))
    expect(salida.acciones).toEqual([])
    expect(salida.estado.aviso).toBeNull()
  })

  it("starts empty with the add field ready and a hint about what an option is", () => {
    const { salida } = montarEditor(estadoActivo())
    expect(screen.queryAllByRole("group", { name: /^Opción / })).toEqual([])
    expect(screen.getByText(/Una opción es lo que cambia/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("Nombre de la nueva opción"), { target: { value: "Color" } })
    fireEvent.keyDown(screen.getByLabelText("Nombre de la nueva opción"), { key: "Enter" })
    expect(salida.estado.opciones.map((o) => o.nombre)).toEqual(["Color"])
  })

  it("offers no fourth option and says why", () => {
    const tres = aplicar(
      reductor(),
      estadoColor(),
      { tipo: "agregarOpcion", nombre: "Talle", valores: ["S"] },
      { tipo: "agregarOpcion", nombre: "Material", valores: ["Cuero"] }
    )
    montarEditor(tres)
    expect(screen.queryByLabelText("Nombre de la nueva opción")).toBeNull()
    expect(screen.getByText("Llegaste al máximo de 3 opciones")).toBeInTheDocument()
  })

  it("renames an option on blur, keeping its values", () => {
    const { salida } = montarEditor()
    const nombre = within(screen.getByRole("group", { name: "Opción Color" })).getByLabelText("Nombre de la opción")
    fireEvent.change(nombre, { target: { value: "Tono" } })
    fireEvent.blur(nombre)
    expect(salida.estado.opciones[0].nombre).toBe("Tono")
    expect(textos(salida.estado, "Tono")).toEqual(["Rojo", "Azul"])
    expect(screen.getByRole("group", { name: "Opción Tono" })).toBeInTheDocument()
  })

  it("removes an option with its button", () => {
    const dos = aplicar(reductor(), estadoColor(), { tipo: "agregarOpcion", nombre: "Talle", valores: ["S", "M"] })
    const { salida } = montarEditor(dos)
    fireEvent.click(screen.getByRole("button", { name: "Quitar la opción Talle" }))
    expect(salida.acciones.at(-1)).toEqual({ tipo: "quitarOpcion", opcionId: opcionId(dos, "Talle") })
    expect(salida.estado.opciones.map((o) => o.nombre)).toEqual(["Color"])
  })
})

describe("OpcionesEditor: inside the product form", () => {
  it("Enter in any field is swallowed, so it never submits the form around the editor", () => {
    montarEditor()
    for (const campo of [
      screen.getByLabelText("Nombre de la opción"),
      screen.getByLabelText("Valor Rojo"),
      screen.getByLabelText("Agregar valor a Color"),
      screen.getByLabelText("Nombre de la nueva opción"),
    ]) {
      // fireEvent answers false when the handler called preventDefault.
      expect(fireEvent.keyDown(campo, { key: "Enter" })).toBe(false)
    }
    expect(fireEvent.keyDown(screen.getByLabelText("Valor Rojo"), { key: "a" })).toBe(true)
  })
})

describe("OpcionesEditor: no motion", () => {
  it("adding and removing by keyboard leaves no animation or transition class in the editor", () => {
    const { container } = montarEditor()
    const entrada = screen.getByLabelText("Agregar valor a Color")
    fireEvent.change(entrada, { target: { value: "Verde" } })
    fireEvent.keyDown(entrada, { key: "Enter" })
    fireEvent.click(screen.getByRole("button", { name: "Quitar Rojo de Color" }))
    fireEvent.change(screen.getByLabelText("Nombre de la nueva opción"), { target: { value: "Talle" } })
    fireEvent.keyDown(screen.getByLabelText("Nombre de la nueva opción"), { key: "Enter" })

    const clases = Array.from(container.querySelectorAll("*")).map((el) => el.getAttribute("class") ?? "")
    expect(clases.length).toBeGreaterThan(10)
    expect(clases.filter((c) => /animate-|transition|duration-|ease-/.test(c))).toEqual([])
  })
})

describe("OpcionesEditor: disabled", () => {
  it("locks every control while disabled", () => {
    montarEditor(estadoColor(), { deshabilitado: true })
    for (const control of [
      screen.getByLabelText("Nombre de la opción"),
      screen.getByLabelText("Valor Rojo"),
      screen.getByLabelText("Agregar valor a Color"),
      screen.getByLabelText("Nombre de la nueva opción"),
      screen.getByRole("button", { name: "Quitar Rojo de Color" }),
      screen.getByRole("button", { name: "Quitar la opción Color" }),
      screen.getByRole("button", { name: "Agregar opción" }),
    ]) {
      expect(control).toBeDisabled()
    }
  })
})
