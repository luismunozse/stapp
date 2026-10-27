// @vitest-environment node
/**
 * The in-memory supabase is what proves "this request touched nothing": if it ignored a filter on a
 * write, a route that dropped `.eq("id", ...)` from its DELETE would still look fine. These tests pin
 * what the helper records and what it does with a write.
 */
import { describe, it, expect } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import { montarSupabaseEnMemoria } from "./supabase-memoria"

const FILAS = () => [
  { id: "o-1", organization_id: "org-1", estado: "RECIBIDO", tecnico_id: null },
  { id: "o-2", organization_id: "org-1", estado: "RECIBIDO", tecnico_id: "t-1" },
  { id: "o-3", organization_id: "org-2", estado: "RECIBIDO", tecnico_id: null },
]

const db = () => supabaseAdmin as any

describe("writes are recorded with their filters", () => {
  it("an update keeps the payload and every filter chained onto it, in order", async () => {
    const mem = montarSupabaseEnMemoria({ ordenes: FILAS() })

    await db().from("ordenes").update({ estado: "EN_REPARACION" }).eq("id", "o-1").eq("organization_id", "org-1")

    expect(mem.escrituras).toEqual([
      {
        tabla: "ordenes",
        operacion: "update",
        carga: { estado: "EN_REPARACION" },
        filtros: [
          ["eq", "id", "o-1"],
          ["eq", "organization_id", "org-1"],
        ],
      },
    ])
  })

  it("a delete and an rpc are recorded too, the rpc with no filters", async () => {
    const mem = montarSupabaseEnMemoria({ ordenes: FILAS() })

    await db().from("ordenes").delete().eq("id", "o-2")
    await db().rpc("liberar_reservas_orden", { p_orden_id: "o-2" })

    expect(mem.escrituras).toEqual([
      { tabla: "ordenes", operacion: "delete", carga: undefined, filtros: [["eq", "id", "o-2"]] },
      { tabla: "liberar_reservas_orden", operacion: "rpc", carga: { p_orden_id: "o-2" }, filtros: [] },
    ])
  })

  it("reads are listed by table and are not writes", async () => {
    const mem = montarSupabaseEnMemoria({ ordenes: FILAS() })

    await db().from("ordenes").select("id").eq("id", "o-1").single()

    expect(mem.lecturas).toEqual(["ordenes"])
    expect(mem.escrituras).toEqual([])
  })

  it("storage and auth calls are recorded as well, whatever they are", async () => {
    const mem = montarSupabaseEnMemoria({})

    await db().storage.from("fotos-ordenes").remove(["a.png"])
    await db().auth.admin.deleteUser("u-1")

    expect(mem.escrituras).toEqual([
      { tabla: "storage:fotos-ordenes", operacion: "storage", carga: { metodo: "remove", args: [["a.png"]] }, filtros: [] },
      { tabla: "auth", operacion: "auth", carga: { metodo: "admin.deleteUser", args: ["u-1"] }, filtros: [] },
    ])
  })
})

