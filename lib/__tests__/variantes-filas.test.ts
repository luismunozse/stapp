// @vitest-environment node
import { describe, it, expect } from "vitest"
import {
  archivosConStock,
  bloqueos,
  crearReductor,
  estadoDesdeGrupo,
  estadoInicial,
  filasEnOrden,
  stockTotal,
  type Fila,
  type VariantesAccion,
  type VariantesState,
} from "@/lib/variantes-filas"
import { LIMITES } from "@/lib/variantes-schema"
import {
  aplicar,
  etiquetas,
  filaDe,
  grupoColor,
  grupoColorTalle,
  hidratar,
  leida,
  opcionId,
  reductor,
  sinContenidoLocal,
  valorId,
} from "@/__tests__/helpers/variantes-filas"

const nuevo = (over: Partial<Parameters<typeof estadoInicial>[0]> = {}) =>
  estadoInicial({ grupoId: "cg1", codigoBase: "FX", precioBase: 1000, semilla: "nuevo-de-prueba", ...over })

/** A new product with Color {Rojo, Azul} typed in the form. */
function conColor(reducir = reductor()) {
  return aplicar(reducir, nuevo(), { tipo: "activar" }, { tipo: "agregarOpcion", nombre: "Color", valores: ["Rojo", "Azul"] })
}

describe("estadoInicial", () => {
  it("starts empty, off, with the base values given", () => {
    const e = estadoInicial({ grupoId: "cg1", codigoBase: "FX", precioBase: 1500, costoBase: 700, costoCargado: true })
    expect(e).toMatchObject({
      activo: false,
      grupoId: "cg1",
      promocionId: null,
      codigoBase: "FX",
      precioBase: 1500,
      costoBase: 700,
      costoCargado: true,
      aviso: null,
      opciones: [],
      filas: {},
      orden: [],
      archivadas: {},
    })
  })

  it("defaults the optional bases", () => {
    expect(estadoInicial({ grupoId: "cg1" })).toMatchObject({ codigoBase: "", precioBase: 0, costoBase: 0, costoCargado: false })
  })
})

describe("estadoDesdeGrupo", () => {
  it("builds options with ids and one saved row per active child, in combination order", () => {
    const e = hidratar(grupoColorTalle())
    expect(e.activo).toBe(true)
    expect(e.grupoId).toBe("g1")
    expect(e.opciones.map((o) => [o.nombre, o.valores.map((v) => v.texto)])).toEqual([
      ["Color", ["Rojo", "Azul"]],
      ["Talle", ["S", "M"]],
    ])
    expect(etiquetas(e)).toEqual(["Rojo / S", "Rojo / M", "Azul / S", "Azul / M"])
    expect(e.orden).toEqual(["r-s", "r-m", "a-s", "a-m"])
    const f = filaDe(e, "Rojo / M")
    expect(f.valorIds).toEqual([valorId(e, "Color", "Rojo"), valorId(e, "Talle", "M")])
  })

  it("marks saved rows as existing and touched, keeps their data and never prefills from the base", () => {
    const e = hidratar(
      grupoColor({
        variantes: [leida("r1", [{ opcion: "Color", valor: "Rojo" }], { stock: 5, stockReservado: 2, precioVenta: 1234, barcode: "779", ubicacion: "A1", stockMinimo: 2 })],
      })
    )
    expect(filaDe(e, "Rojo")).toMatchObject({
      id: "r1",
      existente: true,
      archivar: false,
      codigo: "FX-R1",
      codigoTocado: true,
      barcode: "779",
      precioVenta: 1234,
      precioTocado: true,
      precioCompra: 400,
      stockInicial: 0,
      stock: 5,
      stockReservado: 2,
      imagenUrl: null,
      extra: { stockMinimo: 2, stockMaximo: null, puntoReorden: null, ubicacion: "A1" },
    })
  })

  it("maps the values of a child to option order whatever order its attributes arrive in", () => {
    const e = hidratar(
      grupoColorTalle({
        variantes: [leida("r-m", [{ opcion: "Talle", valor: "M" }, { opcion: "Color", valor: "Rojo" }], { stock: 2 })],
      })
    )
    expect(filaDe(e, "Rojo / M").valorIds).toEqual([valorId(e, "Color", "Rojo"), valorId(e, "Talle", "M")])
  })

  it("turns a blank barcode into null", () => {
    const e = hidratar(grupoColor({ variantes: [leida("r1", [{ opcion: "Color", valor: "Rojo" }], { barcode: "  " })] }))
    expect(filaDe(e, "Rojo").barcode).toBeNull()
  })

  it("has no cost key at all without cost access, even if the payload carries one", () => {
    const sinCosto = hidratar(grupoColor({ variantes: [leida("r1", [{ opcion: "Color", valor: "Rojo" }], { precioCompra: 900 })] }), { costoCargado: false })
    expect(sinCosto.costoCargado).toBe(false)
    expect("precioCompra" in filaDe(sinCosto, "Rojo")).toBe(false)
    const nulo = hidratar(grupoColor({ variantes: [leida("r1", [{ opcion: "Color", valor: "Rojo" }], { precioCompra: null })] }), { costoCargado: false })
    expect("precioCompra" in filaDe(nulo, "Rojo")).toBe(false)
    const conCosto = hidratar(grupoColor({ variantes: [leida("r1", [{ opcion: "Color", valor: "Rojo" }], { precioCompra: 900 })] }))
    expect(filaDe(conCosto, "Rojo").precioCompra).toBe(900)
  })

  it("keeps a saved photo URL and drops a local one (G4)", () => {
    const e = hidratar(
      grupoColor({
        variantes: [
          leida("r1", [{ opcion: "Color", valor: "Rojo" }], { imagenUrl: "https://cdn.example/rojo.jpg" }),
          leida("a1", [{ opcion: "Color", valor: "Azul" }], { imagenUrl: "blob:http://localhost/abc" }),
        ],
      })
    )
    expect(filaDe(e, "Rojo").imagenUrl).toBe("https://cdn.example/rojo.jpg")
    expect(filaDe(e, "Azul").imagenUrl).toBeNull()
    sinContenidoLocal(e)
    const datos = hidratar(grupoColor({ variantes: [leida("r1", [{ opcion: "Color", valor: "Rojo" }], { imagenUrl: "data:image/png;base64,AAAA" })] }))
    expect(filaDe(datos, "Rojo").imagenUrl).toBeNull()
  })

  it("indexes the archived children by their canonical key", () => {
    const e = hidratar(grupoColor())
    // Verde is not among the options: the snapshot keeps the text and no ids.
    expect(e.archivadas).toEqual({ v1: { previos: [{ opcionId: opcionId(e, "Color"), valorId: null, opcion: "Color", valor: "Verde" }], stock: 7 } })
    expect(Object.keys(hidratar(grupoColor({ archivadas: [] })).archivadas)).toEqual([])
  })

  it("takes the base price from the first child when none is given, and 0 for an empty group", () => {
    const sinBase = estadoDesdeGrupo(grupoColor({ variantes: [leida("r1", [{ opcion: "Color", valor: "Rojo" }], { precioVenta: 1234 })] }), { costoCargado: false })
    expect(sinBase.precioBase).toBe(1234)
    expect(estadoDesdeGrupo(grupoColor({ variantes: [] }), { costoCargado: false }).precioBase).toBe(0)
    expect(estadoDesdeGrupo(grupoColor(), { costoCargado: false, precioBase: 50 }).precioBase).toBe(50)
  })

  it("ignores an archived child with no combination to match against", () => {
    const e = hidratar(
      grupoColor({
        archivadas: [
          { id: "n1", atributos: null, stock: 1 },
          { id: "v0", atributos: [], stock: 2 },
          { id: "v1", atributos: [{ opcion: "Color", valor: "Verde" }], stock: 7 },
        ],
      })
    )
    expect(Object.keys(e.archivadas)).toEqual(["v1"])
  })

  it("keeps a value that appears on a child but not in the group options", () => {
    const e = hidratar(grupoColor({ variantes: [leida("x1", [{ opcion: "Color", valor: "Verde" }])] }))
    expect(e.opciones[0].valores.map((v) => v.texto)).toEqual(["Rojo", "Azul", "Verde"])
    expect(etiquetas(e)).toEqual(["Verde"])
  })
})

