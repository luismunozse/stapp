import { describe, it, expect, vi } from "vitest"
import { fireEvent, screen } from "@testing-library/react"
import { CombinacionesCards } from "@/components/inventario/variantes/combinacion-card"
import { CombinacionesTabla } from "@/components/inventario/variantes/combinaciones-tabla"
import { efectoDeDeshacer, efectosDeDeshacer } from "@/components/inventario/variantes/vista"
import { etiquetaDeFila, filasEnOrden, type GrupoLeido, type VariantesState } from "@/lib/variantes-filas"
import { aplicar, reductor, filaDe, grupoColorTalle, hidratar, leida, opcionId, valorId } from "../helpers/variantes-filas"
import { estadoColor, montar } from "../helpers/variantes-ui"

// Counts how many times anything asks the reducer to undo an archive: that is the cost of the preview.
const contador = vi.hoisted(() => ({ deshacer: 0 }))
vi.mock("@/lib/variantes-filas", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/variantes-filas")>()
  return {
    ...real,
    crearReductor: () => {
      const reducir = real.crearReductor()
      return (estado: VariantesState, accion: Parameters<typeof reducir>[1]) => {
        if (accion.tipo === "deshacerArchivo") contador.deshacer++
        return reducir(estado, accion)
      }
    },
  }
})

vi.mock("@/components/inventario/quick-stock-adjust", () => ({
  QuickStockAdjust: (p: { currentStock: number }) => <button type="button">{p.currentStock}</button>,
}))

const diez = (p: string) => Array.from({ length: 10 }, (_, i) => `${p}${i + 1}`)

/** Color V1..V10 x Talle T1..T10, all saved. */
const cien = (): GrupoLeido => ({
  grupo: { id: "g1", nombre: "Funda X", opciones: [{ nombre: "Color", valores: diez("V") }, { nombre: "Talle", valores: diez("T") }] },
  variantes: diez("V").flatMap((v) => diez("T").map((t) => leida(`${v}-${t}`, [{ opcion: "Color", valor: v }, { opcion: "Talle", valor: t }], { stock: 1 }))),
  archivadas: [],
})

/** 90 rows pending archive: the nine Talle values T1..T9 removed. */
/** Color x Talle x Material, eight saved rows. */
const tresOpciones = (): GrupoLeido => {
  const colores = ["Rojo", "Azul"], talles = ["S", "M"], materiales = ["Cuero", "Tela"]
  return {
    grupo: { id: "g1", nombre: "Funda X", opciones: [{ nombre: "Color", valores: colores }, { nombre: "Talle", valores: talles }, { nombre: "Material", valores: materiales }] },
    variantes: colores.flatMap((c) =>
      talles.flatMap((ta) => materiales.map((m) => leida(`${c}-${ta}-${m}`, [{ opcion: "Color", valor: c }, { opcion: "Talle", valor: ta }, { opcion: "Material", valor: m }], { stock: 1 })))
    ),
    archivadas: [],
  }
}

const noventaPendientes = () => {
  const inicial = hidratar(cien())
  return aplicar(reductor(), inicial, ...diez("T").slice(0, 9).map((t) => ({ tipo: "quitarValor" as const, valorId: valorId(inicial, "Talle", t) })))
}

const porFila = (estado: VariantesState) =>
  filasEnOrden(estado)
    .filter((f) => f.archivar)
    .map((f) => [f.id, etiquetaDeFila(estado, f)] as const)

