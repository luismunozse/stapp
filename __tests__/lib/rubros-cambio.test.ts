import { describe, it, expect, beforeEach, vi } from "vitest"
import { seedOrganizationFromRubro } from "@/lib/rubros/seed"
import { aplicarCambioDeRubro } from "@/lib/rubros/cambio"
import { mismoRubro, type SeleccionRubro } from "@/lib/rubros/seleccion"
import { getRubro } from "@/lib/rubros"

/**
 * In-memory stand-in for the slice of supabase-js the rubro change touches.
 * Unlike the recorder in rubros-seed.test.ts it keeps STATE: the org is seeded
 * by the real signup seed, changed, and then the tables are asserted.
 */
type Row = Record<string, any>
type Op = "select" | "insert" | "upsert" | "update" | "delete"
interface Resultado {
  data: any
  error: { message: string; code?: string } | null
}

const clonar = <T>(valor: T): T => JSON.parse(JSON.stringify(valor))

function crearDbFake(inicial: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = clonar(inicial)
  /** "table.op" -> error message that operation returns. */
  const failures: Record<string, string> = {}
  const calls: Array<{ table: string; op: Op }> = []
  let seq = 0

  const tabla = (nombre: string): Row[] => (tables[nombre] ??= [])

  // The two unique keys that shape the bug: tipos (migration 014:19) and
  // checklist templates (migration 050:8-10). A NULL tipo_dispositivo_id never
  // collides, as in Postgres.
  const choca = (nombre: string, fila: Row, contra: Row[]): Row | undefined => {
    if (nombre === "tipos_dispositivo") {
      return contra.find(
        (r) => r.organization_id === fila.organization_id && r.codigo === fila.codigo
      )
    }
    if (nombre === "checklist_templates" && fila.tipo_dispositivo_id != null) {
      return contra.find(
        (r) =>
          r.organization_id === fila.organization_id &&
          r.nombre === fila.nombre &&
          r.tipo_dispositivo_id === fila.tipo_dispositivo_id
      )
    }
    return undefined
  }

  class Query {
    private filtros: Array<(r: Row) => boolean> = []
    private unico = false

    constructor(
      private readonly nombre: string,
      private readonly op: Op,
      private readonly payload?: Row | Row[],
      private readonly ignorarDuplicados = false
    ) {}

    select() {
      return this
    }
    eq(col: string, valor: unknown) {
      this.filtros.push((r) => r[col] === valor)
      return this
    }
    in(col: string, valores: unknown[]) {
      this.filtros.push((r) => valores.includes(r[col]))
      return this
    }
    single() {
      this.unico = true
      return this
    }
    then(ok: (r: Resultado) => unknown, ko?: (e: unknown) => unknown) {
      return Promise.resolve()
        .then(() => this.ejecutar())
        .then(ok, ko)
    }

    private filasDelPayload(): Row[] {
      const p = this.payload ?? []
      return (Array.isArray(p) ? p : [p]).map((r) => ({ ...r }))
    }

    private ejecutar(): Resultado {
      calls.push({ table: this.nombre, op: this.op })
      const falla = failures[`${this.nombre}.${this.op}`]
      if (falla) return { data: null, error: { message: falla } }

      const filas = tabla(this.nombre)
      const coincide = (r: Row) => this.filtros.every((f) => f(r))

      if (this.op === "select") {
        const data = filas.filter(coincide).map((r) => ({ ...r }))
        return { data: this.unico ? (data[0] ?? null) : data, error: null }
      }
      if (this.op === "update") {
        for (const r of filas.filter(coincide)) Object.assign(r, this.payload)
        return { data: null, error: null }
      }
      if (this.op === "delete") {
        tables[this.nombre] = filas.filter((r) => !coincide(r))
        return { data: null, error: null }
      }
      if (this.op === "insert") {
        const nuevas = this.filasDelPayload()
        // One statement is atomic: a single collision rejects every row.
        const rechazo = nuevas.some((fila, i) =>
          choca(this.nombre, fila, [...filas, ...nuevas.slice(0, i)])
        )
        if (rechazo) {
          return {
            data: null,
            error: { code: "23505", message: "duplicate key value violates unique constraint" },
          }
        }
        const insertadas = nuevas.map((fila) => ({ id: `${this.nombre}-${++seq}`, ...fila }))
        filas.push(...insertadas)
        return { data: this.unico ? insertadas[0] : insertadas, error: null }
      }
      // upsert ON CONFLICT on the table's unique key
      for (const fila of this.filasDelPayload()) {
        const existente = choca(this.nombre, fila, filas)
        if (!existente) filas.push({ id: `${this.nombre}-${++seq}`, ...fila })
        else if (!this.ignorarDuplicados) Object.assign(existente, fila)
      }
      return { data: null, error: null }
    }
  }

  const client = {
    from: (nombre: string) => ({
      select: () => new Query(nombre, "select"),
      insert: (payload: Row | Row[]) => new Query(nombre, "insert", payload),
      upsert: (payload: Row | Row[], opciones?: { ignoreDuplicates?: boolean }) =>
        new Query(nombre, "upsert", payload, opciones?.ignoreDuplicates === true),
      update: (payload: Row) => new Query(nombre, "update", payload),
      delete: () => new Query(nombre, "delete"),
    }),
  }

  return { client, tables, failures, calls }
}

