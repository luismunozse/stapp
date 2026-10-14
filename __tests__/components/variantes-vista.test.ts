import { describe, it, expect } from "vitest"
import { efectoDeDeshacer } from "@/components/inventario/variantes/vista"
import { filasEnOrden, etiquetaDeFila, type Fila, type PrevioDeFila, type VariantesState } from "@/lib/variantes-filas"
import { aplicar, reductor, filaDe, grupoColor, grupoColorTalle, hidratar, valorId, opcionId } from "../helpers/variantes-filas"

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

describe("efectoDeDeshacer: what undoing one archived row brings back", () => {
  it("one dimension: the value comes back and nothing else with it", () => {
    const antes = aplicar(reductor(), hidratar(grupoColor()), { tipo: "quitarValor", valorId: valorId(hidratar(grupoColor()), "Color", "Rojo") })
    const efecto = efectoDeDeshacer(antes, filaDe(antes, "Rojo"))
    expect(efecto).toEqual({ valores: ["Rojo"], tambien: [], bloqueo: null })
    expect(quienesVuelven(antes, "Rojo")).toEqual(["Rojo"])
  })

  it("two dimensions: the other pending rows of the same value come back too", () => {
    const inicial = hidratar(grupoColorTalle())
    const antes = aplicar(reductor(), inicial, { tipo: "quitarValor", valorId: valorId(inicial, "Talle", "S") })
    expect(pendientes(antes)).toEqual(["Azul / S", "Rojo / S"])

    const efecto = efectoDeDeshacer(antes, filaDe(antes, "Rojo / S"))
    expect(efecto).toEqual({ valores: ["S"], tambien: ["Azul / S"], bloqueo: null })
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
    const efecto = efectoDeDeshacer(antes, filaDe(antes, "Rojo / S"))
    expect(efecto).toEqual({ valores: ["S"], tambien: [], bloqueo: null })
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
    expect(efectoDeDeshacer(antes, filaDe(antes, "Rojo"))).toEqual({ valores: ["Rojo"], tambien: [], bloqueo: null })
  })

  it("an option that is gone blocks the undo and says which one to bring back", () => {
    const inicial = hidratar(grupoColorTalle())
    const antes = aplicar(reductor(), inicial, { tipo: "quitarOpcion", opcionId: opcionId(inicial, "Talle") })
    const archivadas = filasEnOrden(antes).filter((f) => f.archivar)
    expect(archivadas.length).toBe(2)
    for (const fila of archivadas) {
      expect(efectoDeDeshacer(antes, fila)).toEqual({ valores: [], tambien: [], bloqueo: 'Para deshacerlo, volvé a agregar la opción "Talle"' })
      // The reducer refuses with the same words.
      const refusada = aplicar(reductor(), antes, { tipo: "deshacerArchivo", filaId: fila.id })
      expect(refusada.aviso).toBe('Para deshacerlo, volvé a agregar la opción "Talle"')
    }
  })

  it("a row that is not pending archive has no effect to announce", () => {
    const estado = hidratar(grupoColor())
    expect(efectoDeDeshacer(estado, filaDe(estado, "Rojo"))).toEqual({ valores: [], tambien: [], bloqueo: null })
  })
})

/** A row pending archive made by hand, to reach states the reducer does not leave behind on its own. */
const pendiente = (estado: VariantesState, id: string, previos: PrevioDeFila[]): VariantesState => {
  const base = filasEnOrden(estado)[0]
  const fila: Fila = { ...base, id, valorIds: [], archivar: true, previos }
  return { ...estado, filas: { ...estado.filas, [id]: fila }, orden: [...estado.orden, id] }
}

describe("efectoDeDeshacer: rows the undo does not touch", () => {
  it("another pending row whose values all still exist is not announced", () => {
    const inicial = hidratar(grupoColorTalle())
    const quitado = aplicar(reductor(), inicial, { tipo: "quitarValor", valorId: valorId(inicial, "Talle", "S") })
    const color = quitado.opciones.find((o) => o.nombre === "Color")!
    const talle = quitado.opciones.find((o) => o.nombre === "Talle")!
    const completa = pendiente(quitado, "ya-completa", [
      { opcionId: color.id, valorId: color.valores[0].id, opcion: "Color", valor: "Rojo" },
      { opcionId: talle.id, valorId: talle.valores[0].id, opcion: "Talle", valor: talle.valores[0].texto },
    ])
    expect(efectoDeDeshacer(completa, filaDe(completa, "Rojo / S"))).toEqual({ valores: ["S"], tambien: ["Azul / S"], bloqueo: null })
  })

  it("a value that is not among the options is matched by its option and its text", () => {
    const inicial = hidratar(grupoColorTalle())
    const color = inicial.opciones.find((o) => o.nombre === "Color")!
    const talle = inicial.opciones.find((o) => o.nombre === "Talle")!
    const sinId = (opcion: typeof color, valor: string): PrevioDeFila => ({ opcionId: opcion.id, valorId: null, opcion: opcion.nombre, valor })
    let estado = pendiente(inicial, "verde-color", [sinId(color, "Verde")])
    estado = pendiente(estado, "verde-color-bis", [sinId(color, " verde ")])
    estado = pendiente(estado, "verde-talle", [sinId(talle, "Verde")])
    const efecto = efectoDeDeshacer(estado, estado.filas["verde-color"])
    expect(efecto.valores).toEqual(["Verde"])
    // Same option, same text up to case and edges: it comes back with it. Same text in ANOTHER option: it does not.
    expect(efecto.tambien).toHaveLength(1)
    expect(efecto.tambien).toEqual([etiquetaDeFila(estado, estado.filas["verde-color-bis"])])
  })
})
