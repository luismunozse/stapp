import { describe, it, expect } from "vitest"
import { describirEfecto, efectoDeDeshacer, validezDeVariantes, type EfectoDeDeshacer } from "@/components/inventario/variantes/vista"
import { filasEnOrden, etiquetaDeFila, type GrupoLeido, type VariantesState } from "@/lib/variantes-filas"
import { estadoActivo, estadoColor } from "../helpers/variantes-ui"
import { aplicar, reductor, filaDe, grupoColor, grupoColorTalle, hidratar, leida, valorId, opcionId } from "../helpers/variantes-filas"

const pendientes = (e: VariantesState) =>
  filasEnOrden(e)
    .filter((f) => f.archivar)
    .map((f) => etiquetaDeFila(e, f))
    .sort()

/** What the reducer really does: the labels that stop being pending when `etiqueta` is undone. */
const quienesVuelven = (antes: VariantesState, etiqueta: string) => {
  const despues = aplicar(reductor(), antes, { tipo: "deshacerArchivo", filaId: filaDe(antes, etiqueta).id })
  const siguen = new Set(pendientes(despues))
  return pendientes(antes).filter((e) => !siguen.has(e))
}

const sinCambios = { valores: [], tambien: [], nuevas: [], restauradas: [], bloqueo: null }

describe("efectoDeDeshacer: what undoing one archived row brings back", () => {
  it("one dimension: the value comes back and nothing else with it", () => {
    const antes = aplicar(reductor(), hidratar(grupoColor()), { tipo: "quitarValor", valorId: valorId(hidratar(grupoColor()), "Color", "Rojo") })
    expect(efectoDeDeshacer(antes, filaDe(antes, "Rojo"))).toEqual({ ...sinCambios, valores: ["Rojo"] })
    expect(quienesVuelven(antes, "Rojo")).toEqual(["Rojo"])
  })

  it("two dimensions: the other pending rows of the same value come back too", () => {
    const inicial = hidratar(grupoColorTalle())
    const antes = aplicar(reductor(), inicial, { tipo: "quitarValor", valorId: valorId(inicial, "Talle", "S") })
    expect(pendientes(antes)).toEqual(["Azul / S", "Rojo / S"])

    expect(efectoDeDeshacer(antes, filaDe(antes, "Rojo / S"))).toEqual({ ...sinCambios, valores: ["S"], tambien: ["Azul / S"] })
    // The prediction is what the reducer does.
    expect(quienesVuelven(antes, "Rojo / S").sort()).toEqual(["Azul / S", "Rojo / S"])
  })

  it("rows of a different removed value stay out of the list", () => {
    const inicial = hidratar(grupoColorTalle())
    const antes = aplicar(
      reductor(),
      inicial,
      { tipo: "quitarValor", valorId: valorId(inicial, "Talle", "S") },
      { tipo: "quitarValor", valorId: valorId(inicial, "Color", "Azul") }
    )
    expect(pendientes(antes)).toEqual(["Azul / M", "Azul / S", "Rojo / S"])

    // Undoing Rojo / S brings S back, and Azul / S would need Azul, which is still gone.
    expect(efectoDeDeshacer(antes, filaDe(antes, "Rojo / S"))).toEqual({ ...sinCambios, valores: ["S"] })
    expect(quienesVuelven(antes, "Rojo / S")).toEqual(["Rojo / S"])
  })

  it("follows a rename: the value is named as it reads now", () => {
    const inicial = hidratar(grupoColor())
    const antes = aplicar(
      reductor(),
      inicial,
      { tipo: "quitarValor", valorId: valorId(inicial, "Color", "Rojo") },
      { tipo: "renombrarOpcion", opcionId: opcionId(inicial, "Color"), nombre: "Tono" }
    )
    expect(efectoDeDeshacer(antes, filaDe(antes, "Rojo"))).toEqual({ ...sinCambios, valores: ["Rojo"] })
  })

  it("an option that is gone blocks the undo and says which one to bring back", () => {
    const inicial = hidratar(grupoColorTalle())
    const antes = aplicar(reductor(), inicial, { tipo: "quitarOpcion", opcionId: opcionId(inicial, "Talle") })
    const archivadas = filasEnOrden(antes).filter((f) => f.archivar)
    expect(archivadas.length).toBe(2)
    for (const fila of archivadas) {
      expect(efectoDeDeshacer(antes, fila)).toEqual({ ...sinCambios, bloqueo: 'Para deshacerlo, volvé a agregar la opción "Talle"' })
      // The reducer refuses with the same words.
      const refusada = aplicar(reductor(), antes, { tipo: "deshacerArchivo", filaId: fila.id })
      expect(refusada.aviso).toBe('Para deshacerlo, volvé a agregar la opción "Talle"')
    }
  })

  it("a row that is not pending archive has no effect to announce", () => {
    const estado = hidratar(grupoColor())
    expect(efectoDeDeshacer(estado, filaDe(estado, "Rojo"))).toEqual(sinCambios)
  })

  it("a stale message in the state is not taken for a refusal of the undo", () => {
    const inicial = hidratar(grupoColor())
    const refusado = aplicar(
      reductor(),
      inicial,
      { tipo: "quitarValor", valorId: valorId(inicial, "Color", "Rojo") },
      { tipo: "agregarOpcion", nombre: "" }
    )
    expect(refusado.aviso).not.toBeNull()
    expect(efectoDeDeshacer(refusado, filaDe(refusado, "Rojo"))).toEqual({ ...sinCambios, valores: ["Rojo"] })
  })
})

