import { describe, it, expect } from "vitest"
import { describirEfecto, efectoDeDeshacer, type EfectoDeDeshacer } from "@/components/inventario/variantes/vista"
import { filasEnOrden, etiquetaDeFila, type GrupoLeido, type VariantesState } from "@/lib/variantes-filas"
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

  it("uses the singular for one and the plural for several", () => {
    expect(describirEfecto(con({ valores: ["S"] }))).toBe("Al deshacer se vuelve a agregar S")
    expect(describirEfecto(con({ valores: ["S", "M"] }))).toBe("Al deshacer se vuelven a agregar S, M")
    expect(describirEfecto(con({ tambien: ["Azul / S"] }))).toBe("Al deshacer también vuelve Azul / S")
    expect(describirEfecto(con({ tambien: ["Azul / S", "Rojo / S"] }))).toBe("Al deshacer también vuelven Azul / S, Rojo / S")
    expect(describirEfecto(con({ nuevas: ["Verde / S"] }))).toBe("Al deshacer se agrega Verde / S")
    expect(describirEfecto(con({ nuevas: ["Verde / S", "Verde / M"] }))).toBe("Al deshacer se agregan Verde / S, Verde / M")
    expect(describirEfecto(con({ restauradas: ["Negro / S"] }))).toBe("Al deshacer se restaura Negro / S")
    expect(describirEfecto(con({ restauradas: ["Negro / S", "Negro / M"] }))).toBe("Al deshacer se restauran Negro / S, Negro / M")
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
})