describe("options and values", () => {
  it("the first value of the first option creates the first row, the next ones add rows", () => {
    const reducir = reductor()
    let e = aplicar(reducir, nuevo(), { tipo: "activar" }, { tipo: "agregarOpcion", nombre: "Color" })
    expect(e.opciones).toHaveLength(1)
    expect(filasEnOrden(e)).toEqual([])
    e = aplicar(reducir, e, { tipo: "agregarValor", opcionId: opcionId(e, "Color"), texto: "Rojo" })
    expect(etiquetas(e)).toEqual(["Rojo"])
    e = aplicar(reducir, e, { tipo: "agregarValor", opcionId: opcionId(e, "Color"), texto: "Azul" })
    expect(etiquetas(e)).toEqual(["Rojo", "Azul"])
    expect(filasEnOrden(e).every((f) => !f.existente && !f.archivar)).toBe(true)
  })

  it("derives the code of a new row from the base code and the values", () => {
    const e = conColor()
    expect(filaDe(e, "Rojo")).toMatchObject({ codigo: "FX-ROJ", codigoTocado: false, precioVenta: 1000, precioTocado: false, stockInicial: 0 })
    expect(filaDe(e, "Azul").codigo).toBe("FX-AZU")
  })

  it("gives a new row ids that the save RPC accepts when no generator is injected", () => {
    const e = aplicar(crearReductor(), nuevo(), { tipo: "agregarOpcion", nombre: "Color", valores: ["Rojo", "Azul"] })
    const ids = e.orden
    expect(ids).toHaveLength(2)
    for (const id of ids) expect(id).toMatch(/^c[0-9a-f]{24}$/)
    expect(new Set(ids).size).toBe(2)
  })

  it("a new row has no cost key without cost access and takes the base cost with it", () => {
    expect("precioCompra" in filaDe(conColor(), "Rojo")).toBe(false)
    const reducir = reductor()
    const con = aplicar(reducir, nuevo({ costoCargado: true, costoBase: 650 }), { tipo: "agregarOpcion", nombre: "Color", valores: ["Rojo"] })
    expect(filaDe(con, "Rojo").precioCompra).toBe(650)
  })

  it("adding an option keeps the rows and their ids and gives them its first value", () => {
    const reducir = reductor()
    const antes = conColor(reducir)
    const idRojo = filaDe(antes, "Rojo").id
    const idAzul = filaDe(antes, "Azul").id
    const e = aplicar(reducir, antes, { tipo: "agregarOpcion", nombre: "Talle", valores: ["S", "M"] })
    expect(etiquetas(e)).toEqual(["Rojo / S", "Rojo / M", "Azul / S", "Azul / M"])
    expect(filaDe(e, "Rojo / S").id).toBe(idRojo)
    expect(filaDe(e, "Azul / S").id).toBe(idAzul)
    expect(new Set(e.orden).size).toBe(4)
    expect(e.orden).toContain(idRojo)
    expect(filaDe(e, "Rojo / M")).toMatchObject({ existente: false, codigo: "FX-ROJ-M" })
  })

  it("adding the first value of an empty option extends every saved row without creating any", () => {
    const reducir = reductor()
    const saved = hidratar(grupoColor({ archivadas: [] }))
    let e = aplicar(reducir, saved, { tipo: "agregarOpcion", nombre: "Talle" })
    expect(etiquetas(e)).toEqual(["Rojo", "Azul"])
    e = aplicar(reducir, e, { tipo: "agregarValor", opcionId: opcionId(e, "Talle"), texto: "S" })
    expect(etiquetas(e)).toEqual(["Rojo / S", "Azul / S"])
    expect(e.orden).toEqual(["r1", "a1"])
    expect(filaDe(e, "Rojo / S")).toMatchObject({ existente: true, stock: 5, codigo: "FX-R1" })
  })

  it("adding a value to a populated option creates the missing combinations only", () => {
    const reducir = reductor()
    const saved = hidratar(grupoColorTalle())
    const e = aplicar(reducir, saved, { tipo: "agregarValor", opcionId: opcionId(saved, "Talle"), texto: "L" })
    expect(etiquetas(e)).toEqual(["Rojo / S", "Rojo / M", "Rojo / L", "Azul / S", "Azul / M", "Azul / L"])
    expect(e.orden.filter((id) => ["r-s", "r-m", "a-s", "a-m"].includes(id))).toHaveLength(4)
    expect(filaDe(e, "Azul / L")).toMatchObject({ existente: false, codigo: "FX-AZU-L" })
  })

  it("orders by option, then by value, whatever the order of insertion", () => {
    const reducir = reductor()
    let e = aplicar(reducir, nuevo(), { tipo: "agregarOpcion", nombre: "Talle", valores: ["M", "S"] })
    e = aplicar(reducir, e, { tipo: "agregarOpcion", nombre: "Color", valores: ["Rojo", "Azul"] })
    expect(etiquetas(e)).toEqual(["M / Rojo", "M / Azul", "S / Rojo", "S / Azul"])
    e = aplicar(reducir, e, { tipo: "agregarValor", opcionId: opcionId(e, "Talle"), texto: "L" })
    expect(etiquetas(e)).toEqual(["M / Rojo", "M / Azul", "S / Rojo", "S / Azul", "L / Rojo", "L / Azul"])
  })

  it("renaming a value keeps every id and changes only the text", () => {
    const reducir = reductor()
    const saved = hidratar(grupoColor())
    const idRojo = valorId(saved, "Color", "Rojo")
    const e = aplicar(reducir, saved, { tipo: "renombrarValor", valorId: idRojo, texto: "  Rojo oscuro " })
    expect(valorId(e, "Color", "Rojo oscuro")).toBe(idRojo)
    expect(e.orden).toEqual(["r1", "a1"])
    expect(etiquetas(e)).toEqual(["Rojo oscuro", "Azul"])
    expect(filaDe(e, "Rojo oscuro").stock).toBe(5)
  })

  it("renaming re-derives the code of an untouched new row only", () => {
    const reducir = reductor()
    let e = conColor(reducir)
    e = aplicar(reducir, e, { tipo: "renombrarValor", valorId: valorId(e, "Color", "Rojo"), texto: "Rosado" })
    expect(filaDe(e, "Rosado").codigo).toBe("FX-ROS")
    expect(filaDe(e, "Azul").codigo).toBe("FX-AZU")
    // A saved row keeps its code, whatever the new text would derive.
    const saved = hidratar(grupoColor())
    const renombrado = aplicar(reducir, saved, { tipo: "renombrarValor", valorId: valorId(saved, "Color", "Rojo"), texto: "Rosado" })
    expect(filaDe(renombrado, "Rosado").codigo).toBe("FX-R1")
  })

  it("re-deriving never collides with the code of another row", () => {
    const reducir = reductor()
    let e = conColor(reducir)
    e = aplicar(reducir, e, { tipo: "agregarValor", opcionId: opcionId(e, "Color"), texto: "Rosado" })
    // Rosado -> Rojo would derive FX-ROJ, which the row still named Rojo already holds.
    e = aplicar(reducir, e, { tipo: "renombrarValor", valorId: valorId(e, "Color", "Rosado"), texto: "Rojizo" })
    const codigos = filasEnOrden(e).map((f) => f.codigo)
    expect(new Set(codigos).size).toBe(codigos.length)
    expect(filaDe(e, "Rojo").codigo).toBe("FX-ROJ")
    expect(filaDe(e, "Rojizo").codigo).toBe("FX-ROJ-2")
  })

  it("renaming an option changes only its name", () => {
    const reducir = reductor()
    const e0 = conColor(reducir)
    const e = aplicar(reducir, e0, { tipo: "renombrarOpcion", opcionId: opcionId(e0, "Color"), nombre: "Tono" })
    expect(e.opciones[0]).toMatchObject({ id: e0.opciones[0].id, nombre: "Tono" })
    expect(e.orden).toEqual(e0.orden)
    expect(filaDe(e, "Rojo").codigo).toBe("FX-ROJ")
  })

  it("removing a value archives the saved rows (undoable) and drops the new ones", () => {
    const reducir = reductor()
    const saved = hidratar(grupoColorTalle())
    let e = aplicar(reducir, saved, { tipo: "quitarValor", valorId: valorId(saved, "Talle", "M") })
    expect(etiquetas(e)).toEqual(["Rojo / S", "Azul / S", "Rojo / M", "Azul / M"])
    expect(e.orden.slice(0, 2)).toEqual(["r-s", "a-s"])
    expect(e.orden.slice(2).sort()).toEqual(["a-m", "r-m"])
    expect(e.filas["r-m"]).toMatchObject({ archivar: true, existente: true, stock: 2, valorIds: [] })
    expect(e.filas["r-s"].archivar).toBe(false)
    expect(e.opciones[1].valores.map((v) => v.texto)).toEqual(["S"])

    // A row that was never saved simply disappears.
    e = aplicar(reducir, e, { tipo: "agregarValor", opcionId: opcionId(e, "Talle"), texto: "L" })
    const nuevaL = filaDe(e, "Rojo / L").id
    e = aplicar(reducir, e, { tipo: "quitarValor", valorId: valorId(e, "Talle", "L") })
    expect(e.filas[nuevaL]).toBeUndefined()
    expect(e.orden).not.toContain(nuevaL)
  })

  it("removing the only value of an option folds the dimension instead of archiving everything", () => {
    const reducir = reductor()
    const saved = hidratar(grupoColorTalle())
    let e = aplicar(reducir, saved, { tipo: "quitarValor", valorId: valorId(saved, "Color", "Azul") })
    expect(e.filas["a-s"].archivar).toBe(true)
    // Rojo is now the last value of Color: its rows lose the Color dimension and survive.
    e = aplicar(reducir, e, { tipo: "quitarValor", valorId: valorId(e, "Color", "Rojo") })
    expect(e.opciones[0].valores).toEqual([])
    expect(e.orden.slice(0, 2)).toEqual(["r-s", "r-m"])
    expect(etiquetas(e).slice(0, 2)).toEqual(["S", "M"])
    expect(e.filas["r-s"]).toMatchObject({ archivar: false, existente: true, stock: 1 })
    expect(e.filas["a-s"].archivar).toBe(true)
    expect(e.filas["a-m"].archivar).toBe(true)
  })

  it("removing an option keeps the first saved row of each combination and archives the others", () => {
    const reducir = reductor()
    const saved = hidratar(grupoColorTalle())
    const e = aplicar(reducir, saved, { tipo: "quitarOpcion", opcionId: opcionId(saved, "Talle") })
    expect(e.opciones.map((o) => o.nombre)).toEqual(["Color"])
    expect(etiquetas(e).slice(0, 2)).toEqual(["Rojo", "Azul"])
    expect(e.orden.slice(0, 2)).toEqual(["r-s", "a-s"])
    expect(e.filas["r-s"]).toMatchObject({ archivar: false, existente: true, stock: 1, valorIds: [valorId(e, "Color", "Rojo")] })
    expect(e.filas["r-m"]).toMatchObject({ archivar: true, stock: 2 })
    expect(e.filas["a-m"]).toMatchObject({ archivar: true, stock: 4 })
    expect(e.filas["r-m"].previos).toEqual([
      { opcionId: opcionId(saved, "Color"), valorId: valorId(saved, "Color", "Rojo"), opcion: "Color", valor: "Rojo" },
      { opcionId: opcionId(saved, "Talle"), valorId: valorId(saved, "Talle", "M"), opcion: "Talle", valor: "M" },
    ])
  })

  it("removing an option prefers a saved row to a new one and keeps the first new row otherwise", () => {
    const reducir = reductor()
    // Saved Rojo/S only, then Talle gets M (new) and Color gets Azul (new).
    const saved = hidratar(
      grupoColor({
        grupo: { id: "g1", nombre: "Funda X", opciones: [{ nombre: "Color", valores: ["Rojo"] }] },
        variantes: [leida("r1", [{ opcion: "Color", valor: "Rojo" }], { stock: 5 })],
        archivadas: [],
      })
    )
    let e = aplicar(reducir, saved, { tipo: "agregarOpcion", nombre: "Talle", valores: ["S", "M"] })
    const nuevaRojoM = filaDe(e, "Rojo / M").id
    expect(e.orden).toContain("r1")
    e = aplicar(reducir, e, { tipo: "quitarOpcion", opcionId: opcionId(e, "Talle") })
    expect(filaDe(e, "Rojo").id).toBe("r1")
    expect(e.filas[nuevaRojoM]).toBeUndefined()
    expect(e.orden).toEqual(["r1"])

    const solo = aplicar(reducir, nuevo(), { tipo: "agregarOpcion", nombre: "Color", valores: ["Rojo"] }, { tipo: "agregarOpcion", nombre: "Talle", valores: ["S", "M"] })
    const primera = filaDe(solo, "Rojo / S").id
    const sinTalle = aplicar(reducir, solo, { tipo: "quitarOpcion", opcionId: opcionId(solo, "Talle") })
    expect(sinTalle.orden).toEqual([primera])
  })

  it("removing an option keeps a saved row even when a new row of its combination comes first", () => {
    const reducir = reductor()
    // Only Rojo/M was saved: Rojo/S is created by the next value, ahead of it in combination order.
    const saved = hidratar(
      grupoColorTalle({
        grupo: { id: "g1", nombre: "Funda X", opciones: [{ nombre: "Color", valores: ["Rojo"] }, { nombre: "Talle", valores: ["S", "M"] }] },
        variantes: [leida("r-m", [{ opcion: "Color", valor: "Rojo" }, { opcion: "Talle", valor: "M" }], { stock: 2 })],
      })
    )
    let e = aplicar(reducir, saved, { tipo: "agregarValor", opcionId: opcionId(saved, "Talle"), texto: "L" })
    expect(etiquetas(e)).toEqual(["Rojo / S", "Rojo / M", "Rojo / L"])
    e = aplicar(reducir, e, { tipo: "quitarOpcion", opcionId: opcionId(e, "Talle") })
    expect(e.orden).toEqual(["r-m"])
    expect(e.filas["r-m"]).toMatchObject({ archivar: false, existente: true, stock: 2 })
  })

  it("rows pending archive take no part when an option gets its first value", () => {
    const reducir = reductor()
    const saved = hidratar(grupoColorTalle())
    const e = aplicar(
      reducir,
      saved,
      { tipo: "quitarValor", valorId: valorId(saved, "Talle", "M") },
      { tipo: "agregarOpcion", nombre: "Material", valores: ["Lana"] }
    )
    expect(e.filas["r-m"]).toMatchObject({ archivar: true, valorIds: [] })
    expect(e.filas["r-s"].valorIds).toHaveLength(3)
    expect(etiquetas(e).slice(0, 2)).toEqual(["Rojo / S / Lana", "Azul / S / Lana"])
  })

  it("undo still finds the option after it was renamed", () => {
    const reducir = reductor()
    const saved = hidratar(grupoColor())
    let e = aplicar(reducir, saved, { tipo: "quitarValor", valorId: valorId(saved, "Color", "Azul") })
    e = aplicar(reducir, e, { tipo: "renombrarOpcion", opcionId: opcionId(e, "Color"), nombre: "Tono" })
    expect(etiquetas(e).slice(1)).toEqual(["Azul"])
    expect(e.filas["a1"].previos).toEqual([{ opcionId: opcionId(e, "Tono"), valorId: valorId(saved, "Color", "Azul"), opcion: "Color", valor: "Azul" }])
    e = aplicar(reducir, e, { tipo: "deshacerArchivo", filaId: "a1" })
    expect(e.aviso).toBeNull()
    expect(etiquetas(e)).toEqual(["Rojo", "Azul"])
    expect(e.filas["a1"].archivar).toBe(false)
  })

  it("re-adding a saved-archived combination reuses its id and comes back as an existing row", () => {
    const reducir = reductor()
    const saved = hidratar(grupoColor())
    const e = aplicar(reducir, saved, { tipo: "agregarValor", opcionId: opcionId(saved, "Color"), texto: "verde" })
    expect(etiquetas(e)).toEqual(["Rojo", "Azul", "verde"])
    expect(filaDe(e, "verde")).toMatchObject({ id: "v1", existente: true, archivar: false, restaurada: true, stock: 7, stockReservado: 0 })
    expect(e.archivadas).toEqual({})
  })

  it("a restored row carries no code or price of its own: the client never saw them, so none can overwrite them", () => {
    const reducir = reductor()
    const saved = hidratar(grupoColor())
    const e = aplicar(reducir, saved, { tipo: "agregarValor", opcionId: opcionId(saved, "Color"), texto: "Verde" })
    const f = filaDe(e, "Verde")
    expect(f.codigo).toBe("")
    expect(f.codigoTocado).toBe(false)
    expect(f.precioTocado).toBe(false)
    // Its code does not feed the collision check of the next rows, and a rename never derives one for it.
    const renombrado = aplicar(reducir, e, { tipo: "renombrarValor", valorId: valorId(e, "Color", "Verde"), texto: "Verde agua" })
    expect(filaDe(renombrado, "Verde agua").codigo).toBe("")
  })

  it("re-adding a value removed in the same session reuses the row it archived", () => {
    const reducir = reductor()
    const saved = hidratar(grupoColor())
    let e = aplicar(reducir, saved, { tipo: "quitarValor", valorId: valorId(saved, "Color", "Azul") })
    expect(e.filas["a1"].archivar).toBe(true)
    e = aplicar(reducir, e, { tipo: "agregarValor", opcionId: opcionId(e, "Color"), texto: "AZUL" })
    expect(etiquetas(e)).toEqual(["Rojo", "AZUL"])
    expect(e.filas["a1"]).toMatchObject({ archivar: false, existente: true, stock: 3, codigo: "FX-A1" })
    expect(e.filas["a1"].previos).toBeUndefined()
    expect(e.orden).toEqual(["r1", "a1"])
    expect(Object.keys(e.filas)).toHaveLength(2)
  })

  it("undo brings back the value and every row it archived", () => {
    const reducir = reductor()
    const saved = hidratar(grupoColorTalle())
    let e = aplicar(reducir, saved, { tipo: "quitarValor", valorId: valorId(saved, "Talle", "M") })
    e = aplicar(reducir, e, { tipo: "deshacerArchivo", filaId: "r-m" })
    expect(etiquetas(e)).toEqual(["Rojo / S", "Rojo / M", "Azul / S", "Azul / M"])
    expect(e.filas["r-m"]).toMatchObject({ archivar: false, stock: 2 })
    expect(e.filas["a-m"].archivar).toBe(false)
    expect(e.opciones[1].valores.map((v) => v.texto)).toEqual(["S", "M"])
    expect(e.orden).toEqual(["r-s", "r-m", "a-s", "a-m"])
  })

  it("undo is refused with a reason when the option of the row is gone", () => {
    const reducir = reductor()
    const saved = hidratar(grupoColorTalle())
    const quitada = aplicar(reducir, saved, { tipo: "quitarOpcion", opcionId: opcionId(saved, "Talle") })
    const e = aplicar(reducir, quitada, { tipo: "deshacerArchivo", filaId: "r-m" })
    expect(e.aviso).toContain("Talle")
    expect(e.filas).toEqual(quitada.filas)
    expect(e.opciones).toEqual(quitada.opciones)
    expect(e.filas["r-m"].archivar).toBe(true)
  })

  it("undo of a row that is not pending archive does nothing", () => {
    const reducir = reductor()
    const saved = hidratar(grupoColor())
    const e = aplicar(reducir, saved, { tipo: "deshacerArchivo", filaId: "r1" })
    expect(e).toEqual(saved)
    expect(aplicar(reducir, saved, { tipo: "deshacerArchivo", filaId: "no-existe" })).toEqual(saved)
  })

  it("renaming never derives a code that another row already holds, saved rows included", () => {
    const reducir = reductor()
    const saved = hidratar(grupoColor({ variantes: [leida("r1", [{ opcion: "Color", valor: "Rojo" }], { codigo: "FX-ROJ" })], archivadas: [] }))
    let e = aplicar(reducir, saved, { tipo: "agregarValor", opcionId: opcionId(saved, "Color"), texto: "Rosa" })
    expect(filaDe(e, "Rosa").codigo).toBe("FX-ROS")
    e = aplicar(reducir, e, { tipo: "renombrarValor", valorId: valorId(e, "Color", "Rosa"), texto: "Roja" })
    expect(filaDe(e, "Roja").codigo).toBe("FX-ROJ-2")
    expect(filaDe(e, "Rojo").codigo).toBe("FX-ROJ")
  })

  it("a new row never takes a code a saved row already holds", () => {
    const reducir = reductor()
    const saved = hidratar(grupoColor({ variantes: [leida("r1", [{ opcion: "Color", valor: "Rojo" }], { codigo: "FX-ROS" })], archivadas: [] }))
    const e = aplicar(reducir, saved, { tipo: "agregarValor", opcionId: opcionId(saved, "Color"), texto: "Rosado" })
    expect(filaDe(e, "Rosado").codigo).toBe("FX-ROS-2")
  })

  it("a new row does not reuse the code of a row that is pending archive either", () => {
    const reducir = reductor()
    const saved = hidratar(grupoColor({ variantes: [leida("r1", [{ opcion: "Color", valor: "Rojo" }], { codigo: "FX-AZU" }), leida("a1", [{ opcion: "Color", valor: "Azul" }])], archivadas: [] }))
    let e = aplicar(reducir, saved, { tipo: "quitarValor", valorId: valorId(saved, "Color", "Rojo") })
    e = aplicar(reducir, e, { tipo: "agregarValor", opcionId: opcionId(e, "Color"), texto: "Azuleja" })
    expect(filaDe(e, "Azuleja").codigo).toBe("FX-AZU-2")
  })

  it("undo takes the row back when its values are all there and the combination is free", () => {
    const reducir = reductor()
    const saved = hidratar(grupoColorTalle())
    const quitada = aplicar(reducir, saved, { tipo: "quitarValor", valorId: valorId(saved, "Talle", "M") })
    // Only the value M is back (by hand): the combination slot is free and the row is still pending archive.
    const talle = quitada.opciones[1]
    const idM = valorId(saved, "Talle", "M") // the value comes back under the id the archived rows remember
    const manual: VariantesState = {
      ...quitada,
      opciones: [quitada.opciones[0], { ...talle, valores: [...talle.valores, { id: idM, texto: "M" }] }],
    }
    const e = aplicar(reducir, manual, { tipo: "deshacerArchivo", filaId: "r-m" })
    expect(e.aviso).toBeNull()
    expect(e.filas["r-m"]).toMatchObject({ archivar: false, valorIds: [quitada.filas["r-s"].valorIds[0], idM] })
  })

  it("undo is refused when another row already holds the combination", () => {
    const reducir = reductor()
    const saved = hidratar(grupoColorTalle())
    const quitada = aplicar(reducir, saved, { tipo: "quitarValor", valorId: valorId(saved, "Talle", "M") })
    // A row for Rojo / M appears behind the archived one (it cannot happen through the actions, so the state is built by hand).
    const talle = quitada.opciones[1]
    const idM = valorId(saved, "Talle", "M") // the value comes back under the id the archived rows remember
    const ocupante: Fila = { ...quitada.filas["r-s"], id: "intruso", valorIds: [quitada.filas["r-s"].valorIds[0], idM], existente: false }
    const manual: VariantesState = {
      ...quitada,
      opciones: [quitada.opciones[0], { ...talle, valores: [...talle.valores, { id: idM, texto: "M" }] }],
      filas: { ...quitada.filas, intruso: ocupante },
      orden: [...quitada.orden, "intruso"],
    }
    const e = aplicar(reducir, manual, { tipo: "deshacerArchivo", filaId: "r-m" })
    expect(e.aviso).toBe('Ya hay una variante con la combinación "Rojo / M"')
    expect(e.filas["r-m"].archivar).toBe(true)
  })

  it("never mutates its input and ignores an unknown id", () => {
    const reducir = reductor()
    const saved = hidratar(grupoColor())
    for (const accion of [
      { tipo: "quitarValor", valorId: "nada" },
      { tipo: "renombrarValor", valorId: "nada", texto: "X" },
      { tipo: "quitarOpcion", opcionId: "nada" },
      { tipo: "renombrarOpcion", opcionId: "nada", nombre: "X" },
      { tipo: "agregarValor", opcionId: "nada", texto: "X" },
    ] as const) {
      expect(aplicar(reducir, saved, accion)).toBe(saved)
    }
  })
})