describe("efectosDeDeshacer: one answer per row, the same as asking row by row", () => {
  const escenarios: [string, () => VariantesState][] = [
    ["a value removed from a two-option group", () => {
      const e = hidratar(grupoColorTalle())
      return aplicar(reductor(), e, { tipo: "quitarValor", valorId: valorId(e, "Talle", "S") })
    }],
    ["two different values removed (rows with different needs)", () => {
      const e = hidratar(grupoColorTalle())
      return aplicar(reductor(), e, { tipo: "quitarValor", valorId: valorId(e, "Talle", "S") }, { tipo: "quitarValor", valorId: valorId(e, "Color", "Rojo") })
    }],
    ["new rows that the undo creates again", () => {
      const e = hidratar(grupoColorTalle())
      const conVerde = aplicar(reductor(), e, { tipo: "agregarValor", opcionId: opcionId(e, "Color"), texto: "Verde" })
      return aplicar(reductor(), conVerde, { tipo: "quitarValor", valorId: valorId(conVerde, "Talle", "S") })
    }],
    ["an option that is gone", () => {
      const e = hidratar(grupoColorTalle())
      return aplicar(reductor(), e, { tipo: "quitarOpcion", opcionId: opcionId(e, "Talle") })
    }],
    ["a value that now exists under the same text", () => {
      const e = hidratar(grupoColorTalle())
      return aplicar(
        reductor(),
        e,
        { tipo: "quitarValor", valorId: valorId(e, "Talle", "S") },
        { tipo: "renombrarValor", valorId: valorId(e, "Talle", "M"), texto: "S" }
      )
    }],
    ["two different options gone, each with its own pending rows", () => {
      const e = hidratar(tresOpciones())
      return aplicar(reductor(), e, { tipo: "quitarOpcion", opcionId: opcionId(e, "Talle") }, { tipo: "quitarOpcion", opcionId: opcionId(e, "Material") })
    }],
    ["three values removed from a ten by ten group", () => {
      const e = hidratar(cien())
      return aplicar(reductor(), e, ...["T1", "T5", "T10"].map((t) => ({ tipo: "quitarValor" as const, valorId: valorId(e, "Talle", t) })))
    }],
    ["the limit of combinations", () => {
      const e = hidratar(cien())
      return aplicar(
        reductor(),
        e,
        { tipo: "quitarValor", valorId: valorId(e, "Talle", "T10") },
        { tipo: "agregarValor", opcionId: opcionId(e, "Color"), texto: "V11" }
      )
    }],
  ]

  it.each(escenarios)("%s", (_nombre, armar) => {
    const estado = armar()
    const pendientes = filasEnOrden(estado).filter((f) => f.archivar)
    expect(pendientes.length).toBeGreaterThan(0)
    const todos = efectosDeDeshacer(estado)
    expect([...todos.keys()].sort()).toEqual(pendientes.map((f) => f.id).sort())
    for (const fila of pendientes) expect(todos.get(fila.id)).toEqual(efectoDeDeshacer(estado, fila))
  })

  it("rows with nothing pending give an empty map", () => {
    expect(efectosDeDeshacer(hidratar(grupoColorTalle())).size).toBe(0)
  })
})

describe("efectosDeDeshacer: cost", () => {
  it("asks the reducer once per distinct need, not once per row: 90 pending rows over 9 removed values", () => {
    const estado = noventaPendientes()
    expect(porFila(estado)).toHaveLength(90)
    contador.deshacer = 0
    const efectos = efectosDeDeshacer(estado)
    expect(efectos.size).toBe(90)
    expect(contador.deshacer).toBeLessThanOrEqual(9)
    // Each one still knows the nine other rows of its value that come back with it.
    const alguno = efectos.get(filaDe(estado, "V3 / T4").id)!
    expect(alguno.valores).toEqual(["T4"])
    expect(alguno.tambien).toHaveLength(9)
  })

  it("a refusal about the values (the limit) is asked once for the rows that share it", () => {
    const e = hidratar(cien())
    const estado = aplicar(
      reductor(),
      e,
      { tipo: "quitarValor", valorId: valorId(e, "Talle", "T10") },
      { tipo: "agregarValor", opcionId: opcionId(e, "Color"), texto: "V11" }
    )
    expect(filasEnOrden(estado).filter((f) => f.archivar)).toHaveLength(10)
    contador.deshacer = 0
    const efectos = efectosDeDeshacer(estado)
    expect(contador.deshacer).toBe(1)
    expect([...efectos.values()].every((x) => x.bloqueo === "Las opciones generan 110 combinaciones y el máximo es 100")).toBe(true)
  })

  it("rows that cannot share an answer are asked separately", () => {
    const e = hidratar(grupoColorTalle())
    const estado = aplicar(reductor(), e, { tipo: "quitarValor", valorId: valorId(e, "Talle", "S") }, { tipo: "quitarValor", valorId: valorId(e, "Color", "Rojo") })
    contador.deshacer = 0
    efectosDeDeshacer(estado)
    // r-s needs Rojo and S, r-m needs Rojo, a-s needs S: three different needs.
    expect(contador.deshacer).toBe(3)
  })
})

