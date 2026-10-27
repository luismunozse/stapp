// @vitest-environment node
/**
 * The in-memory PostgREST table must fail where PostgREST fails, or the route tests that
 * lean on it give false greens: a `.single()` over several rows is an error, and a filter
 * on a column that does not exist is an error (not "NULL for every row").
 */
import { describe, it, expect } from "vitest"
import { tablaPostgrest } from "./postgrest-memoria"

const FILAS = [
  { id: "a", sucursal_id: "s1", tecnico_id: null, nombre: "Ana" },
  { id: "b", sucursal_id: "s1", tecnico_id: "t1", nombre: "Beto" },
  { id: "c", sucursal_id: "s2", tecnico_id: "t1", nombre: "Carla" },
]

describe("single / maybeSingle", () => {
  it("single returns the row when exactly one matches", async () => {
    const { data, error } = await tablaPostgrest(FILAS).select("id").eq("id", "a").single()
    expect(error).toBeNull()
    expect(data).toEqual({ id: "a" })
  })

  it.each([
    ["no row", "zz"],
    ["several rows", null],
  ])("single is an error with %s", async (_caso, id) => {
    const q = tablaPostgrest(FILAS).select("id")
    const { data, error } = await (id ? q.eq("id", id) : q.eq("sucursal_id", "s1")).single()
    expect(data).toBeNull()
    expect(error).toMatchObject({ code: "PGRST116" })
  })

  it("maybeSingle returns null for no row, the row for one, and an error for several", async () => {
    const tabla = tablaPostgrest(FILAS)
    expect(await tabla.select("id").eq("id", "zz").maybeSingle()).toEqual({ data: null, error: null })
    expect(await tabla.select("id").eq("id", "b").maybeSingle()).toEqual({ data: { id: "b" }, error: null })
    const varias = await tabla.select("id").eq("sucursal_id", "s1").maybeSingle()
    expect(varias.data).toBeNull()
    expect(varias.error).toMatchObject({ code: "PGRST116" })
  })
})

describe("values inside an or() list", () => {
  const lista = (valor: string) => () => tablaPostgrest(FILAS).select("id").or(`nombre.ilike.${valor},sucursal_id.eq.s1`)

  // PostgREST reads an unquoted value up to the next `,` or `)`: a `)` inside it ends the value and
  // breaks the list, a lone `(` is just a character.
  it.each([
    ["a balanced pair", "%(011) 4444%"],
    ["a closing parenthesis", "%a)%"],
  ])("an unquoted value with %s is a syntax error, as in PostgREST", (_caso, valor) => {
    expect(lista(valor)).toThrow(/syntax/)
  })

  it("a lone opening parenthesis is just a character, and the row is found", async () => {
    const tabla = tablaPostgrest([{ id: "a", nombre: "x(y", sucursal_id: "s9" }, { id: "b", nombre: "otro", sucursal_id: "s9" }])
    const { data } = await tabla.select("id").or("nombre.ilike.%x(y%,id.eq.zz")
    expect(data).toEqual([{ id: "a" }])
  })

  it("a quoted value may hold any of them, and an in.(..) list is a list", async () => {
    expect(lista('"%(011) 4444%"')).not.toThrow()
    expect(lista('"say \\"hi\\", (ok)"')).not.toThrow()
    const { data } = await tablaPostgrest(FILAS).select("id").or("id.in.(a,c),nombre.ilike.%zz%")
    expect(data).toEqual([{ id: "a" }, { id: "c" }])
  })

  it("a list that does not close, or has stray text after a group, is a syntax error", () => {
    const sobre = (l: string) => () => tablaPostgrest(FILAS).select("id").or(l)
    expect(sobre("and(id.eq.a,nombre.eq.b")).toThrow(/syntax/)
    expect(sobre("and(id.eq.a) y,id.eq.b")).toThrow(/syntax/)
    expect(sobre("id.eq.a)")).toThrow(/syntax/)
  })

  it("evaluates nested groups with quoted and in values", async () => {
    const tabla = tablaPostgrest([
      { id: "a", nombre: "Ana, la", sucursal_id: "s1", tecnico_id: null },
      { id: "b", nombre: "Beto", sucursal_id: "s1", tecnico_id: "t1" },
      { id: "c", nombre: "Carla", sucursal_id: "s2", tecnico_id: null },
    ])
    const { data } = await tabla.select("id").or('and(tecnico_id.is.null,or(sucursal_id.eq.s1,sucursal_id.in.(s3,s4))),nombre.eq."Carla"')
    expect(data).toEqual([{ id: "a" }, { id: "c" }])
  })
})

