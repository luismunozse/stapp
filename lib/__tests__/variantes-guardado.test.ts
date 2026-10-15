import { describe, expect, it } from "vitest"
import { guardarGrupoSchema } from "@/lib/variantes-schema"
import { estadoInicial, type VariantesAccion, type VariantesState } from "@/lib/variantes-filas"
import {
  construirCuerpoGrupo,
  interpretarGuardado,
  reasignarCodigosDuplicados,
  type CompartidosForm,
  type CuerpoGrupo,
} from "@/lib/variantes-guardado"
import { validezDeVariantes } from "@/components/inventario/variantes/vista"
import { aplicar, filaDe, grupoColor, grupoColorTalle, hidratar, opcionId, reductor, valorId } from "@/__tests__/helpers/variantes-filas"

const compartidos: CompartidosForm = {
  categoria: "Fundas",
  tipoDispositivo: "CELULAR",
  proveedorId: null,
  diasGarantiaDefault: null,
  trackeaLotes: false,
  trackeaSeries: false,
}

const nuevo = (...acciones: VariantesAccion[]): VariantesState =>
  aplicar(
    reductor(),
    estadoInicial({ grupoId: "cgrupo000000000000000001", codigoBase: "FX", precioBase: 1000, costoBase: 400, costoCargado: true, semilla: "semilla-de-prueba" }),
    { tipo: "activar" },
    { tipo: "agregarOpcion", nombre: "Color", valores: ["Rojo", "Azul"] },
    ...acciones
  )

const cuerpoDe = (estado: VariantesState, extra: Partial<Parameters<typeof construirCuerpoGrupo>[0]> = {}) =>
  construirCuerpoGrupo({ estado, original: null, nombre: "Funda X", compartidos, compartidosPrevios: null, ...extra })

function aceptado(r: ReturnType<typeof construirCuerpoGrupo>): CuerpoGrupo {
  if (!r.ok) throw new Error(`rejected: ${r.motivo}`)
  return r.cuerpo
}