describe("writes are applied to the tables", () => {
  it("an update changes only the rows its filters match", async () => {
    const mem = montarSupabaseEnMemoria({ ordenes: FILAS() })

    await db().from("ordenes").update({ estado: "EN_REPARACION" }).eq("id", "o-1").eq("organization_id", "org-1")

    expect(mem.filas("ordenes").map((f) => [f.id, f.estado])).toEqual([
      ["o-1", "EN_REPARACION"],
      ["o-2", "RECIBIDO"],
      ["o-3", "RECIBIDO"],
    ])
  })

  it("an update without the id filter changes every row of the organization (the mistake the helper must expose)", async () => {
    const mem = montarSupabaseEnMemoria({ ordenes: FILAS() })

    await db().from("ordenes").update({ estado: "CANCELADO" }).eq("organization_id", "org-1")

    expect(mem.filas("ordenes").map((f) => f.estado)).toEqual(["CANCELADO", "CANCELADO", "RECIBIDO"])
  })

  it("an update answers with the row it changed, by the id it targeted", async () => {
    montarSupabaseEnMemoria({ ordenes: FILAS() })

    const a = await db().from("ordenes").update({ estado: "X" }).eq("id", "o-2").select("*").single()
    const b = await db().from("ordenes").update({ estado: "Y" }).eq("id", "o-1").select("*").single()

    expect(a.data).toMatchObject({ id: "o-2", estado: "X", tecnico_id: "t-1" })
    expect(b.data).toMatchObject({ id: "o-1", estado: "Y", tecnico_id: null })
  })

  it("an update that matches nothing answers like PostgREST: no row for single(), null for maybeSingle()", async () => {
    montarSupabaseEnMemoria({ ordenes: FILAS() })
    const sinCoincidencia = () => db().from("ordenes").update({ estado: "X" }).eq("id", "o-1").is("tecnico_id", "t-1")

    expect((await sinCoincidencia().select("id").single()).error).toMatchObject({ code: "PGRST116" })
    expect(await sinCoincidencia().select("id").maybeSingle()).toEqual({ data: null, error: null })
  })

  it("a delete removes the matching rows", async () => {
    const mem = montarSupabaseEnMemoria({ ordenes: FILAS() })

    await db().from("ordenes").delete().eq("id", "o-2").eq("organization_id", "org-1")

    expect(mem.filas("ordenes").map((f) => f.id)).toEqual(["o-1", "o-3"])
  })

  it("an insert adds the row", async () => {
    const mem = montarSupabaseEnMemoria({ ordenes: FILAS() })

    const { data } = await db().from("ordenes").insert({ id: "o-9", organization_id: "org-1" }).select("*").single()

    expect(data).toEqual({ id: "o-9", organization_id: "org-1" })
    expect(mem.filas("ordenes").map((f) => f.id)).toEqual(["o-1", "o-2", "o-3", "o-9"])
  })

  it("a filter the helper cannot apply to a write is an error, not a silent match", () => {
    montarSupabaseEnMemoria({ ordenes: FILAS() })

    expect(() => db().from("ordenes").update({ estado: "X" }).ilike("id", "o-%")).toThrow(/not supported on a write/)
    expect(() => db().from("ordenes").update({ estado: "X" }).eq("no_existe", "x")).toThrow(/no_existe/)
  })

  it("the fixtures the test passed in are not touched", async () => {
    const filas = FILAS()
    montarSupabaseEnMemoria({ ordenes: filas })

    await db().from("ordenes").update({ estado: "X" }).eq("id", "o-1")

    expect(filas[0].estado).toBe("RECIBIDO")
  })
})

describe("a read that fails", () => {
  it("answers the injected error for that table and only that table", async () => {
    montarSupabaseEnMemoria(
      { ordenes: FILAS(), clientes: [{ id: "c-1" }] },
      { errorDeLectura: { ordenes: { code: "57014", message: "canceling statement due to statement timeout" } } },
    )

    const ordenes = await db().from("ordenes").select("id").eq("id", "o-1").single()
    const clientes = await db().from("clientes").select("id").eq("id", "c-1").single()

    expect(ordenes).toEqual({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } })
    expect(clientes).toEqual({ data: { id: "c-1" }, error: null })
  })
})

describe("a read that fails because of a table it embeds", () => {
  it("fails the whole request, as PostgREST does when an embedded table cannot be read", async () => {
    montarSupabaseEnMemoria(
      { users: [{ id: "u-1", ordenes: [{ id: "o-1" }] }], ordenes: FILAS() },
      { errorDeLectura: { ordenes: { code: "57014", message: "canceling statement due to statement timeout" } } },
    )

    const conEmbed = await db().from("users").select("id, activas:ordenes!tecnico_id (id)").eq("id", "u-1").single()
    const sinEmbed = await db().from("users").select("id").eq("id", "u-1").single()

    expect(conEmbed).toEqual({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } })
    expect(sinEmbed).toEqual({ data: { id: "u-1" }, error: null })
  })

  it("also when the embed is nested, and the read is still listed under the table that was queried", async () => {
    const mem = montarSupabaseEnMemoria(
      { users: [{ id: "u-1" }], ordenes: FILAS() },
      { errorDeLectura: { ordenes: { message: "connection lost" } } },
    )

    const anidado = await db().from("users").select("id, clientes (id, ordenes!inner (id))").single()

    expect(anidado.error).toEqual({ message: "connection lost" })
    expect(mem.lecturas).toEqual(["users"])
  })
})

describe("the most rows a read answers (max-rows)", () => {
  it("a read of any table is cut at the cap the test asks for, and not at all without one", async () => {
    montarSupabaseEnMemoria({ ordenes: FILAS(), clientes: [{ id: "c-1" }, { id: "c-2" }, { id: "c-3" }] }, { maxFilas: 2 })
    expect((await db().from("ordenes").select("id")).data).toHaveLength(2)
    expect((await db().from("clientes").select("id")).data).toHaveLength(2)

    montarSupabaseEnMemoria({ ordenes: FILAS() })
    expect((await db().from("ordenes").select("id")).data).toHaveLength(3)
  })
})