describe("efectoDeDeshacer: what the reducer does that a snapshot alone would miss", () => {
  it("rows the undo creates again are announced: Verde / S is added next to Azul / S coming back", () => {
    const inicial = hidratar(grupoColorTalle())
    const conVerde = aplicar(reductor(), inicial, { tipo: "agregarValor", opcionId: opcionId(inicial, "Color"), texto: "Verde" })
    expect(filasEnOrden(conVerde)).toHaveLength(6)
    const antes = aplicar(reductor(), conVerde, { tipo: "quitarValor", valorId: valorId(conVerde, "Talle", "S") })
    expect(pendientes(antes)).toEqual(["Azul / S", "Rojo / S"])

    const efecto = efectoDeDeshacer(antes, filaDe(antes, "Rojo / S"))
    expect(efecto).toEqual({ ...sinCambios, valores: ["S"], tambien: ["Azul / S"], nuevas: ["Verde / S"] })
    // And it is what happens.
    const despues = aplicar(reductor(), antes, { tipo: "deshacerArchivo", filaId: filaDe(antes, "Rojo / S").id })
    expect(filasEnOrden(despues).map((f) => etiquetaDeFila(despues, f))).toContain("Verde / S")
  })

  it("a child archived in the database that the undo brings back is announced as restored", () => {
    const lectura: GrupoLeido = {
      grupo: {
        id: "g1",
        nombre: "Funda X",
        opciones: [
          { nombre: "Color", valores: ["Rojo", "Azul", "Verde"] },
          { nombre: "Talle", valores: ["S", "M"] },
        ],
      },
      variantes: [
        ["Rojo", "S"],
        ["Rojo", "M"],
        ["Azul", "S"],
        ["Azul", "M"],
        ["Verde", "M"],
      ].map(([c, t]) => leida(`${c}-${t}`, [{ opcion: "Color", valor: c }, { opcion: "Talle", valor: t }], { stock: 1 })),
      archivadas: [{ id: "v-s", atributos: [{ opcion: "Color", valor: "Verde" }, { opcion: "Talle", valor: "S" }], stock: 4 }],
    }
    const inicial = hidratar(lectura)
    const antes = aplicar(reductor(), inicial, { tipo: "quitarValor", valorId: valorId(inicial, "Talle", "S") })
    const efecto = efectoDeDeshacer(antes, filaDe(antes, "Rojo / S"))
    expect(efecto.restauradas).toEqual(["Verde / S"])
    expect(efecto.nuevas).toEqual([])
    expect(efecto.tambien).toEqual(["Azul / S"])
  })

  it("a refusal for the limit of combinations is announced before the click, in the reducer's words", () => {
    const diez = (p: string) => Array.from({ length: 10 }, (_, i) => `${p}${i + 1}`)
    const lectura: GrupoLeido = {
      grupo: {
        id: "g1",
        nombre: "Funda X",
        opciones: [
          { nombre: "Color", valores: diez("V") },
          { nombre: "Talle", valores: diez("T") },
        ],
      },
      variantes: diez("V").flatMap((v) => diez("T").map((t) => leida(`${v}-${t}`, [{ opcion: "Color", valor: v }, { opcion: "Talle", valor: t }]))),
      archivadas: [],
    }
    const inicial = hidratar(lectura)
    const antes = aplicar(
      reductor(),
      inicial,
      { tipo: "quitarValor", valorId: valorId(inicial, "Talle", "T10") },
      { tipo: "agregarValor", opcionId: opcionId(inicial, "Color"), texto: "V11" }
    )
    expect(antes.aviso).toBeNull()
    const efecto = efectoDeDeshacer(antes, filaDe(antes, "V1 / T10"))
    expect(efecto).toEqual({ ...sinCambios, bloqueo: "Las opciones generan 110 combinaciones y el máximo es 100" })
    expect(aplicar(reductor(), antes, { tipo: "deshacerArchivo", filaId: filaDe(antes, "V1 / T10").id }).aviso).toBe(efecto.bloqueo)
  })

  it("a value that now exists under that text is a refusal too", () => {
    const inicial = hidratar(grupoColor())
    const antes = aplicar(
      reductor(),
      inicial,
      { tipo: "quitarValor", valorId: valorId(inicial, "Color", "Rojo") },
      { tipo: "renombrarValor", valorId: valorId(inicial, "Color", "Azul"), texto: "Rojo" }
    )
    const efecto = efectoDeDeshacer(antes, antes.filas[filasEnOrden(antes).find((f) => f.archivar)!.id])
    expect(efecto).toEqual({ ...sinCambios, bloqueo: 'El valor "Rojo" está repetido en Color' })
  })
})