describe("limits and validation (the state stays put and says why)", () => {
  function rechazada(e: VariantesState, accion: Parameters<ReturnType<typeof reductor>>[1], texto: RegExp) {
    const reducir = reductor()
    const resultado = aplicar(reducir, e, accion)
    expect(resultado.aviso).toMatch(texto)
    expect({ ...resultado, aviso: null }).toEqual({ ...e, aviso: null })
  }

  it("blocks a value that would take the combinations over 100, with a message", () => {
    const valores = (n: number) => Array.from({ length: n }, (_, i) => `v${i + 1}`)
    const reducir = reductor()
    const e = aplicar(reducir, nuevo(), { tipo: "agregarOpcion", nombre: "Color", valores: valores(10) }, { tipo: "agregarOpcion", nombre: "Talle", valores: valores(10) })
    expect(e.orden).toHaveLength(LIMITES.combinaciones)
    rechazada(e, { tipo: "agregarValor", opcionId: opcionId(e, "Talle"), texto: "extra" }, /110 combinaciones.*100/)
  })

  it("blocks an option whose values would take the combinations over 100", () => {
    const reducir = reductor()
    const e = aplicar(reducir, nuevo(), { tipo: "agregarOpcion", nombre: "A", valores: Array.from({ length: 11 }, (_, i) => `a${i}`) })
    rechazada(e, { tipo: "agregarOpcion", nombre: "B", valores: Array.from({ length: 10 }, (_, i) => `b${i}`) }, /110 combinaciones/)
  })

  it("allows three options and refuses a fourth one", () => {
    const reducir = reductor()
    const cinco = (p: string) => Array.from({ length: 4 }, (_, i) => `${p}${i}`)
    const e = aplicar(
      reducir,
      nuevo(),
      { tipo: "agregarOpcion", nombre: "A", valores: cinco("a") },
      { tipo: "agregarOpcion", nombre: "B", valores: cinco("b") },
      { tipo: "agregarOpcion", nombre: "C", valores: cinco("c") }
    )
    expect(e.orden).toHaveLength(64)
    rechazada(e, { tipo: "agregarOpcion", nombre: "D" }, /hasta 3 opciones/)
  })

  it("refuses a value repeated in the same option, ignoring case and accents, and allows it in another option", () => {
    const reducir = reductor()
    const e = conColor(reducir)
    rechazada(e, { tipo: "agregarValor", opcionId: opcionId(e, "Color"), texto: " rojó " }, /"rojó" está repetido en Color/)
    rechazada(e, { tipo: "renombrarValor", valorId: valorId(e, "Color", "Azul"), texto: "ROJO" }, /repetido/)
    const conTalle = aplicar(reducir, e, { tipo: "agregarOpcion", nombre: "Talle", valores: ["Rojo"] })
    expect(conTalle.aviso).toBeNull()
  })

  it("accepts text of exactly 100 characters", () => {
    const reducir = reductor()
    const e = conColor(reducir)
    const valor = aplicar(reducir, e, { tipo: "agregarValor", opcionId: opcionId(e, "Color"), texto: "v".repeat(100) })
    expect(valor.aviso).toBeNull()
    expect(valor.opciones[0].valores).toHaveLength(3)
    const opcion = aplicar(reducir, e, { tipo: "agregarOpcion", nombre: "n".repeat(100) })
    expect(opcion.aviso).toBeNull()
    expect(opcion.opciones).toHaveLength(2)
  })

  it("renaming an option to its own name with another case is not a repeat", () => {
    const reducir = reductor()
    const e = conColor(reducir)
    const renombrado = aplicar(reducir, e, { tipo: "renombrarOpcion", opcionId: opcionId(e, "Color"), nombre: "COLOR" })
    expect(renombrado.aviso).toBeNull()
    expect(renombrado.opciones[0].nombre).toBe("COLOR")
  })

  it("renaming a value to its own text with another case is not a repeat", () => {
    const reducir = reductor()
    const e = conColor(reducir)
    const renombrado = aplicar(reducir, e, { tipo: "renombrarValor", valorId: valorId(e, "Color", "Rojo"), texto: "ROJO" })
    expect(renombrado.aviso).toBeNull()
    expect(renombrado.opciones[0].valores[0].texto).toBe("ROJO")
  })

  it("refuses a repeated option name", () => {
    const e = conColor()
    rechazada(e, { tipo: "agregarOpcion", nombre: " color " }, /no pueden repetirse/)
    const dos = aplicar(reductor(), e, { tipo: "agregarOpcion", nombre: "Talle" })
    rechazada(dos, { tipo: "renombrarOpcion", opcionId: opcionId(dos, "Talle"), nombre: "COLOR" }, /no pueden repetirse/)
  })

  it("refuses blank, over-long and unsupported text", () => {
    const e = conColor()
    const idColor = opcionId(e, "Color")
    rechazada(e, { tipo: "agregarValor", opcionId: idColor, texto: "   " }, /no pueden estar vacíos/)
    rechazada(e, { tipo: "agregarValor", opcionId: idColor, texto: "x".repeat(101) }, /hasta 100 caracteres/)
    rechazada(e, { tipo: "agregarValor", opcionId: idColor, texto: `a${String.fromCharCode(31)}b` }, /carácter que no se admite/)
    rechazada(e, { tipo: "agregarValor", opcionId: idColor, texto: `a${String.fromCharCode(0)}b` }, /carácter que no se admite/)
    rechazada(e, { tipo: "agregarOpcion", nombre: "  " }, /necesita un nombre/)
    rechazada(e, { tipo: "agregarOpcion", nombre: "n".repeat(101) }, /hasta 100 caracteres/)
    rechazada(e, { tipo: "renombrarOpcion", opcionId: idColor, nombre: "" }, /necesita un nombre/)
    rechazada(e, { tipo: "renombrarValor", valorId: valorId(e, "Color", "Rojo"), texto: " " }, /no pueden estar vacíos/)
  })

  it("refuses more than 100 values in one option", () => {
    const reducir = reductor()
    const e = aplicar(reducir, nuevo(), { tipo: "agregarOpcion", nombre: "A", valores: Array.from({ length: 100 }, (_, i) => `a${i}`) })
    rechazada(e, { tipo: "agregarValor", opcionId: opcionId(e, "A"), texto: "otro" }, /hasta 100 valores/)
  })

  it("refuses an option added with a bad value as a whole", () => {
    const e = conColor()
    rechazada(e, { tipo: "agregarOpcion", nombre: "Talle", valores: ["S", "s"] }, /repetido/)
  })

  it("clears the notice on the next accepted action", () => {
    const reducir = reductor()
    const e = conColor(reducir)
    const rechazado = aplicar(reducir, e, { tipo: "agregarValor", opcionId: opcionId(e, "Color"), texto: "rojo" })
    expect(rechazado.aviso).not.toBeNull()
    expect(aplicar(reducir, rechazado, { tipo: "agregarValor", opcionId: opcionId(e, "Color"), texto: "Verde" }).aviso).toBeNull()
  })
})