type FakeDb = ReturnType<typeof crearDbFake>

const ORG = "org-1"

/** The org exactly as the signup leaves it. */
async function orgSembradaCon(rubro: string, detalle: string | null = null): Promise<FakeDb> {
  const fake = crearDbFake({
    organizations: [{ id: ORG, rubro, rubro_detalle: detalle, terminologia: {} }],
  })
  const seed = await seedOrganizationFromRubro(ORG, rubro, fake.client as any, detalle)
  expect(seed.errors).toEqual([])
  return fake
}

const sel = (rubro: string, rubroDetalle: string | null = null): SeleccionRubro => ({
  rubro,
  rubroDetalle,
})

const cambiar = (fake: FakeDb, de: SeleccionRubro, a: SeleccionRubro) =>
  aplicarCambioDeRubro(ORG, de, a, fake.client as any)

const codigosActivos = (fake: FakeDb) =>
  fake.tables.tipos_dispositivo
    .filter((t) => t.activo === true)
    .map((t) => t.codigo)
    .sort()

const codigosDe = (rubro: string) =>
  getRubro(rubro)
    .tipos.map((t) => t.codigo)
    .sort()

const org = (fake: FakeDb) => fake.tables.organizations[0]

const plantillas = (fake: FakeDb, nombre: string) =>
  (fake.tables.checklist_templates ?? []).filter((t) => t.nombre === nombre)

const nombresChecklist = (rubro: string) => getRubro(rubro).checklists.map((c) => c.nombre)

vi.spyOn(console, "error").mockImplementation(() => {})

beforeEach(() => {
  vi.clearAllMocks()
})