describe("the rows do not recompute the preview on every edit", () => {
  const vistas: [string, (estado: VariantesState, dispatch: Parameters<Parameters<typeof montar>[1]>[1]) => React.ReactNode][] = [
    ["tabla", (estado, dispatch) => <CombinacionesTabla estado={estado} dispatch={dispatch} />],
    ["tarjetas", (estado, dispatch) => <CombinacionesCards estado={estado} dispatch={dispatch} />],
  ]

  it.each(vistas)("%s: 90 pending rows over 9 values ask the reducer at most 9 times", (_nombre, vista) => {
    contador.deshacer = 0
    montar(noventaPendientes(), vista)
    expect(contador.deshacer).toBeGreaterThan(0)
    expect(contador.deshacer).toBeLessThanOrEqual(9)
  })

  it.each(vistas)("%s: typing in a code, a price or a stock does not ask the reducer again", (_nombre, vista) => {
    const base = noventaPendientes()
    // The ten active rows (V1..V10 x T10) sit next to the 90 pending ones.
    const { salida } = montar(base, vista)
    contador.deshacer = 0
    const codigo = screen.getAllByLabelText("Código de V1 / T10")[0]
    fireEvent.change(codigo, { target: { value: "NUEVO-1" } })
    fireEvent.change(codigo, { target: { value: "NUEVO-12" } })
    const precio = screen.getAllByLabelText("Precio de V1 / T10")[0]
    fireEvent.change(precio, { target: { value: "1500" } })
    fireEvent.blur(precio)
    expect(salida.estado.filas[filaDe(salida.estado, "V1 / T10").id].codigo).toBe("NUEVO-12")
    expect(contador.deshacer).toBe(0)
  })

  it("changing what a pending row means (a removed value) does ask again", () => {
    const e = hidratar(grupoColorTalle())
    const conL = aplicar(reductor(), e, { tipo: "agregarValor", opcionId: opcionId(e, "Talle"), texto: "L" })
    const estado = aplicar(reductor(), conL, { tipo: "quitarValor", valorId: valorId(conL, "Talle", "S") })
    const { salida } = montar(estado, (s, d) => <CombinacionesTabla estado={s} dispatch={d} />)
    contador.deshacer = 0
    salida.despachar({ tipo: "quitarValor", valorId: valorId(salida.estado, "Talle", "M") })
    expect(contador.deshacer).toBeGreaterThan(0)
    expect(screen.getAllByText("Al deshacer se vuelve a agregar M", { exact: false }).length).toBeGreaterThan(0)
  })

  it("renaming a value shows in the preview: the structure includes the texts", () => {
    const e = hidratar(grupoColorTalle())
    const estado = aplicar(reductor(), e, { tipo: "quitarValor", valorId: valorId(e, "Talle", "S") })
    const { salida } = montar(estado, (s, d) => <CombinacionesTabla estado={s} dispatch={d} />)
    expect(screen.getAllByText("Al deshacer se vuelve a agregar S y también vuelve Azul / S").length).toBe(1)
    salida.despachar({ tipo: "renombrarValor", valorId: valorId(salida.estado, "Color", "Azul"), texto: "Celeste" })
    expect(screen.getAllByText("Al deshacer se vuelve a agregar S y también vuelve Celeste / S").length).toBe(1)
  })

  it("previews handed in by the caller are used as they are: the table computes nothing", () => {
    const estado = noventaPendientes()
    const efectos = efectosDeDeshacer(estado)
    contador.deshacer = 0
    montar(estado, (s, d) => <CombinacionesTabla estado={s} dispatch={d} efectos={efectos} />)
    montar(estado, (s, d) => <CombinacionesCards estado={s} dispatch={d} efectos={efectos} />)
    expect(contador.deshacer).toBe(0)
    expect(screen.getAllByText(/Al deshacer se vuelve a agregar T4/).length).toBeGreaterThan(0)
  })

  it("an untouched colour table: the colour set is unchanged by typing into it", () => {
    const { salida } = montar(estadoColor(), (s, d) => <CombinacionesTabla estado={s} dispatch={d} />)
    contador.deshacer = 0
    fireEvent.change(screen.getByLabelText("Código de Rojo"), { target: { value: "R-1" } })
    expect(salida.estado.filas[filaDe(salida.estado, "Rojo").id].codigo).toBe("R-1")
    expect(contador.deshacer).toBe(0)
  })
})