describe("on and off, replace", () => {
  it("switches the section on and off without touching the rows", () => {
    const reducir = reductor()
    const e = conColor(reducir)
    const apagado = aplicar(reducir, e, { tipo: "desactivar" })
    expect(apagado.activo).toBe(false)
    expect(apagado.filas).toEqual(e.filas)
    expect(aplicar(reducir, apagado, { tipo: "activar" }).activo).toBe(true)
  })

  it("replaces the whole state", () => {
    const reducir = reductor()
    const otro = hidratar(grupoColor())
    expect(aplicar(reducir, conColor(reducir), { tipo: "reemplazar", estado: otro })).toBe(otro)
  })
})

describe("selectors", () => {
  it("stockTotal sums the saved stock and the initial stock of the new rows, never the rows pending archive", () => {
    const reducir = reductor()
    const saved = hidratar(grupoColorTalle())
    expect(stockTotal(saved)).toBe(1 + 2 + 3 + 4)
    let e = aplicar(reducir, saved, { tipo: "quitarValor", valorId: valorId(saved, "Talle", "M") })
    expect(stockTotal(e)).toBe(1 + 3)
    e = aplicar(reducir, e, { tipo: "agregarValor", opcionId: opcionId(e, "Talle"), texto: "L" })
    const nuevaRojoL = filaDe(e, "Rojo / L")
    const conStock = { ...e, filas: { ...e.filas, [nuevaRojoL.id]: { ...nuevaRojoL, stockInicial: 6 } } }
    expect(stockTotal(conStock)).toBe(1 + 3 + 6)
    expect(stockTotal(nuevo())).toBe(0)
  })

  it("stockTotal ignores the initial stock of a saved row", () => {
    const saved = hidratar(grupoColor())
    const fila = saved.filas["r1"]
    expect(stockTotal({ ...saved, filas: { ...saved.filas, r1: { ...fila, stockInicial: 99 } } })).toBe(5 + 3)
  })

  it("bloqueos flags a row pending archive with reserved stock, with the reason", () => {
    const reducir = reductor()
    const saved = hidratar(
      grupoColor({
        variantes: [
          leida("r1", [{ opcion: "Color", valor: "Rojo" }], { stock: 5, stockReservado: 2 }),
          leida("a1", [{ opcion: "Color", valor: "Azul" }], { stock: 3, stockReservado: 1 }),
          leida("z1", [{ opcion: "Color", valor: "Gris" }], { stock: 3, stockReservado: 0 }),
          leida("k1", [{ opcion: "Color", valor: "Negro" }], { stock: 1, stockReservado: 0 }),
        ],
      })
    )
    expect(bloqueos(saved)).toEqual([])
    let e = aplicar(reducir, saved, { tipo: "quitarValor", valorId: valorId(saved, "Color", "Rojo") })
    expect(bloqueos(e)).toEqual([
      { filaId: "r1", etiqueta: "Rojo", unidades: 2, motivo: 'No se puede archivar "Rojo": tiene 2 unidades reservadas' },
    ])
    e = aplicar(reducir, e, { tipo: "quitarValor", valorId: valorId(e, "Color", "Azul") }, { tipo: "quitarValor", valorId: valorId(e, "Color", "Gris") })
    // Rows pending archive keep the relative order they had before.
    expect(bloqueos(e).map((b) => [b.filaId, b.unidades])).toEqual([
      ["a1", 1],
      ["r1", 2],
    ])
    expect(bloqueos(e)[0].motivo).toBe('No se puede archivar "Azul": tiene 1 unidad reservada')
  })

  it("bloqueos clears once the row is back", () => {
    const reducir = reductor()
    const saved = hidratar(grupoColor({ variantes: [leida("r1", [{ opcion: "Color", valor: "Rojo" }], { stockReservado: 2 }), leida("a1", [{ opcion: "Color", valor: "Azul" }])] }))
    let e = aplicar(reducir, saved, { tipo: "quitarValor", valorId: valorId(saved, "Color", "Rojo") })
    expect(bloqueos(e)).toHaveLength(1)
    e = aplicar(reducir, e, { tipo: "deshacerArchivo", filaId: "r1" })
    expect(bloqueos(e)).toEqual([])
  })

  it("archivosConStock lists the rows to confirm: pending archive, with stock and nothing reserved", () => {
    const reducir = reductor()
    const saved = hidratar(
      grupoColor({
        variantes: [
          leida("r1", [{ opcion: "Color", valor: "Rojo" }], { stock: 5 }),
          leida("a1", [{ opcion: "Color", valor: "Azul" }], { stock: 0 }),
          leida("z1", [{ opcion: "Color", valor: "Gris" }], { stock: 4, stockReservado: 1 }),
          leida("k1", [{ opcion: "Color", valor: "Negro" }], { stock: 2 }),
        ],
      })
    )
    const e = aplicar(
      reducir,
      saved,
      { tipo: "quitarValor", valorId: valorId(saved, "Color", "Rojo") },
      { tipo: "quitarValor", valorId: valorId(saved, "Color", "Azul") },
      { tipo: "quitarValor", valorId: valorId(saved, "Color", "Gris") }
    )
    expect(archivosConStock(e)).toEqual([{ filaId: "r1", etiqueta: "Rojo", stock: 5 }])
  })
})