describe("construirCuerpoGrupo: a new group", () => {
  it("sends the name, the options and one complete row per combination", () => {
    const cuerpo = aceptado(cuerpoDe(nuevo()))
    expect(cuerpo.grupo).toEqual({ nombre: "Funda X", opciones: [{ nombre: "Color", valores: ["Rojo", "Azul"] }] })
    expect(cuerpo.variantes).toHaveLength(2)
    const [rojo, azul] = cuerpo.variantes
    expect(rojo.atributos).toEqual([{ opcion: "Color", valor: "Rojo" }])
    expect(azul.atributos).toEqual([{ opcion: "Color", valor: "Azul" }])
    expect(rojo).toMatchObject({ codigo: "FX-ROJ", precioVenta: 1000, precioCompra: 400 })
    expect(azul).toMatchObject({ codigo: "FX-AZU", precioVenta: 1000, precioCompra: 400 })
    expect(rojo.id).toMatch(/^c[0-9a-f]{24}$/)
    expect(rojo.id).not.toBe(azul.id)
  })

  it("does not invent renombrar, depositoId or archivar", () => {
    const cuerpo = aceptado(cuerpoDe(nuevo()))
    expect(cuerpo.grupo).not.toHaveProperty("renombrar")
    expect(cuerpo).not.toHaveProperty("depositoId")
    expect(cuerpo).not.toHaveProperty("archivar")
  })

  it("passes renombrar and depositoId through when given (false stays false)", () => {
    const cuerpo = aceptado(cuerpoDe(nuevo(), { renombrar: false, depositoId: "dep-2" }))
    expect(cuerpo.grupo.renombrar).toBe(false)
    expect(cuerpo.depositoId).toBe("dep-2")
  })

  it("sends the initial stock only when it is above zero", () => {
    const e0 = nuevo()
    const rojo = filaDe(e0, "Rojo")
    const e = aplicar(reductor(), e0, { tipo: "editarFila", filaId: rojo.id, cambios: { stockInicial: 5 } })
    const cuerpo = aceptado(cuerpoDe(e))
    expect(cuerpo.variantes.find((v) => v.id === rojo.id)).toMatchObject({ stockInicial: 5 })
    expect(cuerpo.variantes.find((v) => v.id !== rojo.id)).not.toHaveProperty("stockInicial")
  })

  it("trims codes, option names and values", () => {
    const e0 = nuevo()
    const rojo = filaDe(e0, "Rojo")
    const e = aplicar(reductor(), e0, { tipo: "editarFila", filaId: rojo.id, cambios: { codigo: "  FX-ROJO  " } })
    const cuerpo = aceptado(cuerpoDe(e))
    expect(cuerpo.variantes.find((v) => v.id === rojo.id)?.codigo).toBe("FX-ROJO")
  })

  it("rejects a blank code on a new row and names the row", () => {
    const e0 = nuevo()
    const rojo = filaDe(e0, "Rojo")
    const e = aplicar(reductor(), e0, { tipo: "editarFila", filaId: rojo.id, cambios: { codigo: "   " } })
    const r = cuerpoDe(e)
    expect(r.ok).toBe(false)
    expect(!r.ok && r.motivo).toContain("Rojo")
  })

  it("rejects repeated codes (case-insensitive)", () => {
    const e0 = nuevo()
    const [rojo, azul] = [filaDe(e0, "Rojo"), filaDe(e0, "Azul")]
    const e = aplicar(
      reductor(),
      e0,
      { tipo: "editarFila", filaId: rojo.id, cambios: { codigo: "Igual" } },
      { tipo: "editarFila", filaId: azul.id, cambios: { codigo: "igual " } }
    )
    expect(cuerpoDe(e).ok).toBe(false)
  })

  it("leaves out an option that has no values (a dimension left empty after a fold)", () => {
    const e0 = nuevo({ tipo: "agregarOpcion", nombre: "Talle", valores: ["S"] })
    const e = aplicar(reductor(), e0, { tipo: "quitarValor", valorId: valorId(e0, "Talle", "S") })
    expect(e.opciones.find((o) => o.nombre === "Talle")?.valores).toHaveLength(0)
    const cuerpo = aceptado(cuerpoDe(e))
    expect(cuerpo.grupo.opciones.map((o) => o.nombre)).toEqual(["Color"])
    expect(cuerpo.variantes.every((v) => v.atributos.length === 1)).toBe(true)
  })

  it("sends no cost on any row when the role has no cost access (deep scan)", () => {
    const sinCosto = aplicar(
      reductor(),
      estadoInicial({ grupoId: "cgrupo000000000000000001", codigoBase: "FX", precioBase: 1000, costoCargado: false, semilla: "s" }),
      { tipo: "activar" },
      { tipo: "agregarOpcion", nombre: "Color", valores: ["Rojo", "Azul"] }
    )
    const cuerpo = aceptado(cuerpoDe(sinCosto))
    expect(JSON.stringify(cuerpo)).not.toContain("precioCompra")
  })

  it("sends all the shared fields for a new group", () => {
    const cuerpo = aceptado(cuerpoDe(nuevo(), { compartidos: { ...compartidos, trackeaSeries: true, diasGarantiaDefault: 30 } }))
    expect(cuerpo.compartidos).toEqual({
      categoria: "Fundas",
      tipoDispositivo: "CELULAR",
      proveedorId: null,
      diasGarantiaDefault: 30,
      trackeaLotes: false,
      trackeaSeries: true,
    })
  })

  it("keeps a typed barcode and the optional row fields", () => {
    const e0 = nuevo()
    const rojo = filaDe(e0, "Rojo")
    const e = aplicar(reductor(), e0, {
      tipo: "editarFila",
      filaId: rojo.id,
      cambios: { barcode: " 7790001 ", stockMinimo: 2, stockMaximo: 9, ubicacion: "Estante 3" },
    })
    const fila = aceptado(cuerpoDe(e)).variantes.find((v) => v.id === rojo.id)
    expect(fila).toMatchObject({ barcode: "7790001", stockMinimo: 2, stockMaximo: 9, ubicacion: "Estante 3" })
  })
})