describe("describirEfecto: the sentence shown before pressing undo", () => {
  const con = (parcial: Partial<EfectoDeDeshacer>): EfectoDeDeshacer => ({ ...sinCambios, ...parcial })

  it("is nothing when nothing else happens", () => {
    expect(describirEfecto(sinCambios)).toBeNull()
  })

  it("a refusal is the reason, alone", () => {
    expect(describirEfecto(con({ bloqueo: "No se puede", valores: ["S"] }))).toBe("No se puede")
  })

  it("uses the singular for one and the plural for several, and 'y' before the last item of every list", () => {
    const casos: [Partial<EfectoDeDeshacer>, string[]][] = [
      [{ valores: ["S"] }, ["Al deshacer se vuelve a agregar S"]],
      [{ valores: ["S", "M"] }, ["Al deshacer se vuelven a agregar S y M"]],
      [{ valores: ["S", "M", "L"] }, ["Al deshacer se vuelven a agregar S, M y L"]],
      [{ tambien: ["Azul / S"] }, ["Al deshacer también vuelve Azul / S"]],
      [{ tambien: ["Azul / S", "Rojo / S"] }, ["Al deshacer también vuelven Azul / S y Rojo / S"]],
      [{ tambien: ["Azul / S", "Rojo / S", "Negro / S"] }, ["Al deshacer también vuelven Azul / S, Rojo / S y Negro / S"]],
      [{ nuevas: ["Verde / S"] }, ["Al deshacer se agrega Verde / S"]],
      [{ nuevas: ["Verde / S", "Verde / M"] }, ["Al deshacer se agregan Verde / S y Verde / M"]],
      [{ nuevas: ["Verde / S", "Verde / M", "Verde / L"] }, ["Al deshacer se agregan Verde / S, Verde / M y Verde / L"]],
      [{ restauradas: ["Negro / S"] }, ["Al deshacer se restaura Negro / S"]],
      [{ restauradas: ["Negro / S", "Negro / M"] }, ["Al deshacer se restauran Negro / S y Negro / M"]],
      [{ restauradas: ["Negro / S", "Negro / M", "Negro / L"] }, ["Al deshacer se restauran Negro / S, Negro / M y Negro / L"]],
    ]
    for (const [parcial, [esperado]] of casos) expect(describirEfecto(con(parcial))).toBe(esperado)
  })

  it("joins everything that happens in one sentence", () => {
    expect(describirEfecto(con({ valores: ["S"], tambien: ["Azul / S"] }))).toBe("Al deshacer se vuelve a agregar S y también vuelve Azul / S")
    expect(describirEfecto(con({ valores: ["S"], tambien: ["Azul / S"], nuevas: ["Verde / S"] }))).toBe(
      "Al deshacer se vuelve a agregar S, también vuelve Azul / S y se agrega Verde / S"
    )
    expect(describirEfecto(con({ valores: ["S"], tambien: ["Azul / S"], nuevas: ["Verde / S"], restauradas: ["Negro / S"] }))).toBe(
      "Al deshacer se vuelve a agregar S, también vuelve Azul / S, se agrega Verde / S y se restaura Negro / S"
    )
  })

  it("with a list of two or more inside a clause, the clauses are told apart with ';' and 'y' goes only before the last one", () => {
    expect(describirEfecto(con({ valores: ["S", "M"], tambien: ["Azul / S", "Azul / M"] }))).toBe(
      "Al deshacer se vuelven a agregar S y M; y también vuelven Azul / S y Azul / M"
    )
    expect(describirEfecto(con({ valores: ["S", "M"], tambien: ["Azul / S", "Azul / M"], nuevas: ["Verde / S"] }))).toBe(
      "Al deshacer se vuelven a agregar S y M; también vuelven Azul / S y Azul / M; y se agrega Verde / S"
    )
    expect(describirEfecto(con({ valores: ["S"], tambien: ["Azul / S", "Rojo / S"] }))).toBe(
      "Al deshacer se vuelve a agregar S; y también vuelven Azul / S y Rojo / S"
    )
    expect(describirEfecto(con({ valores: ["S"], nuevas: ["Verde / S", "Verde / M", "Verde / L"], restauradas: ["Negro / S"] }))).toBe(
      "Al deshacer se vuelve a agregar S; se agregan Verde / S, Verde / M y Verde / L; y se restaura Negro / S"
    )
  })

  it("a list of two or more in the only clause keeps the plain form, and single items keep the comma-y form", () => {
    expect(describirEfecto(con({ tambien: ["Azul / S", "Azul / M"] }))).toBe("Al deshacer también vuelven Azul / S y Azul / M")
    expect(describirEfecto(con({ valores: ["S"], tambien: ["Azul / S"], nuevas: ["Verde / S"], restauradas: ["Negro / S"] }))).toBe(
      "Al deshacer se vuelve a agregar S, también vuelve Azul / S, se agrega Verde / S y se restaura Negro / S"
    )
  })
})