describe("aliased plain selects", () => {
  it("alias:col reads the column and names the key after the alias", async () => {
    const { data } = await tablaPostgrest(FILAS).select("id, quien:nombre").eq("id", "a")
    expect(data).toEqual([{ id: "a", quien: "Ana" }])
  })

  it("an alias over a column that does not exist is still an unknown column", () => {
    expect(() => tablaPostgrest(FILAS).select("id, quien:no_existe")).toThrow(/no_existe/)
  })
})

describe("columns that do not exist in the fixtures", () => {
  const sobreTabla = (fn: (q: any) => unknown) => () => fn(tablaPostgrest(FILAS).select("id"))

  it.each([
    ["eq", (q: any) => q.eq("derivada_a_sucursal_id", "s1")],
    ["neq", (q: any) => q.neq("derivada_a_sucursal_id", "s1")],
    ["in", (q: any) => q.in("derivada_a_sucursal_id", ["s1"])],
    ["is", (q: any) => q.is("derivada_a_sucursal_id", null)],
    ["ilike", (q: any) => q.ilike("derivada_a_sucursal_id", "%s%")],
    ["gte", (q: any) => q.gte("derivada_a_sucursal_id", "s")],
    ["order", (q: any) => q.order("derivada_a_sucursal_id")],
    ["a condition of an or()", (q: any) => q.or("sucursal_id.eq.s1,derivada_a_sucursal_id.eq.s1")],
    ["a nested condition of an or()", (q: any) => q.or("and(tecnico_id.is.null,or(derivada_a_sucursal_id.eq.s1,sucursal_id.eq.s1))")],
  ])("throws on %s", (_caso, fn) => {
    expect(sobreTabla(fn)).toThrow(/derivada_a_sucursal_id/)
  })

  it("throws on a plain column of the select list", () => {
    expect(() => tablaPostgrest(FILAS).select("id, derivada_a_sucursal_id")).toThrow(/derivada_a_sucursal_id/)
  })

  it("accepts every column the fixtures have, in filters, or() and select", async () => {
    const { data } = await tablaPostgrest(FILAS)
      .select("id, nombre")
      .eq("sucursal_id", "s1")
      .or("tecnico_id.is.null,and(tecnico_id.eq.t1,nombre.ilike.%Beto%)")
      .order("nombre")
    expect(data).toEqual([{ id: "a", nombre: "Ana" }, { id: "b", nombre: "Beto" }])
  })

  it("knows a column that only SOME rows have (the union of the keys)", async () => {
    const tabla = tablaPostgrest([{ id: "a" }, { id: "b", extra: "x" }])
    expect((await tabla.select("id").eq("extra", "x")).data).toEqual([{ id: "b" }])
  })

  it("lets an embed in the select list through: it is not a column", async () => {
    const { data } = await tablaPostgrest([{ id: "a", hijos: [1] }]).select("id, hijos:hijos!fk(id)")
    expect(data).toEqual([{ id: "a", hijos: [1] }])
  })

  it("cannot judge an empty table, so it does not throw", async () => {
    expect((await tablaPostgrest([]).select("x").eq("lo_que_sea", 1)).data).toEqual([])
  })
})

describe("a filter on a column of an embedded table (PostgREST: embed!inner + embed.col)", () => {
  const FACTURAS = [
    { id: "f1", total: 100, ordenes_servicio: { organization_id: "o1", sucursal_id: "s1" } },
    { id: "f2", total: 40, ordenes_servicio: { organization_id: "o1", sucursal_id: "s2" } },
    { id: "f3", total: 7, ordenes_servicio: { organization_id: "o2", sucursal_id: "s1" } },
  ]
  const facturas = () => tablaPostgrest(FACTURAS).select("id, total, ordenes_servicio!inner(organization_id, sucursal_id)")

  it("keeps the rows whose embedded row matches, and the embed travels with them", async () => {
    const { data } = await facturas().eq("ordenes_servicio.sucursal_id", "s1")
    expect(data).toEqual([
      { id: "f1", total: 100, ordenes_servicio: { organization_id: "o1", sucursal_id: "s1" } },
      { id: "f3", total: 7, ordenes_servicio: { organization_id: "o2", sucursal_id: "s1" } },
    ])
  })

  it("filters stack, like the dashboard's organization + branch pair", async () => {
    const { data } = await facturas().eq("ordenes_servicio.organization_id", "o1").eq("ordenes_servicio.sucursal_id", "s2")
    expect(data?.map((f: any) => f.id)).toEqual(["f2"])
  })

  it("a row with no embedded row is out, as in an inner join", async () => {
    const { data } = await tablaPostgrest([...FACTURAS, { id: "f4", total: 1, ordenes_servicio: null }])
      .select("id, ordenes_servicio!inner(sucursal_id)")
      .eq("ordenes_servicio.sucursal_id", "s1")
    expect(data?.map((f: any) => f.id)).toEqual(["f1", "f3"])
  })

  it("a column the embedded rows do not have is an error, not NULL for every row", () => {
    expect(() => facturas().eq("ordenes_servicio.no_existe", "s1")).toThrow(/no_existe/)
  })

  it("an embed the rows do not have is an error too", () => {
    expect(() => facturas().eq("garantias.sucursal_id", "s1")).toThrow(/garantias/)
  })
})