describe("undo and re-adding go through ids, not through the text a row had", () => {
  it("undo after renaming ANOTHER value brings the row back without ghost values or rows", () => {
    const reducir = reductor()
    const saved = hidratar(grupoColorTalle())
    let e = aplicar(reducir, saved, { tipo: "quitarValor", valorId: valorId(saved, "Talle", "S") })
    e = aplicar(reducir, e, { tipo: "renombrarValor", valorId: valorId(e, "Color", "Rojo"), texto: "Colorado" })
    e = aplicar(reducir, e, { tipo: "deshacerArchivo", filaId: "r-s" })
    expect(e.aviso).toBeNull()
    expect(e.opciones.map((o) => [o.nombre, o.valores.map((v) => v.texto)])).toEqual([
      ["Color", ["Colorado", "Azul"]],
      ["Talle", ["M", "S"]],
    ])
    expect(Object.keys(e.filas).sort()).toEqual(["a-m", "a-s", "r-m", "r-s"])
    // The value S comes back under the id the archived rows remember.
    expect(valorId(e, "Talle", "S")).toBe(valorId(saved, "Talle", "S"))
    expect(etiquetas(e)).toEqual(["Colorado / M", "Colorado / S", "Azul / M", "Azul / S"])
    expect(e.filas["r-s"]).toMatchObject({ archivar: false, existente: true, stock: 1 })
  })

  it("undo after renaming the OPTION finds the option by id", () => {
    const reducir = reductor()
    const saved = hidratar(grupoColorTalle())
    let e = aplicar(reducir, saved, { tipo: "quitarValor", valorId: valorId(saved, "Talle", "S") })
    e = aplicar(reducir, e, { tipo: "renombrarOpcion", opcionId: opcionId(e, "Talle"), nombre: "Tamaño" })
    e = aplicar(reducir, e, { tipo: "deshacerArchivo", filaId: "r-s" })
    expect(e.aviso).toBeNull()
    expect(e.opciones.map((o) => [o.nombre, o.valores.map((v) => v.texto)])).toEqual([
      ["Color", ["Rojo", "Azul"]],
      ["Tamaño", ["M", "S"]],
    ])
    expect(Object.keys(e.filas).sort()).toEqual(["a-m", "a-s", "r-m", "r-s"])
    expect(filaDe(e, "Rojo / S").id).toBe("r-s")
  })

  it("the label of a row pending archive follows the renames", () => {
    const reducir = reductor()
    const saved = hidratar(grupoColorTalle())
    let e = aplicar(reducir, saved, { tipo: "quitarValor", valorId: valorId(saved, "Talle", "S") })
    e = aplicar(reducir, e, { tipo: "renombrarValor", valorId: valorId(e, "Color", "Rojo"), texto: "Colorado" })
    expect(etiquetas(e).slice(2)).toEqual(["Colorado / S", "Azul / S"])
  })

  it("re-adding a combination after a rename restores the archived child instead of creating a row", () => {
    const reducir = reductor()
    const saved = hidratar(
      grupoColorTalle({
        grupo: { id: "g1", nombre: "Funda X", opciones: [{ nombre: "Color", valores: ["Rojo", "Azul"] }, { nombre: "Talle", valores: ["S"] }] },
        variantes: [
          leida("r-s", [{ opcion: "Color", valor: "Rojo" }, { opcion: "Talle", valor: "S" }], { stock: 1 }),
          leida("a-s", [{ opcion: "Color", valor: "Azul" }, { opcion: "Talle", valor: "S" }], { stock: 3 }),
        ],
        archivadas: [{ id: "r-m", atributos: [{ opcion: "Color", valor: "Rojo" }, { opcion: "Talle", valor: "M" }], stock: 9 }],
      })
    )
    let e = aplicar(reducir, saved, { tipo: "renombrarValor", valorId: valorId(saved, "Color", "Rojo"), texto: "Colorado" })
    e = aplicar(reducir, e, { tipo: "agregarValor", opcionId: opcionId(e, "Talle"), texto: "M" })
    expect(filaDe(e, "Colorado / M")).toMatchObject({ id: "r-m", existente: true, restaurada: true, stock: 9 })
    expect(filaDe(e, "Azul / M")).toMatchObject({ existente: false })
    expect(e.archivadas).toEqual({})
  })

  it("renaming the value of a combination that was archived by hand keeps the match by text working", () => {
    const reducir = reductor()
    const saved = hidratar(grupoColor())
    let e = aplicar(reducir, saved, { tipo: "quitarValor", valorId: valorId(saved, "Color", "Azul") })
    e = aplicar(reducir, e, { tipo: "agregarValor", opcionId: opcionId(e, "Color"), texto: "Azul" })
    expect(e.filas["a1"]).toMatchObject({ archivar: false, stock: 3 })
    expect(Object.keys(e.filas).sort()).toEqual(["a1", "r1"])
  })
})

