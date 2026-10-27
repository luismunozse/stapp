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
