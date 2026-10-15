import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import { mockAuthSuccess, mockAuthError, createChainMock } from "./helpers"
import { POST } from "@/app/api/inventario/consolidate/route"

// Consolidating moves the stock of one item into another and archives the source. For the members of a
// variant group that would pour one variant's stock into another (or archive a member behind the group's back).
// The route refuses it for grouped items.

const post = (cuerpo: unknown) =>
  POST(new Request("http://localhost/api/inventario/consolidate", { method: "POST", body: JSON.stringify(cuerpo) }))

/** `select` answers per column list: the first one asked may carry grupo_id, the plain one never does. */
function responder(filas: Record<string, unknown>[], errorEnLaPrimera?: { code: string; message: string }) {
  const selects: string[] = []
  vi.mocked(supabaseAdmin.from).mockImplementation((() => {
    const cadena = createChainMock(filas, null)
    const original = cadena.select
    let columnas = ""
    cadena.select = vi.fn((c: string) => {
      columnas = c
      selects.push(c)
      return original(c)
    })
    ;(cadena as any).then = (resolve: any) =>
      resolve(
        columnas.includes("grupo_id")
          ? errorEnLaPrimera
            ? { data: null, error: errorEnLaPrimera }
            : { data: filas, error: null }
          : { data: filas.map((f) => ({ id: f.id })), error: null }
      )
    return cadena
  }) as any)
  return selects
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { ok: true }, error: null } as any)
})

describe("POST /api/inventario/consolidate with variants", () => {
  it("answers 401 without a session", async () => {
    mockAuthError()
    responder([])
    expect((await post({ sourceId: "a", targetId: "b" })).status).toBe(401)
  })

  it("consolidates two standalone items as before", async () => {
    mockAuthSuccess()
    responder([{ id: "a", grupo_id: null }, { id: "b", grupo_id: null }])
    const res = await post({ sourceId: "a", targetId: "b" })
    expect(res.status).toBe(200)
    expect(supabaseAdmin.rpc).toHaveBeenCalledTimes(1)
  })

  it.each([
    ["the source is a variant", [{ id: "a", grupo_id: "g1" }, { id: "b", grupo_id: null }]],
    ["the target is a variant", [{ id: "a", grupo_id: null }, { id: "b", grupo_id: "g1" }]],
    ["both are variants of one group", [{ id: "a", grupo_id: "g1" }, { id: "b", grupo_id: "g1" }]],
  ])("%s: 400 in Spanish and the RPC is never called", async (_t, filas) => {
    mockAuthSuccess()
    responder(filas)
    const res = await post({ sourceId: "a", targetId: "b" })
    const cuerpo = await res.json()
    expect(res.status).toBe(400)
    expect(cuerpo.error).toBe("Un producto con variantes no se puede consolidar. Desagrupalo primero si querés unirlo con otro")
    expect(cuerpo.code).toBe("PRODUCTO_CON_VARIANTES")
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("without the variants migration (no grupo_id column) it reads again without it and consolidates", async () => {
    mockAuthSuccess()
    const selects = responder([{ id: "a" }, { id: "b" }], { code: "42703", message: "column inventario.grupo_id does not exist" })
    const res = await post({ sourceId: "a", targetId: "b" })
    expect(res.status).toBe(200)
    expect(selects[0]).toContain("grupo_id")
    expect(selects.at(-1)).not.toContain("grupo_id")
  })

  it("still answers 404 when an item is not in the organization", async () => {
    mockAuthSuccess()
    responder([{ id: "a", grupo_id: null }])
    expect((await post({ sourceId: "a", targetId: "b" })).status).toBe(404)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })
})