describe("construirCuerpoGrupo: an existing group sends only what changed", () => {
  const original = () => hidratar(grupoColorTalle())

  it("an untouched group sends each row as id and combination only", () => {
    const o = original()
    const cuerpo = aceptado(cuerpoDe(o, { original: o, compartidosPrevios: compartidos }))
    expect(cuerpo.variantes).toHaveLength(4)
    for (const v of cuerpo.variantes) expect(Object.keys(v).sort()).toEqual(["atributos", "id"])
    expect(cuerpo).not.toHaveProperty("compartidos")
    expect(cuerpo).not.toHaveProperty("archivar")
  })

  it("a changed price puts exactly one key on exactly one row", () => {
    const o = original()
    const rm = filaDe(o, "Rojo / M")
    const e = aplicar(reductor(), o, { tipo: "editarFila", filaId: rm.id, cambios: { precioVenta: 1500 } })
    const cuerpo = aceptado(cuerpoDe(e, { original: o, compartidosPrevios: compartidos }))
    const cambiadas = cuerpo.variantes.filter((v) => Object.keys(v).length > 2)
    expect(cambiadas).toHaveLength(1)
    expect(cambiadas[0]).toMatchObject({ id: rm.id, precioVenta: 1500 })
    expect(Object.keys(cambiadas[0]).sort()).toEqual(["atributos", "id", "precioVenta"])
  })

  it("a changed cost and a cleared barcode are sent, null meaning clear", () => {
    const base = hidratar(grupoColorTalle({ variantes: grupoColorTalle().variantes.map((v) => ({ ...v, barcode: "123" })) }))
    const rs = filaDe(base, "Rojo / S")
    const e = aplicar(
      reductor(),
      base,
      { tipo: "editarFila", filaId: rs.id, cambios: { precioCompra: 450 } },
      { tipo: "editarFila", filaId: rs.id, cambios: { barcode: "" } }
    )
    const fila = aceptado(cuerpoDe(e, { original: base, compartidosPrevios: compartidos })).variantes.find((v) => v.id === rs.id)
    expect(fila).toMatchObject({ precioCompra: 450, barcode: null })
  })

  it("never sends a cost for a role without cost access, even when the price changes", () => {
    const o = hidratar(grupoColorTalle(), { costoCargado: false })
    const ra = filaDe(o, "Azul / S")
    const e = aplicar(reductor(), o, { tipo: "editarFila", filaId: ra.id, cambios: { precioVenta: 1200, precioCompra: 1 } })
    const cuerpo = aceptado(cuerpoDe(e, { original: o, compartidosPrevios: compartidos }))
    expect(JSON.stringify(cuerpo)).not.toContain("precioCompra")
  })

  it("a code the user typed and changed is sent trimmed; an unchanged one is not", () => {
    const o = original()
    const ra = filaDe(o, "Azul / M")
    const e = aplicar(reductor(), o, { tipo: "editarFila", filaId: ra.id, cambios: { codigo: " NUEVO " } })
    const cuerpo = aceptado(cuerpoDe(e, { original: o, compartidosPrevios: compartidos }))
    expect(cuerpo.variantes.find((v) => v.id === ra.id)?.codigo).toBe("NUEVO")
    expect(cuerpo.variantes.filter((v) => "codigo" in v)).toHaveLength(1)
  })

  it("rejects blanking the code of a saved row", () => {
    const o = original()
    const ra = filaDe(o, "Azul / M")
    const e = aplicar(reductor(), o, { tipo: "editarFila", filaId: ra.id, cambios: { codigo: "  " } })
    expect(cuerpoDe(e, { original: o, compartidosPrevios: compartidos }).ok).toBe(false)
  })

  it("only the shared fields that changed are sent", () => {
    const o = original()
    const cuerpo = aceptado(cuerpoDe(o, { original: o, compartidosPrevios: compartidos, compartidos: { ...compartidos, categoria: "Cases", trackeaLotes: true } }))
    expect(cuerpo.compartidos).toEqual({ categoria: "Cases", trackeaLotes: true })
  })

  it("rows pending archive go to archivar and out of variantes (full-state save)", () => {
    const o = original()
    const e = aplicar(reductor(), o, { tipo: "quitarValor", valorId: valorId(o, "Talle", "M") })
    const cuerpo = aceptado(cuerpoDe(e, { original: o, compartidosPrevios: compartidos }))
    expect(new Set(cuerpo.archivar)).toEqual(new Set([filaDe(o, "Rojo / M").id, filaDe(o, "Azul / M").id]))
    expect(cuerpo.variantes.map((v) => v.id).sort()).toEqual([filaDe(o, "Rojo / S").id, filaDe(o, "Azul / S").id].sort())
    expect(cuerpo.grupo.opciones).toEqual([
      { nombre: "Color", valores: ["Rojo", "Azul"] },
      { nombre: "Talle", valores: ["S"] },
    ])
  })

  it("every saved member is accounted for: variantes plus archivar equals the original rows", () => {
    const o = original()
    const e = aplicar(reductor(), o, { tipo: "quitarValor", valorId: valorId(o, "Color", "Azul") })
    const cuerpo = aceptado(cuerpoDe(e, { original: o, compartidosPrevios: compartidos }))
    const cuentas = [...cuerpo.variantes.map((v) => v.id), ...(cuerpo.archivar ?? [])].sort()
    expect(cuentas).toEqual(Object.keys(o.filas).sort())
  })

  it("rejects a save that would archive a row with reserved units", () => {
    const g = grupoColor()
    g.variantes[1] = { ...g.variantes[1], stockReservado: 2 }
    const o = hidratar(g)
    const e = aplicar(reductor(), o, { tipo: "quitarValor", valorId: valorId(o, "Color", "Azul") })
    const r = cuerpoDe(e, { original: o, compartidosPrevios: compartidos })
    expect(r.ok).toBe(false)
    expect(!r.ok && r.motivo).toContain("reservada")
  })
})