describe("generated codes follow the rows (typed codes never move)", () => {
  it("folding an option re-derives the generated codes", () => {
    const reducir = reductor()
    let e = aplicar(reducir, nuevo(), { tipo: "agregarOpcion", nombre: "Color", valores: ["Rojo"] }, { tipo: "agregarOpcion", nombre: "Talle", valores: ["S", "M"] })
    expect(filasEnOrden(e).map((f) => f.codigo)).toEqual(["FX-ROJ-S", "FX-ROJ-M"])
    e = aplicar(reducir, e, { tipo: "quitarOpcion", opcionId: opcionId(e, "Talle") })
    expect(filasEnOrden(e).map((f) => f.codigo)).toEqual(["FX-ROJ"])
  })

  it("giving rows their first value of a new option re-derives the generated codes", () => {
    const reducir = reductor()
    const e0 = conColor(reducir)
    const e = aplicar(reducir, e0, { tipo: "agregarOpcion", nombre: "Talle", valores: ["S"] })
    expect(filasEnOrden(e).map((f) => f.codigo)).toEqual(["FX-ROJ-S", "FX-AZU-S"])
  })

  it("removing a value frees the suffix a later row had to take", () => {
    const reducir = reductor()
    let e = aplicar(reducir, nuevo(), { tipo: "agregarOpcion", nombre: "Color", valores: ["Rojo", "Rojizo"] })
    expect(filaDe(e, "Rojizo").codigo).toBe("FX-ROJ-2")
    e = aplicar(reducir, e, { tipo: "quitarValor", valorId: valorId(e, "Color", "Rojo") })
    expect(filaDe(e, "Rojizo").codigo).toBe("FX-ROJ")
  })

  it("a typed code survives the fold, the extension and the removal", () => {
    const reducir = reductor()
    const e0 = aplicar(reducir, nuevo(), { tipo: "agregarOpcion", nombre: "Color", valores: ["Rojo", "Azul"] }, { tipo: "agregarOpcion", nombre: "Talle", valores: ["S", "M"] })
    const rojoS = filaDe(e0, "Rojo / S")
    const tipeado = { ...e0, filas: { ...e0.filas, [rojoS.id]: { ...rojoS, codigo: "MIO", codigoTocado: true } } }
    const plegado = aplicar(reducir, tipeado, { tipo: "quitarOpcion", opcionId: opcionId(tipeado, "Talle") })
    expect(filaDe(plegado, "Rojo").codigo).toBe("MIO")
    expect(filaDe(plegado, "Azul").codigo).toBe("FX-AZU")
    const extendido = aplicar(reducir, plegado, { tipo: "agregarOpcion", nombre: "Material", valores: ["Lana"] })
    expect(filaDe(extendido, "Rojo / Lana").codigo).toBe("MIO")
    expect(filaDe(extendido, "Azul / Lana").codigo).toBe("FX-AZU-LAN")
    const sinAzul = aplicar(reducir, extendido, { tipo: "quitarValor", valorId: valorId(extendido, "Color", "Azul") })
    expect(filaDe(sinAzul, "Rojo / Lana").codigo).toBe("MIO")
  })
})