describe("a filter on an embedded table WITHOUT !inner (PostgREST filters the embedded rows, not the parents)", () => {
  const FACTURAS = [
    { id: "f1", total: 100, ordenes_servicio: { organization_id: "o1", sucursal_id: "s1" } },
    { id: "f2", total: 40, ordenes_servicio: { organization_id: "o1", sucursal_id: "s2" } },
  ]
  const sinInner = () => tablaPostgrest(FACTURAS).select("id, total, ordenes_servicio(organization_id, sucursal_id)")

  it("keeps every parent row: a route that forgot !inner would return the other branch's rows", async () => {
    const { data } = await sinInner().eq("ordenes_servicio.sucursal_id", "s1")
    expect(data?.map((f: any) => f.id)).toEqual(["f1", "f2"])
  })

  it("a to-one embed that fails the filter comes back null", async () => {
    const { data } = await sinInner().eq("ordenes_servicio.sucursal_id", "s1")
    expect(data?.map((f: any) => f.ordenes_servicio?.sucursal_id ?? null)).toEqual(["s1", null])
  })

  it("never touches the fixture rows it filters a copy of", async () => {
    await sinInner().eq("ordenes_servicio.sucursal_id", "s1")
    expect(FACTURAS[1].ordenes_servicio).toEqual({ organization_id: "o1", sucursal_id: "s2" })
  })

  it("a nested embed path is filtered on the copy, never on the fixture", async () => {
    const filas = [{ id: "1", cliente: { ordenes: [{ x: 1 }, { x: 2 }] } }]
    const { data } = await tablaPostgrest(filas).select("id, cliente(ordenes(x))").eq("cliente.ordenes.x", 1)
    expect(data).toEqual([{ id: "1", cliente: { ordenes: [{ x: 1 }] } }])
    expect(filas[0].cliente.ordenes).toEqual([{ x: 1 }, { x: 2 }])
  })

  it("a to-many embed keeps the parents and filters the embedded array", async () => {
    const clientes = [
      { id: "c1", ordenes: [{ id: "o1", sucursal_id: "s1" }, { id: "o2", sucursal_id: "s2" }] },
      { id: "c2", ordenes: [{ id: "o3", sucursal_id: "s2" }] },
    ]
    const { data } = await tablaPostgrest(clientes).select("id, ordenes(id, sucursal_id)").eq("ordenes.sucursal_id", "s1")
    expect(data).toEqual([
      { id: "c1", ordenes: [{ id: "o1", sucursal_id: "s1" }] },
      { id: "c2", ordenes: [] },
    ])
  })

  it("with !inner on a to-many embed, a parent with no matching embedded row is out", async () => {
    const clientes = [
      { id: "c1", ordenes: [{ id: "o1", sucursal_id: "s1" }, { id: "o2", sucursal_id: "s2" }] },
      { id: "c2", ordenes: [{ id: "o3", sucursal_id: "s2" }] },
    ]
    const { data } = await tablaPostgrest(clientes).select("id, ordenes!inner(id, sucursal_id)").eq("ordenes.sucursal_id", "s1")
    expect(data?.map((c: any) => c.id)).toEqual(["c1"])
    // ...and the parent that stays carries only the embedded rows that matched.
    expect(data?.[0].ordenes).toEqual([{ id: "o1", sucursal_id: "s1" }])
  })

  describe("several filters on the same embed apply to the SAME embedded row", () => {
    // c1 holds an order of A without technician and an order of B held by t-a: no order is both "of A" and "t-a's".
    const CLIENTES = [
      { id: "c1", ordenes: [{ id: "o1", sucursal_id: "A", tecnico_id: null }, { id: "o2", sucursal_id: "B", tecnico_id: "t-a" }] },
      { id: "c2", ordenes: [{ id: "o3", sucursal_id: "A", tecnico_id: "t-a" }, { id: "o4", sucursal_id: "A", tecnico_id: null }] },
      { id: "c3", ordenes: [{ id: "o5", sucursal_id: "B", tecnico_id: null }] },
    ]
    const ordenesDe = (data: any[] | null) => Object.fromEntries((data ?? []).map((c) => [c.id, c.ordenes.map((o: any) => o.id)]))

    it("with !inner: a parent is kept only if ONE embedded row satisfies every filter, and keeps only those rows", async () => {
      const { data } = await tablaPostgrest(CLIENTES)
        .select("id, ordenes!inner(id, sucursal_id, tecnico_id)")
        .eq("ordenes.sucursal_id", "A")
        .eq("ordenes.tecnico_id", "t-a")
      expect(ordenesDe(data)).toEqual({ c2: ["o3"] })
    })

    it("without !inner: every parent stays and each embedded array keeps the rows that satisfy BOTH filters", async () => {
      const { data } = await tablaPostgrest(CLIENTES)
        .select("id, ordenes(id, sucursal_id, tecnico_id)")
        .eq("ordenes.sucursal_id", "A")
        .eq("ordenes.tecnico_id", "t-a")
      expect(ordenesDe(data)).toEqual({ c1: [], c2: ["o3"], c3: [] })
    })

    it("the order the filters are chained in does not matter", async () => {
      const { data } = await tablaPostgrest(CLIENTES)
        .select("id, ordenes!inner(id, sucursal_id, tecnico_id)")
        .eq("ordenes.tecnico_id", "t-a")
        .eq("ordenes.sucursal_id", "A")
      expect(ordenesDe(data)).toEqual({ c2: ["o3"] })
    })

    it("a filter of another embed (or of the parent) is not mixed into the row predicate", async () => {
      const filas = [
        { id: "p1", tipo: "x", ordenes: [{ id: "o1", sucursal_id: "A" }], pagos: [{ id: "g1", metodo: "EFECTIVO" }] },
        { id: "p2", tipo: "y", ordenes: [{ id: "o2", sucursal_id: "A" }], pagos: [{ id: "g2", metodo: "TARJETA" }] },
      ]
      const { data } = await tablaPostgrest(filas)
        .select("id, ordenes!inner(id, sucursal_id), pagos!inner(id, metodo)")
        .eq("ordenes.sucursal_id", "A")
        .eq("pagos.metodo", "EFECTIVO")
        .eq("tipo", "x")
      expect(data?.map((p: any) => p.id)).toEqual(["p1"])
    })

    it("an eq() and a not() on the same embed also need one row for both", async () => {
      // (or() with referencedTable joins the same condition: its own test is in the or() describe, with PR5.)
      const { data } = await tablaPostgrest(CLIENTES)
        .select("id, ordenes!inner(id, sucursal_id, tecnico_id)")
        .eq("ordenes.sucursal_id", "A")
        .not("ordenes.tecnico_id", "is", null)
      expect(ordenesDe(data)).toEqual({ c2: ["o3"] })
    })

    it("a to-one embed with two filters is judged on its one row (unchanged)", async () => {
      const filas = [
        { id: "t1", orden: { sucursal_id: "A", tecnico_id: "t-a" } },
        { id: "t2", orden: { sucursal_id: "A", tecnico_id: null } },
        { id: "t3", orden: { sucursal_id: "B", tecnico_id: "t-a" } },
      ]
      const conInner = await tablaPostgrest(filas).select("id, orden!inner(sucursal_id, tecnico_id)").eq("orden.sucursal_id", "A").eq("orden.tecnico_id", "t-a")
      expect(conInner.data?.map((t: any) => t.id)).toEqual(["t1"])
      const sinInner = await tablaPostgrest(filas).select("id, orden(sucursal_id, tecnico_id)").eq("orden.sucursal_id", "A").eq("orden.tecnico_id", "t-a")
      expect(sinInner.data?.map((t: any) => t.orden?.tecnico_id ?? null)).toEqual(["t-a", null, null])
    })

    it("nested embeds: the filters on one nested path judge the same row of it", async () => {
      const facturas = [
        { id: "f1", ordenes_servicio: [{ id: "o1", sucursal_id: "A", tecnico_id: null }, { id: "o2", sucursal_id: "B", tecnico_id: "t-a" }] },
        { id: "f2", ordenes_servicio: [{ id: "o3", sucursal_id: "A", tecnico_id: "t-a" }] },
      ]
      const pagos = [
        { id: "p1", facturas: facturas[0] },
        { id: "p2", facturas: facturas[1] },
      ]
      const { data } = await tablaPostgrest(pagos)
        .select("id, facturas!inner(id, ordenes_servicio!inner(id, sucursal_id, tecnico_id))")
        .eq("facturas.ordenes_servicio.sucursal_id", "A")
        .eq("facturas.ordenes_servicio.tecnico_id", "t-a")
      expect(data?.map((p: any) => p.id)).toEqual(["p2"])
    })
  })

  it("an alias embed is filtered by its alias, and !inner is found behind a foreign-key hint", async () => {
    const filas = [
      { id: "t1", ordenes_servicio: { id: "a", sucursal_id: "s1" } },
      { id: "t2", ordenes_servicio: { id: "b", sucursal_id: "s2" } },
    ]
    const conInner = await tablaPostgrest(filas)
      .select("id, ordenes_servicio:ordenes_servicio!orden_id_fkey!inner(id, sucursal_id)")
      .eq("ordenes_servicio.sucursal_id", "s1")
    expect(conInner.data?.map((t: any) => t.id)).toEqual(["t1"])
    const sinHint = await tablaPostgrest(filas)
      .select("id, ordenes_servicio:ordenes_servicio!orden_id_fkey(id, sucursal_id)")
      .eq("ordenes_servicio.sucursal_id", "s1")
    expect(sinHint.data?.map((t: any) => t.id)).toEqual(["t1", "t2"])
  })

  it("not() on an embedded column follows the same rule", async () => {
    const { data } = await sinInner().not("ordenes_servicio.sucursal_id", "is", null)
    expect(data?.map((f: any) => f.id)).toEqual(["f1", "f2"])
    const conInner = await tablaPostgrest(FACTURAS)
      .select("id, ordenes_servicio!inner(sucursal_id)")
      .not("ordenes_servicio.sucursal_id", "in", "(s1)")
    expect(conInner.data?.map((f: any) => f.id)).toEqual(["f2"])
  })

  it("a filter on an embed the select list does not embed is an error, not a silent match", () => {
    const { select } = tablaPostgrest(FACTURAS)
    expect(() => select("id, total").eq("ordenes_servicio.sucursal_id", "s1")).toThrow(/does not embed.*ordenes_servicio|ordenes_servicio.*does not embed/)
  })
})