describe("validezDeVariantes: what stops the product from being saved", () => {
  const conCodigos = (estado: VariantesState, codigos: Record<string, string>) =>
    aplicar(reductor(), estado, ...Object.entries(codigos).map(([etiqueta, codigo]) => ({ tipo: "editarFila" as const, filaId: filaDe(estado, etiqueta).id, cambios: { codigo } })))

  it("a product without variants has nothing to validate, whatever the leftover state says", () => {
    const apagado = aplicar(reductor(), estadoActivo(), { tipo: "desactivar" })
    expect(validezDeVariantes(apagado)).toEqual({ valida: true, motivos: [] })
  })

  it("turned on with no combination, it asks to build them", () => {
    expect(validezDeVariantes(estadoActivo())).toEqual({
      valida: false,
      motivos: ["Agregá una opción (por ejemplo Color) con al menos un valor para armar las variantes"],
    })
  })

  it("a complete set of new rows is valid", () => {
    expect(validezDeVariantes(estadoColor())).toEqual({ valida: true, motivos: [] })
    expect(validezDeVariantes(hidratar(grupoColor()))).toEqual({ valida: true, motivos: [] })
  })

  it("a row with reserved units pending archive blocks, in the reducer's words", () => {
    const reservada = hidratar({
      ...grupoColor(),
      variantes: [leida("r1", [{ opcion: "Color", valor: "Rojo" }], { stock: 5, stockReservado: 2 }), ...grupoColor().variantes.slice(1)],
    })
    const antes = aplicar(reductor(), reservada, { tipo: "quitarValor", valorId: valorId(reservada, "Color", "Rojo") })
    expect(validezDeVariantes(antes)).toEqual({ valida: false, motivos: ['No se puede archivar "Rojo": tiene 2 unidades reservadas'] })
    // Undoing it clears the block.
    const deshecho = aplicar(reductor(), antes, { tipo: "deshacerArchivo", filaId: filaDe(antes, "Rojo").id })
    expect(validezDeVariantes(deshecho).valida).toBe(true)
  })

  it("a new row needs a code, and blanks do not count", () => {
    const estado = conCodigos(estadoColor(), { Rojo: "   ", Azul: "AZ-1" })
    expect(validezDeVariantes(estado)).toEqual({ valida: false, motivos: ['Falta el código de "Rojo"'] })
    expect(validezDeVariantes(conCodigos(estado, { Rojo: "RO-1" })).valida).toBe(true)
  })

  it("a saved row that came back from the archive keeps its code, so a blank is fine", () => {
    const guardado = hidratar(grupoColor())
    const conVerde = aplicar(reductor(), guardado, { tipo: "agregarValor", opcionId: opcionId(guardado, "Color"), texto: "Verde" })
    expect(filaDe(conVerde, "Verde").codigo).toBe("")
    expect(validezDeVariantes(conVerde).valida).toBe(true)
  })

  it("two rows cannot share a code, however it is written", () => {
    const estado = conCodigos(estadoColor(), { Rojo: "AB-1", Azul: " ab-1 " })
    expect(validezDeVariantes(estado)).toEqual({ valida: false, motivos: ['El código "AB-1" está repetido'] })
    expect(validezDeVariantes(conCodigos(estado, { Azul: "AB-2" })).valida).toBe(true)
  })

  it("a row pending archive does not take its code from the others", () => {
    const guardado = hidratar(grupoColor())
    const sinRojo = aplicar(reductor(), guardado, { tipo: "quitarValor", valorId: valorId(guardado, "Color", "Rojo") })
    const copiado = conCodigos(sinRojo, { Azul: filaDe(guardado, "Rojo").codigo })
    expect(validezDeVariantes(copiado).valida).toBe(true)
  })

  it("lists every problem, not just the first", () => {
    const estado = conCodigos(estadoColor(), { Rojo: "", Azul: "" })
    expect(validezDeVariantes(estado).motivos).toEqual(['Falta el código de "Rojo"', 'Falta el código de "Azul"'])
  })
})