describe("a row restored from the archive", () => {
  it("has no cost of its own until the user types one", () => {
    const reducir = reductor()
    const saved = hidratar(grupoColor())
    const e = aplicar(reducir, saved, { tipo: "agregarValor", opcionId: opcionId(saved, "Color"), texto: "Verde" })
    const f = filaDe(e, "Verde")
    expect(f.restaurada).toBe(true)
    expect("precioCompra" in f).toBe(false)
    // A brand new row on the same state does take the base cost.
    const otra = aplicar(reducir, e, { tipo: "agregarValor", opcionId: opcionId(e, "Color"), texto: "Negro" })
    expect("precioCompra" in filaDe(otra, "Negro")).toBe(true)
  })
})

describe("ids are replay-stable: the same action on the same state gives the same state", () => {
  const FORMATO = /^c[0-9a-f]{24}$/
  const semillado = (over: Partial<Parameters<typeof estadoInicial>[0]> = {}) =>
    estadoInicial({ grupoId: "cg1", codigoBase: "FX", precioBase: 1000, semilla: "semilla-de-prueba", ...over })
  const idsDe = (e: VariantesState) => [...e.opciones.flatMap((o) => [o.id, ...o.valores.map((v) => v.id)]), ...Object.keys(e.filas)]

  /** A state and an action that mints ids in a different way each. */
  function casos(): [string, VariantesState, VariantesAccion][] {
    const reducir = reductor()
    const vacio = aplicar(reducir, semillado(), { tipo: "activar" })
    const conColorRojo = aplicar(reducir, vacio, { tipo: "agregarOpcion", nombre: "Color", valores: ["Rojo"] })
    const guardado = hidratar(grupoColor({ archivadas: [] }), { semilla: "hidratado" })
    // Rojo/S and Rojo/M saved, M removed, Azul added (Azul/S is new): undoing M must mint Azul/M.
    const base = hidratar(
      grupoColorTalle({
        grupo: { id: "g1", nombre: "Funda X", opciones: [{ nombre: "Color", valores: ["Rojo"] }, { nombre: "Talle", valores: ["S", "M"] }] },
        variantes: [
          leida("r-s", [{ opcion: "Color", valor: "Rojo" }, { opcion: "Talle", valor: "S" }]),
          leida("r-m", [{ opcion: "Color", valor: "Rojo" }, { opcion: "Talle", valor: "M" }]),
        ],
      }),
      { semilla: "deshacer" }
    )
    let paraDeshacer = aplicar(reducir, base, { tipo: "quitarValor", valorId: valorId(base, "Talle", "M") })
    paraDeshacer = aplicar(reducir, paraDeshacer, { tipo: "agregarValor", opcionId: opcionId(paraDeshacer, "Color"), texto: "Azul" })
    return [
      ["add an option with values", vacio, { tipo: "agregarOpcion", nombre: "Color", valores: ["Rojo", "Azul"] }],
      ["add a value that creates rows", conColorRojo, { tipo: "agregarValor", opcionId: opcionId(conColorRojo, "Color"), texto: "Azul" }],
      ["add the first value of an option (rows extend)", aplicar(reducir, guardado, { tipo: "agregarOpcion", nombre: "Talle" }), { tipo: "agregarValor", opcionId: "", texto: "S" }],
      ["undo that mints a row", paraDeshacer, { tipo: "deshacerArchivo", filaId: "r-m" }],
    ]
  }

  it("replays to a deep-equal state, ids included", () => {
    const reducir = reductor()
    for (const [nombre, estado, accion] of casos()) {
      const accionLista =
        accion.tipo === "agregarValor" && accion.opcionId === "" ? { ...accion, opcionId: estado.opciones.at(-1)!.id } : accion
      const a = reducir(estado, accionLista)
      const b = reducir(estado, accionLista)
      expect(a.aviso, nombre).toBeNull()
      expect(b, nombre).toEqual(a)
      expect(idsDe(a).length, nombre).toBeGreaterThan(idsDe(estado).length)
    }
  })

  it("two reducers made apart agree too", () => {
    for (const [nombre, estado, accion] of casos()) {
      const accionLista =
        accion.tipo === "agregarValor" && accion.opcionId === "" ? { ...accion, opcionId: estado.opciones.at(-1)!.id } : accion
      expect(reductor()(estado, accionLista), nombre).toEqual(reductor()(estado, accionLista))
    }
  })

  it("every id is shaped like a client id and none repeats along a session", () => {
    const reducir = reductor()
    let e = aplicar(reducir, semillado(), { tipo: "agregarOpcion", nombre: "Color", valores: ["Rojo", "Azul"] }, { tipo: "agregarOpcion", nombre: "Talle", valores: ["S", "M", "L"] })
    e = aplicar(reducir, e, { tipo: "quitarValor", valorId: valorId(e, "Talle", "M") }, { tipo: "agregarValor", opcionId: opcionId(e, "Talle"), texto: "XL" })
    const ids = idsDe(e)
    expect(ids.length).toBeGreaterThan(10)
    for (const id of ids) expect(id).toMatch(FORMATO)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("uses the whole 96 bits: the three 32-bit words of an id are different", () => {
    const reducir = reductor()
    const e = aplicar(reducir, semillado(), { tipo: "agregarOpcion", nombre: "Color", valores: Array.from({ length: 30 }, (_, i) => `v${i}`) })
    const ids = idsDe(e)
    expect(ids.length).toBe(61)
    for (const id of ids) {
      const palabras = [id.slice(1, 9), id.slice(9, 17), id.slice(17, 25)]
      expect(new Set(palabras).size).toBe(3)
    }
  })

  it("the counter moves only when ids were minted", () => {
    const reducir = reductor()
    const e0 = semillado()
    expect(e0.contador).toBe(0)
    const e1 = aplicar(reducir, e0, { tipo: "agregarOpcion", nombre: "Color", valores: ["Rojo"] })
    expect(e1.contador).toBe(3) // option, value, row
    const refusal = aplicar(reducir, e1, { tipo: "agregarValor", opcionId: opcionId(e1, "Color"), texto: "rojo" })
    expect(refusal.aviso).not.toBeNull()
    expect(refusal.contador).toBe(3)
    const parcial = aplicar(reducir, e1, { tipo: "agregarOpcion", nombre: "Talle", valores: ["S", "s"] })
    expect(parcial.aviso).not.toBeNull()
    expect(parcial.contador).toBe(3)
    expect(aplicar(reducir, e1, { tipo: "renombrarValor", valorId: valorId(e1, "Color", "Rojo"), texto: "Rosa" }).contador).toBe(3)
    expect(aplicar(reducir, e1, { tipo: "quitarValor", valorId: "nada" })).toBe(e1)
  })

  it("the seed is random per state unless given, and different seeds give different ids", () => {
    const a = estadoInicial({ grupoId: "cg1" })
    const b = estadoInicial({ grupoId: "cg1" })
    expect(a.semilla).toMatch(/^[0-9a-f]{32}$/)
    expect(a.semilla).not.toBe(b.semilla)
    const reducir = reductor()
    const accion = { tipo: "agregarOpcion", nombre: "Color", valores: ["Rojo"] } as const
    expect(idsDe(reducir(a, accion))).not.toEqual(idsDe(reducir(b, accion)))
    expect(idsDe(reducir(semillado(), accion))).toEqual(idsDe(reducir(semillado(), accion)))
  })

  it("hydration is deterministic for a given seed and advances the counter", () => {
    const uno = hidratar(grupoColor(), { semilla: "mismo" })
    const dos = hidratar(grupoColor(), { semilla: "mismo" })
    expect(dos).toEqual(uno)
    expect(uno.contador).toBeGreaterThan(0)
    for (const o of uno.opciones) {
      expect(o.id).toMatch(FORMATO)
      for (const v of o.valores) expect(v.id).toMatch(FORMATO)
    }
    expect(idsDe(hidratar(grupoColor(), { semilla: "otro" }))).not.toEqual(idsDe(uno))
    const sin = estadoDesdeGrupo(grupoColor(), { costoCargado: false })
    expect(sin.semilla).toMatch(/^[0-9a-f]{32}$/)
  })

  it("a state minted by hydration keeps minting without repeating its own ids", () => {
    const reducir = reductor()
    const e = aplicar(reducir, hidratar(grupoColor(), { semilla: "mismo" }), { tipo: "agregarValor", opcionId: opcionId(hidratar(grupoColor(), { semilla: "mismo" }), "Color"), texto: "Negro" })
    const ids = idsDe(e)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