describe("or() on an embedded table (referencedTable, with embed!inner)", () => {
  const LOGS = [
    { id: "n1", ordenes_servicio: { sucursal_id: "s1", tecnico_id: null } },
    { id: "n2", ordenes_servicio: { sucursal_id: "s2", tecnico_id: "t1" } },
    { id: "n3", ordenes_servicio: { sucursal_id: "s2", tecnico_id: "t2" } },
    { id: "n4", ordenes_servicio: null },
  ]
  const logs = () => tablaPostgrest(LOGS).select("id, ordenes_servicio!inner(sucursal_id, tecnico_id)")

  it("keeps the rows whose embedded row matches any condition of the list", async () => {
    const { data } = await logs().or("sucursal_id.eq.s1,tecnico_id.eq.t1", { referencedTable: "ordenes_servicio" })
    expect(data?.map((l: any) => l.id)).toEqual(["n1", "n2"])
  })

  it("a row with no embedded row is out, as in an inner join", async () => {
    const { data } = await logs().or("tecnico_id.is.null,sucursal_id.eq.s2", { referencedTable: "ordenes_servicio" })
    expect(data?.map((l: any) => l.id)).toEqual(["n1", "n2", "n3"])
  })

  it("nested groups work on the embedded row too", async () => {
    const { data } = await logs().or("and(sucursal_id.eq.s2,tecnico_id.eq.t2),tecnico_id.eq.t1", { referencedTable: "ordenes_servicio" })
    expect(data?.map((l: any) => l.id)).toEqual(["n2", "n3"])
  })

  it("a column the embedded rows do not have is an error", () => {
    expect(() => logs().or("derivada_a_sucursal_id.eq.s1", { referencedTable: "ordenes_servicio" })).toThrow(/derivada_a_sucursal_id/)
  })

  it("it stacks with an or() on the table itself", async () => {
    const { data } = await logs()
      .or("sucursal_id.eq.s2", { referencedTable: "ordenes_servicio" })
      .or("id.eq.n3,id.eq.n1")
    expect(data?.map((l: any) => l.id)).toEqual(["n3"])
  })

  it("WITHOUT !inner every parent stays and only the embedded rows are filtered", async () => {
    const { data } = await tablaPostgrest(LOGS)
      .select("id, ordenes_servicio(sucursal_id, tecnico_id)")
      .or("sucursal_id.eq.s1,tecnico_id.eq.t1", { referencedTable: "ordenes_servicio" })
    expect(data?.map((l: any) => l.id)).toEqual(["n1", "n2", "n3", "n4"])
    expect(data?.map((l: any) => l.ordenes_servicio?.sucursal_id ?? null)).toEqual(["s1", "s2", null, null])
  })

  it("an embed the select list does not embed is an error", () => {
    expect(() => tablaPostgrest(LOGS).select("id").or("sucursal_id.eq.s1", { referencedTable: "ordenes_servicio" })).toThrow(/does not embed/)
  })

  it("an or() on a to-many embed and a filter on the same embed need ONE embedded row for both", async () => {
    const clientes = [
      { id: "c1", ordenes: [{ id: "o1", sucursal_id: "A", tecnico_id: null }, { id: "o2", sucursal_id: "B", tecnico_id: "t-a" }] },
      { id: "c2", ordenes: [{ id: "o3", sucursal_id: "A", tecnico_id: "t-a" }, { id: "o4", sucursal_id: "A", tecnico_id: null }] },
    ]
    const conInner = await tablaPostgrest(clientes)
      .select("id, ordenes!inner(id, sucursal_id, tecnico_id)")
      .or("sucursal_id.eq.A", { referencedTable: "ordenes" })
      .eq("ordenes.tecnico_id", "t-a")
    expect(conInner.data?.map((c: any) => [c.id, c.ordenes.map((o: any) => o.id)])).toEqual([["c2", ["o3"]]])
    const sinInner = await tablaPostgrest(clientes)
      .select("id, ordenes(id, sucursal_id, tecnico_id)")
      .or("sucursal_id.eq.A", { referencedTable: "ordenes" })
      .eq("ordenes.tecnico_id", "t-a")
    expect(sinInner.data?.map((c: any) => [c.id, c.ordenes.map((o: any) => o.id)])).toEqual([["c1", []], ["c2", ["o3"]]])
  })
})