describe("construirCuerpoGrupo: a row brought back from the archive", () => {
  const conVerde = () => {
    const o = hidratar(grupoColor())
    const e = aplicar(reductor(), o, { tipo: "agregarValor", opcionId: opcionId(o, "Color"), texto: "Verde" })
    return { o, e, verde: filaDe(e, "Verde") }
  }

  it("is a restored row and sends no code, price or cost until the user edits them", () => {
    const { o, e, verde } = conVerde()
    expect(verde.restaurada).toBe(true)
    const fila = aceptado(cuerpoDe(e, { original: o, compartidosPrevios: compartidos })).variantes.find((v) => v.id === verde.id)
    expect(Object.keys(fila ?? {}).sort()).toEqual(["atributos", "id"])
  })

  it("sends the price once edited, and still no cost", () => {
    const { o, e, verde } = conVerde()
    const editado = aplicar(reductor(), e, { tipo: "editarFila", filaId: verde.id, cambios: { precioVenta: 2000 } })
    const fila = aceptado(cuerpoDe(editado, { original: o, compartidosPrevios: compartidos })).variantes.find((v) => v.id === verde.id)
    expect(Object.keys(fila ?? {}).sort()).toEqual(["atributos", "id", "precioVenta"])
  })

  it("sends the cost and the code once typed", () => {
    const { o, e, verde } = conVerde()
    const editado = aplicar(reductor(), e, { tipo: "editarFila", filaId: verde.id, cambios: { precioCompra: 900, codigo: "FX-VER" } })
    const fila = aceptado(cuerpoDe(editado, { original: o, compartidosPrevios: compartidos })).variantes.find((v) => v.id === verde.id)
    expect(fila).toMatchObject({ precioCompra: 900, codigo: "FX-VER" })
    expect(fila).not.toHaveProperty("precioVenta")
  })
})

describe("construirCuerpoGrupo: promoting a standalone item", () => {
  it("sends the promoted row complete (it joins the group) and no initial stock for it", () => {
    const e0 = nuevo()
    const nuevaFila = filaDe(e0, "Rojo")
    const e = aplicar(reductor(), e0, {
      tipo: "promover",
      filaId: nuevaFila.id,
      item: { id: "citem00000000000000000001", codigo: "CEL-0001", precioVenta: 777, precioCompra: 300, stock: 9, stockReservado: 0 },
    })
    const cuerpo = aceptado(cuerpoDe(e))
    const promovida = cuerpo.variantes.find((v) => v.id === "citem00000000000000000001")
    expect(promovida).toMatchObject({ codigo: "CEL-0001", precioVenta: 777, precioCompra: 300 })
    expect(promovida).not.toHaveProperty("stockInicial")
  })
})

