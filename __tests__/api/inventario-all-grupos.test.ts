import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import { mockAuthSuccess, parseResponse } from "./helpers"

vi.mock("@/lib/audit", () => ({
  createAuditLogger: vi.fn(() => ({ delete: vi.fn().mockResolvedValue(undefined) })),
}))

import { DELETE } from "@/app/api/inventario/all/route"

// DELETE /api/inventario/all wipes the organization's inventory. Variant groups left without
// children go with it (VI-3, and the empty groups a single hard delete may leave: VG-15), but
// the group of a child that could NOT be deleted stays with that child. The fake is an
// in-memory store with the real foreign-key behavior that matters here: deleting a row that a
// repair order still references fails with 23503 (so a route that wrongly includes a blocked
// child in the delete is caught instead of passing on the happy path), and deleting a group
// would detach (SET NULL) any child still pointing at it. It holds a second organization.

type Fila = Record<string, any>

interface Almacen {
  inventario: Fila[]
  inventario_grupos: Fila[]
  repuestos_orden: Fila[]
}

const hijo = (id: string, grupo: string | null, org = "org-1"): Fila => ({
  id,
  codigo: `C-${id}`,
  nombre: id,
  organization_id: org,
  grupo_id: grupo,
})

function datos(): Almacen {
  return {
    inventario: [
      hijo("azul", "g-1"),
      hijo("rojo", "g-1"),
      hijo("negro", "g-2"),
      hijo("suelto", null),
      hijo("ajeno", "g-ajeno", "org-2"),
    ],
    inventario_grupos: [
      { id: "g-1", organization_id: "org-1" },
      { id: "g-2", organization_id: "org-1" },
      { id: "g-vacio", organization_id: "org-1" }, // the last child was hard-deleted long ago
      { id: "g-ajeno", organization_id: "org-2" },
    ],
    repuestos_orden: [],
  }
}

interface Consulta {
  tabla: string
  op: string
}