describe("not()", () => {
  const FILAS_NOT = [
    { id: "a", tecnico_id: null, estado: "RECIBIDO" },
    { id: "b", tecnico_id: "t1", estado: "REPARADO" },
    { id: "c", tecnico_id: "t2", estado: "ENTREGADO" },
  ]

  it("not is null keeps the rows that have a value", async () => {
    const { data } = await tablaPostgrest(FILAS_NOT).select("id").not("tecnico_id", "is", null)
    expect(data).toEqual([{ id: "b" }, { id: "c" }])
  })

  it("not in (..) drops the listed values", async () => {
    const { data } = await tablaPostgrest(FILAS_NOT).select("id").not("estado", "in", "(RECIBIDO,REPARADO)")
    expect(data).toEqual([{ id: "c" }])
  })

  it("a column that does not exist is an error", () => {
    expect(() => tablaPostgrest(FILAS_NOT).select("id").not("derivada_a_sucursal_id", "is", null)).toThrow(/derivada_a_sucursal_id/)
  })
})

describe("an embed written with a space before its parenthesis", () => {
  it("is kept under its name (the dashboard writes `clientes (nombre)`)", async () => {
    const { data } = await tablaPostgrest([{ id: "a", clientes: { nombre: "Ana" } }]).select("id, clientes (nombre)")
    expect(data).toEqual([{ id: "a", clientes: { nombre: "Ana" } }])
  })
})