describe("INVARIANT: what the screen accepts, the schema accepts", () => {
  const motivos = (e: VariantesState) => validezDeVariantes(e).motivos

  it("a valid new state maps to a body that passes guardarGrupoSchema", () => {
    const e = nuevo()
    expect(validezDeVariantes(e).valida).toBe(true)
    const r = guardarGrupoSchema.safeParse(aceptado(cuerpoDe(e)))
    expect(r.success).toBe(true)
  })

  it("a valid hydrated state with edits and archives maps to a body that passes", () => {
    const o = hidratar(grupoColorTalle())
    const e = aplicar(
      reductor(),
      o,
      { tipo: "quitarValor", valorId: valorId(o, "Talle", "M") },
      { tipo: "editarFila", filaId: filaDe(o, "Rojo / S").id, cambios: { precioVenta: 55.555, barcode: "999", stockMinimo: 1, stockMaximo: 4 } },
      { tipo: "agregarValor", opcionId: opcionId(o, "Color"), texto: "Verde" }
    )
    expect(validezDeVariantes(e).valida).toBe(true)
    expect(guardarGrupoSchema.safeParse(aceptado(cuerpoDe(e, { original: o, compartidosPrevios: compartidos }))).success).toBe(true)
  })

  it("no options: invalid on screen and rejected by the schema", () => {
    const e = aplicar(reductor(), estadoInicial({ grupoId: "cgrupo000000000000000001", semilla: "s" }), { tipo: "activar" })
    expect(motivos(e).join(" ")).toContain("Agregá una opción")
    const r = cuerpoDe(e)
    expect(!r.ok || !guardarGrupoSchema.safeParse(r.cuerpo).success).toBe(true)
  })

  it("an option left without values: the screen blocks it and the schema would reject it if it were sent", () => {
    const e0 = nuevo({ tipo: "agregarOpcion", nombre: "Talle", valores: ["S"] })
    const e = aplicar(reductor(), e0, { tipo: "quitarValor", valorId: valorId(e0, "Talle", "S") })
    expect(motivos(e).join(" ")).toContain('Falta al menos un valor en "Talle"')
    const sana = aceptado(cuerpoDe(e))
    const cruda = { ...sana, grupo: { ...sana.grupo, opciones: [...sana.grupo.opciones, { nombre: "Talle", valores: [] }] } }
    expect(guardarGrupoSchema.safeParse(cruda).success).toBe(false)
  })

  it("a blank code on a new row: blocked on screen, rejected by the mapper and by the schema if sent", () => {
    const e0 = nuevo()
    const rojo = filaDe(e0, "Rojo")
    const e = aplicar(reductor(), e0, { tipo: "editarFila", filaId: rojo.id, cambios: { codigo: "" } })
    expect(motivos(e).join(" ")).toContain("Falta el código")
    expect(cuerpoDe(e).ok).toBe(false)
    const sana = aceptado(cuerpoDe(e0))
    const cruda = { ...sana, variantes: sana.variantes.map((v) => (v.id === rojo.id ? { ...v, codigo: "" } : v)) }
    expect(guardarGrupoSchema.safeParse(cruda).success).toBe(false)
  })

  it("repeated barcodes: blocked on screen and rejected by the schema", () => {
    const e0 = nuevo()
    const e = aplicar(
      reductor(),
      e0,
      { tipo: "editarFila", filaId: filaDe(e0, "Rojo").id, cambios: { barcode: "111" } },
      { tipo: "editarFila", filaId: filaDe(e0, "Azul").id, cambios: { barcode: "111" } }
    )
    expect(motivos(e).join(" ")).toContain("códigos de barras repetidos")
    const r = cuerpoDe(e)
    expect(r.ok).toBe(true)
    expect(guardarGrupoSchema.safeParse(aceptado(r)).success).toBe(false)
  })

  it("min above max: blocked on screen and rejected by the schema", () => {
    // The reducer refuses to type this, so it can only come from stored data (sent in full here).
    const g = grupoColor()
    g.variantes[0] = { ...g.variantes[0], stockMinimo: 9, stockMaximo: 2 }
    const e = hidratar(g)
    expect(motivos(e).join(" ")).toContain("no puede superar al máximo")
    expect(guardarGrupoSchema.safeParse(aceptado(cuerpoDe(e))).success).toBe(false)
  })

  it("repeated codes: blocked on screen and rejected by the mapper (the schema leaves this to the RPC)", () => {
    const e0 = nuevo()
    const e = aplicar(
      reductor(),
      e0,
      { tipo: "editarFila", filaId: filaDe(e0, "Rojo").id, cambios: { codigo: "X" } },
      { tipo: "editarFila", filaId: filaDe(e0, "Azul").id, cambios: { codigo: "x" } }
    )
    expect(motivos(e).join(" ")).toContain("está repetido")
    expect(cuerpoDe(e).ok).toBe(false)
  })

  it("randomized sequences: whatever the screen calls valid is accepted by mapper and schema", () => {
    let semilla = 12345
    const azar = (n: number) => {
      semilla = (Math.imul(semilla, 1103515245) + 12345) >>> 0
      return semilla % n
    }
    const textos = ["Rojo", "Azul", "Verde", "S", "M", "L", "  Negro  ", "x".repeat(101), `a${String.fromCharCode(31)}b`]
    let validos = 0
    for (let corrida = 0; corrida < 150; corrida++) {
      const partida = corrida % 2 === 0 ? hidratar(grupoColorTalle()) : hidratar(grupoColor())
      let e = corrida % 3 === 0 ? aplicar(reductor(), estadoInicial({ grupoId: "cgrupo000000000000000009", codigoBase: "FX", precioBase: 10, costoCargado: true, semilla: `f${corrida}` }), { tipo: "activar" }) : partida
      for (let paso = 0; paso < 12; paso++) {
        const filas = e.orden.map((id) => e.filas[id])
        const valores = e.opciones.flatMap((o) => o.valores)
        const fila = filas[azar(Math.max(filas.length, 1))]
        const acciones: VariantesAccion[] = [
          { tipo: "agregarOpcion", nombre: ["Color", "Talle", "Capacidad"][azar(3)], valores: [textos[azar(textos.length)]] },
          ...(e.opciones.length > 0 ? [{ tipo: "agregarValor", opcionId: e.opciones[azar(e.opciones.length)].id, texto: textos[azar(textos.length)] } as VariantesAccion] : []),
          ...(valores.length > 0 ? [{ tipo: "quitarValor", valorId: valores[azar(valores.length)].id } as VariantesAccion] : []),
          ...(e.opciones.length > 0 ? [{ tipo: "quitarOpcion", opcionId: e.opciones[azar(e.opciones.length)].id } as VariantesAccion] : []),
          ...(fila ? [{ tipo: "editarFila", filaId: fila.id, cambios: { codigo: ["", "  ", "A1", "a1 ", "B2"][azar(5)] } } as VariantesAccion] : []),
          ...(fila ? [{ tipo: "editarFila", filaId: fila.id, cambios: { barcode: ["", "111", " 111 ", "222"][azar(4)] } } as VariantesAccion] : []),
          ...(fila ? [{ tipo: "editarFila", filaId: fila.id, cambios: { stockMinimo: azar(6), stockMaximo: azar(6) } } as VariantesAccion] : []),
          ...(fila?.archivar ? [{ tipo: "deshacerArchivo", filaId: fila.id } as VariantesAccion] : []),
        ]
        e = aplicar(reductor(), e, acciones[azar(acciones.length)])
        if (!e.activo || !validezDeVariantes(e).valida) continue
        validos++
        const r = cuerpoDe(e, { original: corrida % 3 === 0 ? null : partida, compartidosPrevios: corrida % 3 === 0 ? null : compartidos })
        expect(r.ok, r.ok ? "" : r.motivo).toBe(true)
        const parsed = guardarGrupoSchema.safeParse(aceptado(r))
        expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true)
      }
    }
    // The property must have been exercised, not skipped by always landing on invalid states.
    expect(validos).toBeGreaterThan(100)
  })
})

