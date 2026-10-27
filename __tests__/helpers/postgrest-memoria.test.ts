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