describe("two embeds of the same table in one select", () => {
  // PostgREST finds the embed a filter names by the embed's table name OR its alias, and takes the first
  // one that answers: a name two embeds answer to would filter whichever it meets first.
  const TECNICOS = [
    {
      id: "t1",
      en_alcance: [
        { id: "o1", estado: "EN_REPARACION", sucursal_id: "A" },
        { id: "o2", estado: "REPARADO", sucursal_id: "A" },
      ],
      activas: [
        { id: "o1", estado: "EN_REPARACION", sucursal_id: "A" },
        { id: "o3", estado: "EN_REPARACION", sucursal_id: "B" },
      ],
    },
  ]
  const DOS = "id, en_alcance:ordenes!tecnico_id(id, estado, sucursal_id), activas:ordenes!tecnico_id(id, estado, sucursal_id)"

  it("a filter by an alias narrows that embed and leaves the other as it came", async () => {
    const { data } = await tablaPostgrest(TECNICOS).select(DOS).eq("en_alcance.sucursal_id", "A").eq("activas.estado", "EN_REPARACION")
    expect(data?.[0].en_alcance.map((o: any) => o.id)).toEqual(["o1", "o2"])
    expect(data?.[0].activas.map((o: any) => o.id)).toEqual(["o1", "o3"])
    const soloUno = await tablaPostgrest(TECNICOS).select(DOS).eq("activas.sucursal_id", "B")
    expect(soloUno.data?.[0].en_alcance.map((o: any) => o.id)).toEqual(["o1", "o2"])
    expect(soloUno.data?.[0].activas.map((o: any) => o.id)).toEqual(["o3"])
  })

  it("an or() with referencedTable follows the same rule", async () => {
    const { data } = await tablaPostgrest(TECNICOS).select(DOS).or("sucursal_id.eq.A", { referencedTable: "en_alcance" })
    expect(data?.[0].en_alcance.map((o: any) => o.id)).toEqual(["o1", "o2"])
    expect(data?.[0].activas.map((o: any) => o.id)).toEqual(["o1", "o3"])
  })

  it("a filter by the table's name is ambiguous when both embeds are of that table: it is an error", () => {
    expect(() => tablaPostgrest(TECNICOS).select(DOS).eq("ordenes.estado", "EN_REPARACION")).toThrow(/ambiguous/)
    expect(() => tablaPostgrest(TECNICOS).select(DOS).or("estado.eq.REPARADO", { referencedTable: "ordenes" })).toThrow(/ambiguous/)
  })

  it("an alias that is the table's own name is ambiguous next to another embed of that table", () => {
    const select = "id, ordenes:ordenes!tecnico_id(id, estado), activas:ordenes!tecnico_id(id, estado)"
    const filas = [{ id: "t1", ordenes: [{ id: "o1", estado: "EN_REPARACION" }], activas: [{ id: "o1", estado: "EN_REPARACION" }] }]
    expect(() => tablaPostgrest(filas).select(select).eq("ordenes.estado", "EN_REPARACION")).toThrow(/ambiguous/)
    // ...and the other alias is fine.
    expect(() => tablaPostgrest(filas).select(select).eq("activas.estado", "EN_REPARACION")).not.toThrow()
  })

  it("an alias that is the table name of ANOTHER embed is ambiguous too", () => {
    const filas = [{ id: "p1", a: [{ id: "v1", x: 1 }], ventas: [{ id: "o1", x: 1 }] }]
    expect(() => tablaPostgrest(filas).select("id, a:ventas(id, x), ventas:ordenes(id, x)").eq("ventas.x", 1)).toThrow(/ambiguous/)
    expect(() => tablaPostgrest(filas).select("id, a:ventas(id, x), ventas:ordenes(id, x)").eq("a.x", 1)).not.toThrow()
  })

  it("a lone embed is never ambiguous, whatever its alias", async () => {
    const filas = [{ id: "t1", ordenes: [{ id: "o1", estado: "EN_REPARACION" }] }]
    const { data } = await tablaPostgrest(filas).select("id, ordenes:ordenes!tecnico_id(id, estado)").eq("ordenes.estado", "EN_REPARACION")
    expect(data?.[0].ordenes).toHaveLength(1)
  })

  it("embeds of different tables never clash", async () => {
    const filas = [{ id: "t1", ordenes: [{ id: "o1", estado: "X" }], ventas: [{ id: "v1", estado: "X" }] }]
    const { data } = await tablaPostgrest(filas).select("id, ordenes(id, estado), ventas(id, estado)").eq("ordenes.estado", "Y")
    expect(data?.[0].ordenes).toEqual([])
    expect(data?.[0].ventas).toHaveLength(1)
  })
})