describe("reasignarCodigosDuplicados (P0035 retry)", () => {
  it("gives the next suffix to a generated code that clashed and leaves the others alone", () => {
    const e = nuevo()
    const cuerpo = aceptado(cuerpoDe(e))
    const nuevoCuerpo = reasignarCodigosDuplicados(cuerpo, e, ["fx-roj"])
    expect(nuevoCuerpo).not.toBeNull()
    const [rojo, azul] = nuevoCuerpo!.variantes
    expect(rojo.codigo).toBe("FX-ROJ-2")
    expect(azul.codigo).toBe("FX-AZU")
  })

  it("skips a suffix that is already taken inside the same save", () => {
    const e0 = nuevo()
    const e = aplicar(reductor(), e0, { tipo: "editarFila", filaId: filaDe(e0, "Azul").id, cambios: { codigo: "FX-ROJ-2" } })
    const cuerpo = aceptado(cuerpoDe(e))
    const nuevoCuerpo = reasignarCodigosDuplicados(cuerpo, e, ["FX-ROJ"])
    expect(nuevoCuerpo!.variantes[0].codigo).toBe("FX-ROJ-3")
  })

  it("does not touch a code the user typed: no automatic retry", () => {
    const e0 = nuevo()
    const e = aplicar(reductor(), e0, { tipo: "editarFila", filaId: filaDe(e0, "Rojo").id, cambios: { codigo: "MIO" } })
    expect(reasignarCodigosDuplicados(aceptado(cuerpoDe(e)), e, ["MIO"])).toBeNull()
  })

  it("does not touch a saved row", () => {
    const o = hidratar(grupoColor())
    const e = aplicar(reductor(), o, { tipo: "editarFila", filaId: filaDe(o, "Rojo").id, cambios: { codigo: "OTRO" } })
    expect(reasignarCodigosDuplicados(aceptado(cuerpoDe(e, { original: o, compartidosPrevios: compartidos })), e, ["OTRO"])).toBeNull()
  })

  it("returns null when none of the clashing codes is in the body", () => {
    const e = nuevo()
    expect(reasignarCodigosDuplicados(aceptado(cuerpoDe(e)), e, ["NADA"])).toBeNull()
  })

  it("does not mutate the body it was given", () => {
    const e = nuevo()
    const cuerpo = aceptado(cuerpoDe(e))
    const antes = JSON.stringify(cuerpo)
    reasignarCodigosDuplicados(cuerpo, e, ["FX-ROJ"])
    expect(JSON.stringify(cuerpo)).toBe(antes)
  })
})