function fake(almacen: Almacen, opts: { errorAlSeleccionarGrupo?: { code: string; message: string }; errorAlBorrarGrupos?: { code: string; message: string }; truncarRestantes?: number; sinConteo?: boolean } = {}) {
  const consultas: Consulta[] = []
  vi.mocked(supabaseAdmin.from).mockImplementation(((tabla: keyof Almacen) => {
    const q: Record<string, any> = { tabla, op: "select", eq: [] as [string, unknown][], in: null, not: null, columnas: "" }
    consultas.push(q as Consulta)
    const api: any = {
      select: (c: string, o?: { count?: string }) => ((q.columnas = c), (q.conteo = o?.count), api),
      delete: () => ((q.op = "delete"), api),
      eq: (c: string, v: unknown) => (q.eq.push([c, v]), api),
      in: (c: string, v: unknown[]) => ((q.in = [c, v]), api),
      not: (c: string, op: string, v: unknown) => {
        if (op === "is") q.notIs = [c, v]
        else if (op === "in") q.not = [c, [...String(v).matchAll(/"([^"]+)"/g)].map((m) => m[1])]
        return api
      },
      limit: () => api,
      then: (resolve: any, reject?: any) => {
        const filas = almacen[tabla]
        const coincide = (f: Fila) =>
          q.eq.every(([c, v]: [string, unknown]) => f[c] === v) &&
          (!q.in || q.in[1].includes(f[q.in[0]])) &&
          (!q.not || !q.not[1].includes(f[q.not[0]])) &&
          (!q.notIs || f[q.notIs[0]] !== q.notIs[1])
        let resultado: Record<string, unknown>
        if (q.op === "delete") {
          if (tabla === "inventario_grupos" && opts.errorAlBorrarGrupos) {
            resultado = { data: null, error: opts.errorAlBorrarGrupos }
          } else {
            const borrar = filas.filter(coincide)
            const bloqueadas = tabla === "inventario" ? borrar.filter((f) => almacen.repuestos_orden.some((r) => r.inventario_id === f.id)) : []
            if (bloqueadas.length > 0) {
              resultado = { data: null, error: { code: "23503", message: "violates foreign key constraint" } }
            } else {
              almacen[tabla] = filas.filter((f) => !borrar.includes(f))
              if (tabla === "inventario_grupos") {
                // ON DELETE SET NULL: a child still pointing at a deleted group is detached.
                for (const h of almacen.inventario) if (borrar.some((g) => g.id === h.grupo_id)) h.grupo_id = null
              }
              resultado = { data: null, error: null }
            }
          }
        } else if (tabla === "inventario" && q.columnas === "grupo_id") {
          resultado = opts.errorAlSeleccionarGrupo
            ? { data: null, error: opts.errorAlSeleccionarGrupo }
            : (() => {
                const todas = filas.filter(coincide).map((f) => ({ grupo_id: f.grupo_id }))
                const data = opts.truncarRestantes !== undefined ? todas.slice(0, opts.truncarRestantes) : todas
                // count is only present when the route asks for it (count: "exact")
                return { data, error: null, count: q.conteo === "exact" && !opts.sinConteo ? todas.length : null }
              })()
        } else if (tabla === "inventario") {
          resultado = { data: filas.filter(coincide).map(({ id, codigo, nombre }) => ({ id, codigo, nombre })), error: null }
        } else {
          // repuestos_orden / items_devolucion / items_orden_compra reads
          resultado = { data: (almacen as any)[tabla]?.filter(coincide) ?? [], error: null }
        }
        return Promise.resolve(resultado).then(resolve, reject)
      },
    }
    return api
  }) as any)
  return { consultas }
}

const idsGrupos = (a: Almacen, org: string) => a.inventario_grupos.filter((g) => g.organization_id === org).map((g) => g.id).sort()
const borrar = async () => parseResponse(await DELETE(new Request("http://localhost:3000/api/inventario/all", { method: "DELETE" })))

describe("DELETE /api/inventario/all: variant groups", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  it("deletes every group of the organization when all the children are deletable, including empty ones", async () => {
    const almacen = datos()
    fake(almacen)

    const { status, body } = await borrar()

    expect(status).toBe(200)
    expect(body).toEqual({ deleted: 4, blocked: [] })
    expect(idsGrupos(almacen, "org-1")).toEqual([])
    // The other organization is untouched: its child and its group are still there.
    expect(idsGrupos(almacen, "org-2")).toEqual(["g-ajeno"])
    expect(almacen.inventario.map((f) => f.id)).toEqual(["ajeno"])
  })

  it("keeps the group of a child that could not be deleted and drops the rest", async () => {
    const almacen = datos()
    // Azul is used by a repair order: it cannot be deleted. Rojo (same group) can.
    almacen.repuestos_orden.push({ inventario_id: "azul" })
    fake(almacen)

    const { status, body } = await borrar()

    expect(status).toBe(200)
    expect(body.deleted).toBe(3)
    expect(body.blocked).toEqual([{ id: "azul", codigo: "C-azul", nombre: "azul" }])
    // g-1 stays with its blocked child (still grouped); g-2 and the empty group are gone.
    expect(idsGrupos(almacen, "org-1")).toEqual(["g-1"])
    expect(almacen.inventario.find((f) => f.id === "azul")?.grupo_id).toBe("g-1")
    expect(idsGrupos(almacen, "org-2")).toEqual(["g-ajeno"])
  })

  it("keeps the group of every blocked child when children of different groups are blocked", async () => {
    const almacen = datos()
    almacen.repuestos_orden.push({ inventario_id: "azul" }, { inventario_id: "negro" })
    fake(almacen)

    const { body } = await borrar()

    expect(body.blocked.map((b: Fila) => b.id).sort()).toEqual(["azul", "negro"])
    expect(idsGrupos(almacen, "org-1")).toEqual(["g-1", "g-2"])
    expect(almacen.inventario.filter((f) => f.organization_id === "org-1").map((f) => f.grupo_id).sort()).toEqual(["g-1", "g-2"])
  })

  it("removes the empty groups of an organization that has no inventory left", async () => {
    const almacen = datos()
    almacen.inventario = almacen.inventario.filter((f) => f.organization_id !== "org-1")
    fake(almacen)

    const { status, body } = await borrar()

    expect(status).toBe(200)
    expect(body).toEqual({ deleted: 0, blocked: [] })
    expect(idsGrupos(almacen, "org-1")).toEqual([])
    expect(idsGrupos(almacen, "org-2")).toEqual(["g-ajeno"])
  })

  it("leaves an organization without any group exactly as before", async () => {
    const almacen = datos()
    almacen.inventario = [hijo("a", null), hijo("b", null)]
    almacen.inventario_grupos = [{ id: "g-ajeno", organization_id: "org-2" }]
    fake(almacen)

    const { status, body } = await borrar()

    expect(status).toBe(200)
    expect(body).toEqual({ deleted: 2, blocked: [] })
    expect(idsGrupos(almacen, "org-2")).toEqual(["g-ajeno"])
  })

  it.each([
    ["42703", "column inventario.grupo_id does not exist"],
    ["42P01", 'relation "inventario_grupos" does not exist'],
  ])("ignores %s: the wipe answers as always while the migration is missing", async (code, message) => {
    const almacen = datos()
    fake(almacen, { errorAlSeleccionarGrupo: { code, message } })

    const { status, body } = await borrar()

    expect(status).toBe(200)
    expect(body).toEqual({ deleted: 4, blocked: [] })
    expect(almacen.inventario.map((f) => f.id)).toEqual(["ajeno"])
    // Nothing was done to the groups, and nothing was logged as a failure.
    expect(idsGrupos(almacen, "org-1")).toEqual(["g-1", "g-2", "g-vacio"])
    expect(console.error).not.toHaveBeenCalled()
  })

  it.each([
    ["the read of the remaining children", { errorAlSeleccionarGrupo: { code: "57014", message: "statement timeout" } }],
    ["the delete of the groups", { errorAlBorrarGrupos: { code: "57014", message: "statement timeout" } }],
  ])("still answers the wipe when %s fails with an unrelated error, and logs it", async (_caso, opts) => {
    const almacen = datos()
    fake(almacen, opts)

    const { status, body } = await borrar()

    expect(status).toBe(200)
    expect(body).toEqual({ deleted: 4, blocked: [] })
    expect(almacen.inventario.map((f) => f.id)).toEqual(["ajeno"])
    expect(console.error).toHaveBeenCalledTimes(1)
  })

  it("deletes no group when the remaining children cannot be listed completely", async () => {
    const almacen = datos()
    // 1000 children of g-1, every one blocked: the read of the remaining ones hits its cap.
    almacen.inventario = Array.from({ length: 1000 }, (_, i) => hijo(`h${i}`, "g-1"))
    almacen.repuestos_orden = almacen.inventario.map((f) => ({ inventario_id: f.id }))
    fake(almacen)

    const { status, body } = await borrar()

    expect(status).toBe(200)
    expect(body.deleted).toBe(0)
    expect(body.blocked).toHaveLength(1000)
    expect(idsGrupos(almacen, "org-1")).toEqual(["g-1", "g-2", "g-vacio"])
    expect(console.error).toHaveBeenCalledTimes(1)
  })

  it("does not count blocked standalone products against the cap of the remaining-children read", async () => {
    const almacen = datos()
    // 1000 standalone products stay (all referenced); the groups of the wiped children must still go.
    const bloqueados = Array.from({ length: 1000 }, (_, i) => hijo(`s${i}`, null))
    almacen.inventario = [...almacen.inventario, ...bloqueados]
    almacen.repuestos_orden = bloqueados.map((f) => ({ inventario_id: f.id }))
    fake(almacen)

    const { body } = await borrar()

    expect(body.blocked).toHaveLength(1000)
    expect(idsGrupos(almacen, "org-1")).toEqual([])
    expect(console.error).not.toHaveBeenCalled()
  })

  it("scopes the group delete to the organization and excludes the group of every child that remains", async () => {
    const almacen = datos()
    almacen.repuestos_orden.push({ inventario_id: "azul" })
    const { consultas } = fake(almacen)

    await borrar()

    const borrado = consultas.find((c: any) => c.tabla === "inventario_grupos" && c.op === "delete") as any
    expect(borrado.eq).toEqual([["organization_id", "org-1"]])
    expect(borrado.not).toEqual(["id", ["g-1"]])
  })
  it("deletes no group when the server returned fewer remaining children than it counted (max_rows below 1000)", async () => {
    const almacen = datos()
    almacen.repuestos_orden.push({ inventario_id: "azul" }, { inventario_id: "rojo" }, { inventario_id: "negro" })
    const { consultas } = fake(almacen, { truncarRestantes: 1 })

    const { status, body } = await borrar()

    expect(status).toBe(200)
    expect(body.blocked).toHaveLength(3)
    expect(idsGrupos(almacen, "org-1")).toEqual(["g-1", "g-2", "g-vacio"])
    expect(consultas.some((c: any) => c.tabla === "inventario_grupos" && c.op === "delete")).toBe(false)
    expect(console.error).toHaveBeenCalledTimes(1)
  })

  it("deletes no group when the count is unavailable", async () => {
    const almacen = datos()
    fake(almacen, { sinConteo: true })
    await borrar()
    expect(idsGrupos(almacen, "org-1")).toEqual(["g-1", "g-2", "g-vacio"])
    expect(console.error).toHaveBeenCalledTimes(1)
  })

})