describe("the rows PostgREST answers at most (max-rows: 1000 on Supabase)", () => {
  const MUCHAS = Array.from({ length: 12 }, (_, i) => ({
    id: `p${i}`,
    hijas: Array.from({ length: 5 }, (_, j) => ({ id: `h${i}-${j}` })),
  }))

  it("nothing is capped unless the table is given a cap", async () => {
    const { data } = await tablaPostgrest(MUCHAS).select("id")
    expect(data).toHaveLength(12)
  })

  it("the rows of the query are cut at the cap, silently, as PostgREST does", async () => {
    const { data, error } = await tablaPostgrest(MUCHAS, { maxFilas: 10 }).select("id")
    expect(error).toBeNull()
    expect(data).toHaveLength(10)
  })

  it("a range inside the cap is honoured, and the cap applies to what it asks for", async () => {
    const dentro = await tablaPostgrest(MUCHAS, { maxFilas: 10 }).select("id").range(0, 4)
    expect(dentro.data).toHaveLength(5)
    const fuera = await tablaPostgrest(MUCHAS, { maxFilas: 10 }).select("id").range(0, 11)
    expect(fuera.data).toHaveLength(10)
    // The cap limits how many rows come back, not how far in a range may start.
    const alFinal = await tablaPostgrest(MUCHAS, { maxFilas: 10 }).select("id").range(8, 11)
    expect(alFinal.data?.map((p: any) => p.id)).toEqual(["p8", "p9", "p10", "p11"])
  })

  // PostgREST applies the cap to EVERY node of the read plan: a to-many embed gets a LIMIT per parent.
  it("the rows of a to-many embed are cut at the cap for each parent", async () => {
    const { data } = await tablaPostgrest(MUCHAS, { maxFilas: 3 }).select("id, hijas(id)")
    expect(data).toHaveLength(3)
    expect(data?.every((p: any) => p.hijas.length === 3)).toBe(true)
    expect(data?.[0].hijas.map((h: any) => h.id)).toEqual(["h0-0", "h0-1", "h0-2"])
  })

  it("an embed under the cap comes whole", async () => {
    const { data } = await tablaPostgrest(MUCHAS, { maxFilas: 5 }).select("id, hijas(id)")
    expect(data?.every((p: any) => p.hijas.length === 5)).toBe(true)
  })

  it("the cap of an embed comes after its own filters: what a filter keeps is what counts against it", async () => {
    const filas = [
      {
        id: "p1",
        hijas: [
          ...Array.from({ length: 6 }, (_, j) => ({ id: `viejas-${j}`, estado: "ENTREGADO" })),
          ...Array.from({ length: 2 }, (_, j) => ({ id: `abiertas-${j}`, estado: "RECIBIDO" })),
        ],
      },
    ]
    const sinFiltro = await tablaPostgrest(filas, { maxFilas: 5 }).select("id, hijas(id, estado)")
    expect(sinFiltro.data?.[0].hijas.map((h: any) => h.id)).toEqual(["viejas-0", "viejas-1", "viejas-2", "viejas-3", "viejas-4"])
    const filtrada = await tablaPostgrest(filas, { maxFilas: 5 }).select("id, hijas(id, estado)").eq("hijas.estado", "RECIBIDO")
    expect(filtrada.data?.[0].hijas.map((h: any) => h.id)).toEqual(["abiertas-0", "abiertas-1"])
  })

  it("every embed of a nested path is cut for each of its parents, and the fixture is never touched", async () => {
    const filas = [{ id: "c1", ordenes: Array.from({ length: 3 }, (_, i) => ({ id: `o${i}`, items: Array.from({ length: 4 }, (_, j) => ({ id: `i${i}-${j}` })) })) }]
    const { data } = await tablaPostgrest(filas, { maxFilas: 2 }).select("id, ordenes(id, items(id))")
    expect(data?.[0].ordenes).toHaveLength(2)
    expect(data?.[0].ordenes.every((o: any) => o.items.length === 2)).toBe(true)
    expect(filas[0].ordenes).toHaveLength(3)
    expect(filas[0].ordenes[0].items).toHaveLength(4)
  })

  it("a to-one embed is not a list: the cap has nothing to cut", async () => {
    const filas = [{ id: "t1", orden: { id: "o1", estado: "X" } }]
    const { data } = await tablaPostgrest(filas, { maxFilas: 1 }).select("id, orden(id, estado)")
    expect(data?.[0].orden).toEqual({ id: "o1", estado: "X" })
  })

  it("the exact count is the real one, not the capped one", async () => {
    const respuesta = await tablaPostgrest(MUCHAS, { maxFilas: 10 }).select("id", { count: "exact" })
    expect(respuesta.count).toBe(12)
  })
})