describe("aplicarCambioDeRubro: tipos", () => {
  it("deactivates the previous pack's base tipos instead of leaving them active", async () => {
    const fake = await orgSembradaCon("electrodomesticos")

    await cambiar(fake, sel("electrodomesticos"), sel("electronica"))

    expect(codigosActivos(fake)).toEqual(codigosDe("electronica"))
    // Deactivated, not deleted: inventory may still reference it (migration 014:74).
    const heladera = fake.tables.tipos_dispositivo.find((t) => t.codigo === "HELADERA")
    expect(heladera?.activo).toBe(false)
  })

  it("leaves the tipos the shop created by hand alone", async () => {
    const fake = await orgSembradaCon("electrodomesticos")
    fake.tables.tipos_dispositivo.push({
      id: "t-dron",
      organization_id: ORG,
      codigo: "DRON",
      nombre: "Dron",
      es_base: false,
      activo: true,
    })

    await cambiar(fake, sel("electrodomesticos"), sel("electronica"))

    expect(fake.tables.tipos_dispositivo.find((t) => t.id === "t-dron")?.activo).toBe(true)
  })

  it("aborts with nothing changed when seeding the new tipos fails", async () => {
    const fake = await orgSembradaCon("electrodomesticos")
    fake.failures["tipos_dispositivo.upsert"] = "boom"
    const antes = clonar(fake.tables)

    await expect(
      cambiar(fake, sel("electrodomesticos"), sel("electronica"))
    ).rejects.toThrow("boom")

    expect(fake.tables).toEqual(antes)
  })

  it("returns how many tipos the shop can pick, without the internal TODOS", async () => {
    const fake = await orgSembradaCon("electrodomesticos")

    const result = await cambiar(fake, sel("electrodomesticos"), sel("electronica"))

    const esperados = getRubro("electronica").tipos.filter((t) => t.codigo !== "TODOS")
    expect(result.tiposActivos).toBe(esperados.length)
  })

  it("reactivates the tipos an earlier change deactivated", async () => {
    const fake = await orgSembradaCon("electrodomesticos")

    await cambiar(fake, sel("electrodomesticos"), sel("electronica"))
    await cambiar(fake, sel("electronica"), sel("electrodomesticos"))

    expect(codigosActivos(fake)).toEqual(codigosDe("electrodomesticos"))
    expect(fake.tables.tipos_dispositivo.filter((t) => t.codigo === "HELADERA")).toHaveLength(1)
  })

  it("refreshes a tipo the new pack already had instead of keeping its old name", async () => {
    const fake = await orgSembradaCon("generico", "maquinas de cafe")

    await cambiar(fake, sel("generico", "maquinas de cafe"), sel("generico", "máquinas de café"))

    const maquinas = fake.tables.tipos_dispositivo.filter((t) => t.codigo === "MAQUINA_DE_CAFE")
    expect(maquinas).toHaveLength(1)
    expect(maquinas[0]).toMatchObject({ nombre: "Máquina de café", activo: true })
  })
})

describe("aplicarCambioDeRubro: custom tipos with a pack codigo", () => {
  const CODIGO = codigosDe("electronica")[0]
  const personalizado = {
    id: "t-propio",
    organization_id: ORG,
    codigo: CODIGO,
    nombre: "Nombre del taller",
    es_base: false,
    activo: true,
  }

  it("keeps a custom tipo whose codigo equals a pack codigo exactly as the shop left it", async () => {
    const fake = await orgSembradaCon("electrodomesticos")
    fake.tables.tipos_dispositivo.push({ ...personalizado })

    await cambiar(fake, sel("electrodomesticos"), sel("electronica"))

    const filas = fake.tables.tipos_dispositivo.filter((t) => t.codigo === CODIGO)
    expect(filas).toHaveLength(1)
    expect(filas[0]).toMatchObject({
      id: "t-propio",
      es_base: false,
      nombre: "Nombre del taller",
      activo: true,
    })
  })

  it("does not deactivate that custom tipo on a later change", async () => {
    const fake = await orgSembradaCon("electrodomesticos")
    fake.tables.tipos_dispositivo.push({ ...personalizado })

    await cambiar(fake, sel("electrodomesticos"), sel("electronica"))
    await cambiar(fake, sel("electronica"), sel("electrodomesticos"))

    expect(fake.tables.tipos_dispositivo.find((t) => t.id === "t-propio")).toMatchObject({
      es_base: false,
      activo: true,
    })
  })

  it("aborts with nothing changed when reading the existing tipos fails", async () => {
    const fake = await orgSembradaCon("electrodomesticos")
    fake.failures["tipos_dispositivo.select"] = "lectura rota"
    const antes = clonar(fake.tables)

    await expect(
      cambiar(fake, sel("electrodomesticos"), sel("electronica"))
    ).rejects.toThrow("lectura rota")

    expect(fake.tables).toEqual(antes)
  })
})