describe("interpretarGuardado", () => {
  const lectura = { grupo: { id: "g", nombre: "X", opciones: [] }, variantes: [], archivadas: [] }

  it("200 with the group shape is saved and carries the reading", () => {
    expect(interpretarGuardado(200, lectura)).toEqual({ tipo: "guardado", lectura })
  })

  it("200 relectura:false is saved without a reading (the caller must GET, never re-send)", () => {
    expect(interpretarGuardado(200, { guardado: true, relectura: false, grupoId: "g" })).toEqual({ tipo: "guardado", lectura: null })
  })

  it("409 CODIGO_DUPLICADO carries the clashing codes", () => {
    const s = interpretarGuardado(409, { code: "CODIGO_DUPLICADO", error: "Ya existe", codigos: ["A-1", "A-2"] })
    expect(s).toMatchObject({ tipo: "codigo-duplicado", codigos: ["A-1", "A-2"] })
  })

  it("409 MIEMBROS_FALTANTES asks to reload", () => {
    const s = interpretarGuardado(409, { code: "MIEMBROS_FALTANTES", error: "El producto cambió", faltantes: ["x"], recargar: true })
    expect(s).toMatchObject({ tipo: "recargar", mensaje: "El producto cambió" })
  })

  it("409 CONFLICTO (a swap of codes or combinations) is an error to fix, not a reload", () => {
    expect(interpretarGuardado(409, { code: "CONFLICTO", error: "Dos variantes chocan" })).toEqual({ tipo: "error", mensaje: "Dos variantes chocan" })
    expect(interpretarGuardado(409, { code: "COMBINACION_DUPLICADA", error: "Hay dos variantes con la misma combinación" }).tipo).toBe("error")
  })

  it("503 MIGRACION_PENDIENTE is the pending state with the standard copy", () => {
    expect(interpretarGuardado(503, { code: "MIGRACION_PENDIENTE", error: "Variantes todavía no está disponible" })).toEqual({
      tipo: "pendiente",
      mensaje: "Variantes todavía no está disponible",
    })
  })

  it("anything else is an error with the server's text, or a plain default", () => {
    expect(interpretarGuardado(400, { error: "Elegí al menos una opción" })).toEqual({ tipo: "error", mensaje: "Elegí al menos una opción" })
    expect(interpretarGuardado(500, null).tipo).toBe("error")
    expect(interpretarGuardado(500, null)).toHaveProperty("mensaje", "No pudimos guardar las variantes. Probá de nuevo.")
  })
})