describe("validezDeVariantes: what the save schema would reject", () => {
  /** Sets a barcode as it could arrive from a hydrated row (the reducer trims what is typed, the database may not). */
  const conBarcode = (estado: VariantesState, codigos: Record<string, string | null>): VariantesState => {
    const filas = { ...estado.filas }
    for (const [etiqueta, barcode] of Object.entries(codigos)) {
      const fila = filaDe(estado, etiqueta)
      filas[fila.id] = { ...fila, barcode }
    }
    return { ...estado, filas }
  }
  const REPETIDOS = "Hay códigos de barras repetidos"

  it("an option without values next to one that has them is invalid, and says which", () => {
    const estado = aplicar(reductor(), estadoColor(), { tipo: "agregarOpcion", nombre: "Talle" })
    expect(estado.opciones.map((o) => o.valores.length)).toEqual([2, 0])
    expect(filasEnOrden(estado)).toHaveLength(2)
    expect(validezDeVariantes(estado)).toEqual({ valida: false, motivos: ['Falta al menos un valor en "Talle"'] })
  })

  it("names every empty option, and filling it makes the product valid again", () => {
    const dos = aplicar(reductor(), estadoColor(), { tipo: "agregarOpcion", nombre: "Talle" }, { tipo: "agregarOpcion", nombre: "Material" })
    expect(validezDeVariantes(dos).motivos).toEqual(['Falta al menos un valor en "Talle"', 'Falta al menos un valor en "Material"'])
    const lleno = aplicar(reductor(), dos, { tipo: "agregarValor", opcionId: opcionId(dos, "Talle"), texto: "S" }, { tipo: "agregarValor", opcionId: opcionId(dos, "Material"), texto: "Cuero" })
    expect(validezDeVariantes(lleno)).toEqual({ valida: true, motivos: [] })
  })

  it("with no combination at all the guide is shown, and an empty option is named too", () => {
    const estado = aplicar(reductor(), estadoActivo(), { tipo: "agregarOpcion", nombre: "Color" })
    expect(validezDeVariantes(estado).motivos).toEqual([
      "Agregá una opción (por ejemplo Color) con al menos un valor para armar las variantes",
      'Falta al menos un valor en "Color"',
    ])
  })

  it("two rows with the same barcode are invalid, with the schema's words", () => {
    const estado = conBarcode(estadoColor(), { Rojo: "7791", Azul: "7791" })
    expect(validezDeVariantes(estado)).toEqual({ valida: false, motivos: [REPETIDOS] })
    expect(validezDeVariantes(conBarcode(estado, { Azul: "7792" })).valida).toBe(true)
  })

  it("compares after the spaces at the ends are removed, as the schema does", () => {
    const estado = conBarcode(estadoColor(), { Rojo: "7791", Azul: "  7791 " })
    expect(validezDeVariantes(estado).motivos).toEqual([REPETIDOS])
  })

  it("is case sensitive, like the schema", () => {
    expect(validezDeVariantes(conBarcode(estadoColor(), { Rojo: "ab-1", Azul: "AB-1" })).valida).toBe(true)
  })

  it("rows without a barcode are not duplicates of each other", () => {
    expect(validezDeVariantes(estadoColor()).valida).toBe(true)
    expect(validezDeVariantes(conBarcode(estadoColor(), { Rojo: "", Azul: "   " })).valida).toBe(true)
    expect(validezDeVariantes(conBarcode(estadoColor(), { Rojo: null, Azul: null })).valida).toBe(true)
  })

  it("a barcode on a row pending archive does not collide with the others", () => {
    const guardado = hidratar(grupoColor())
    const sinRojo = aplicar(reductor(), guardado, { tipo: "quitarValor", valorId: valorId(guardado, "Color", "Rojo") })
    const estado = conBarcode(sinRojo, { Rojo: "7791", Azul: "7791" })
    expect(validezDeVariantes(estado).valida).toBe(true)
  })

  it("a saved row whose code was cleared cannot be saved", () => {
    const guardado = hidratar(grupoColor())
    const vacio = aplicar(reductor(), guardado, { tipo: "editarFila", filaId: filaDe(guardado, "Rojo").id, cambios: { codigo: "  " } })
    expect(filaDe(vacio, "Rojo").codigoTocado).toBe(true)
    expect(validezDeVariantes(vacio)).toEqual({ valida: false, motivos: ['Falta el código de "Rojo"'] })
  })

  it("a saved row whose code was never touched stays valid, even if the code is unknown to the client", () => {
    const guardado = hidratar(grupoColor())
    const sinCodigo = { ...guardado, filas: { ...guardado.filas, [filaDe(guardado, "Rojo").id]: { ...filaDe(guardado, "Rojo"), codigo: "", codigoTocado: false } } }
    expect(validezDeVariantes(sinCodigo).valida).toBe(true)
  })

  it("a row brought back from the archive may keep its code, but not blank it after touching it", () => {
    const guardado = hidratar(grupoColor())
    const conVerde = aplicar(reductor(), guardado, { tipo: "agregarValor", opcionId: opcionId(guardado, "Color"), texto: "Verde" })
    expect(validezDeVariantes(conVerde).valida).toBe(true)
    const tocado = aplicar(reductor(), conVerde, { tipo: "editarFila", filaId: filaDe(conVerde, "Verde").id, cambios: { codigo: "V-1" } }, { tipo: "editarFila", filaId: filaDe(conVerde, "Verde").id, cambios: { codigo: "" } })
    expect(validezDeVariantes(tocado)).toEqual({ valida: false, motivos: ['Falta el código de "Verde"'] })
  })
})