describe("aplicarCambioDeRubro: vocabulary and rubro", () => {
  it("resets the vocabulary to {} when the new pack has no overrides", async () => {
    const fake = await orgSembradaCon("electrodomesticos")
    expect(org(fake).terminologia.equipo).toBe("Artefacto") // the signup wrote it

    await cambiar(fake, sel("electrodomesticos"), sel("electronica"))

    expect(org(fake).terminologia).toEqual({})
    expect(org(fake)).toMatchObject({ rubro: "electronica", rubro_detalle: null })
  })

  it("stores the genérico trade and the vocabulary derived from it", async () => {
    const fake = await orgSembradaCon("electronica")

    await cambiar(fake, sel("electronica"), sel("generico", "maquinas de cafe"))

    expect(org(fake)).toMatchObject({ rubro: "generico", rubro_detalle: "maquinas de cafe" })
    expect(org(fake).terminologia).toEqual({
      equipo: "Maquina de cafe",
      equipoPlural: "Maquinas de cafe",
    })
    expect(codigosActivos(fake)).toEqual(["MAQUINA_DE_CAFE"])
  })
})

describe("aplicarCambioDeRubro: checklists", () => {
  it("retires the previous pack's checklists and seeds the new pack's", async () => {
    const fake = await orgSembradaCon("electrodomesticos")

    await cambiar(fake, sel("electrodomesticos"), sel("electronica"))

    expect(plantillas(fake, "Recepción de artefacto").map((p) => p.activo)).toEqual([false])
    for (const nombre of nombresChecklist("electronica")) {
      expect(plantillas(fake, nombre).map((p) => p.activo)).toEqual([true])
    }
  })

  it("moves the genérico checklist to the new trade's tipo", async () => {
    const fake = await orgSembradaCon("generico", "maquinas de cafe")

    await cambiar(fake, sel("generico", "maquinas de cafe"), sel("generico", "cerraduras"))

    const idDe = (codigo: string) =>
      fake.tables.tipos_dispositivo.find((t) => t.codigo === codigo)?.id
    const recepcion = plantillas(fake, "Recepción")
    expect(recepcion).toHaveLength(2)
    expect(recepcion.find((p) => p.tipo_dispositivo_id === idDe("MAQUINA_DE_CAFE"))?.activo).toBe(false)
    expect(recepcion.find((p) => p.tipo_dispositivo_id === idDe("CERRADURA"))?.activo).toBe(true)
  })

  it("finishes the change when a checklist's items fail to insert", async () => {
    const fake = await orgSembradaCon("electrodomesticos")
    fake.failures["checklist_template_items.insert"] = "items boom"

    await cambiar(fake, sel("electrodomesticos"), sel("electronica"))

    expect(org(fake).rubro).toBe("electronica")
    expect(console.error).toHaveBeenCalledWith(
      "Rubro change: checklist seed errors:",
      expect.arrayContaining([expect.stringContaining("items boom")])
    )
  })

  it("stops before writing the rubro when the checklists cannot be read", async () => {
    const fake = await orgSembradaCon("electrodomesticos")
    fake.failures["checklist_templates.select"] = "read boom"

    await expect(
      cambiar(fake, sel("electrodomesticos"), sel("electronica"))
    ).rejects.toThrow("read boom")

    expect(org(fake)).toMatchObject({
      rubro: "electrodomesticos",
      terminologia: { equipo: "Artefacto" },
    })
  })

  it("aborts before retiring or writing the rubro when a template fails to insert", async () => {
    const fake = await orgSembradaCon("electrodomesticos")
    fake.failures["checklist_templates.insert"] = "template boom"

    await expect(
      cambiar(fake, sel("electrodomesticos"), sel("electronica"))
    ).rejects.toThrow("template boom")

    expect(plantillas(fake, "Recepción de artefacto").map((p) => p.activo)).toEqual([true])
    expect(org(fake).rubro).toBe("electrodomesticos")
  })

  // Guard: passes before the implementation; the retire step must not break it.
  it("leaves the checklists the shop created by hand alone", async () => {
    const fake = await orgSembradaCon("electrodomesticos")
    fake.tables.checklist_templates.push({
      id: "tpl-propio",
      organization_id: ORG,
      nombre: "Mi checklist",
      tipo_dispositivo_id: null,
      activo: true,
    })

    await cambiar(fake, sel("electrodomesticos"), sel("electronica"))

    expect(fake.tables.checklist_templates.find((p) => p.id === "tpl-propio")?.activo).toBe(true)
  })

  // Guard: deleting would break inventory FKs and quote checklist snapshots.
  it("never deletes tipos or checklists", async () => {
    const fake = await orgSembradaCon("electrodomesticos")

    await cambiar(fake, sel("electrodomesticos"), sel("electronica"))
    await cambiar(fake, sel("electronica"), sel("generico", "cerraduras"))

    expect(fake.calls.filter((c) => c.op === "delete")).toEqual([])
  })

  it("does not duplicate a checklist when the shop comes back to a rubro", async () => {
    const fake = await orgSembradaCon("electrodomesticos")

    await cambiar(fake, sel("electrodomesticos"), sel("electronica"))
    await cambiar(fake, sel("electronica"), sel("electrodomesticos"))

    expect(plantillas(fake, "Recepción de artefacto").map((p) => p.activo)).toEqual([true])
    for (const nombre of nombresChecklist("electronica")) {
      expect(plantillas(fake, nombre).map((p) => p.activo)).toEqual([false])
    }
    expect(console.error).not.toHaveBeenCalled()
  })

  it("brings back a typed checklist instead of failing on its unique key", async () => {
    const fake = await orgSembradaCon("electronica")

    await cambiar(fake, sel("electronica"), sel("electrodomesticos"))
    await cambiar(fake, sel("electrodomesticos"), sel("electronica"))

    for (const nombre of nombresChecklist("electronica")) {
      expect(plantillas(fake, nombre).map((p) => p.activo)).toEqual([true])
    }
    expect(plantillas(fake, "Recepción de artefacto").map((p) => p.activo)).toEqual([false])
    expect(console.error).not.toHaveBeenCalled()
  })

  it("keeps the checklist when the new pack has it for the same tipo", async () => {
    const fake = await orgSembradaCon("generico", "maquinas de cafe")

    await cambiar(fake, sel("generico", "maquinas de cafe"), sel("generico", "máquinas de café"))

    expect(plantillas(fake, "Recepción").map((p) => p.activo)).toEqual([true])
    expect(console.error).not.toHaveBeenCalled()
  })
})

describe("mismoRubro", () => {
  it.each<{ caso: string; actual: SeleccionRubro; pedido: SeleccionRubro; esperado: boolean }>([
    { caso: "same curated pack", actual: sel("automotor"), pedido: sel("automotor"), esperado: true },
    {
      caso: "same curated pack ignores a stale trade text",
      actual: sel("automotor", "algo viejo"),
      pedido: sel("automotor"),
      esperado: true,
    },
    { caso: "different pack", actual: sel("automotor"), pedido: sel("electronica"), esperado: false },
    {
      caso: "same genérico trade modulo spaces",
      actual: sel("generico", "maquinas de cafe "),
      pedido: sel("generico", "maquinas de cafe"),
      esperado: true,
    },
    {
      caso: "different genérico trade",
      actual: sel("generico", "maquinas de cafe"),
      pedido: sel("generico", "cerraduras"),
      esperado: false,
    },
    {
      caso: "org without a stored rubro",
      actual: { rubro: null, rubroDetalle: null },
      pedido: sel("generico", "cerraduras"),
      esperado: false,
    },
  ])("$caso", ({ actual, pedido, esperado }) => {
    expect(mismoRubro(actual, pedido)).toBe(esperado)
  })
})
