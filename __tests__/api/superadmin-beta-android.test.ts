// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextResponse } from "next/server"
import { mockSupabaseFrom, createChainMock, parseResponse } from "./helpers"

const requireSuperadmin = vi.fn()
const betaAndroidUpdate = vi.fn().mockResolvedValue(undefined)
const createSuperadminAuditLogger = vi.fn((..._args: unknown[]) => ({ betaAndroidUpdate }))

vi.mock("@/lib/superadmin-auth", () => ({ requireSuperadmin: () => requireSuperadmin() }))
vi.mock("@/lib/superadmin-audit", () => ({
  createSuperadminAuditLogger: (...args: unknown[]) => createSuperadminAuditLogger(...args),
}))

import { GET, PATCH } from "@/app/api/superadmin/beta-android/route"
import { GET as GET_STATS } from "@/app/api/superadmin/beta-android/stats/route"

const OK = { error: null, email: "admin@stapp.com.ar", userId: "sa1" }
const denegado = (status: number) => ({
  error: NextResponse.json({ error: "Acceso denegado" }, { status }),
  email: null,
  userId: null,
})

function req(url: string, init?: RequestInit) {
  return new Request(url, init)
}
function patch(body: unknown) {
  return req("http://localhost/api/superadmin/beta-android", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

const FILAS = [
  {
    id: "b2",
    email: "dos@gmail.com",
    estado: "PENDIENTE",
    created_at: "2026-10-10T10:00:00Z",
    agregado_at: null,
    users: { nombre: "Ana", email: "ana@taller.com" },
    organizations: { nombre: "Taller Uno" },
  },
]

describe("superadmin beta-android: acceso", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  it.each([401, 403])("GET: sin superadmin (%i) corta y NO toca la base", async (status) => {
    requireSuperadmin.mockResolvedValue(denegado(status))
    const from = createChainMock([])
    mockSupabaseFrom({ android_beta_testers: from })
    const res = await GET(req("http://localhost/api/superadmin/beta-android"))
    expect(res.status).toBe(status)
    expect(from.select).not.toHaveBeenCalled()
  })

  it.each([401, 403])("PATCH: sin superadmin (%i) corta y NO escribe ni audita", async (status) => {
    requireSuperadmin.mockResolvedValue(denegado(status))
    const from = createChainMock([])
    mockSupabaseFrom({ android_beta_testers: from })
    const res = await PATCH(patch({ ids: ["b1"], estado: "AGREGADO" }))
    expect(res.status).toBe(status)
    expect(from.update).not.toHaveBeenCalled()
    expect(betaAndroidUpdate).not.toHaveBeenCalled()
  })

  it("stats: sin superadmin corta", async () => {
    requireSuperadmin.mockResolvedValue(denegado(403))
    const from = createChainMock([])
    mockSupabaseFrom({ android_beta_testers: from })
    expect((await GET_STATS()).status).toBe(403)
    expect(from.select).not.toHaveBeenCalled()
  })
})

describe("GET /api/superadmin/beta-android", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, "error").mockImplementation(() => {})
    requireSuperadmin.mockResolvedValue(OK)
  })

  it("lista con usuario y taller, de la mas nueva a la mas vieja", async () => {
    const from = createChainMock(FILAS)
    mockSupabaseFrom({ android_beta_testers: from })
    const { status, body } = await parseResponse(await GET(req("http://localhost/api/superadmin/beta-android")))
    expect(status).toBe(200)
    expect(body.testers).toEqual([
      {
        id: "b2",
        email: "dos@gmail.com",
        estado: "PENDIENTE",
        created_at: "2026-10-10T10:00:00Z",
        agregado_at: null,
        usuario: { nombre: "Ana", email: "ana@taller.com" },
        taller: "Taller Uno",
      },
    ])
    // El select tiene que traer lo que la pantalla muestra (el mock no lo valida solo).
    const columnas = from.select.mock.calls[0][0] as string
    expect(columnas).toContain("users(")
    expect(columnas).toContain("nombre")
    expect(columnas).toContain("organizations(")
    expect(from.order).toHaveBeenCalledWith("created_at", { ascending: false })
  })

  it("?estado=PENDIENTE filtra por ese estado", async () => {
    const from = createChainMock([])
    mockSupabaseFrom({ android_beta_testers: from })
    await GET(req("http://localhost/api/superadmin/beta-android?estado=PENDIENTE"))
    expect(from.eq).toHaveBeenCalledWith("estado", "PENDIENTE")
  })

  it.each(["", "TODOS"])("estado %j no filtra", async (estado) => {
    const from = createChainMock([])
    mockSupabaseFrom({ android_beta_testers: from })
    await GET(req(`http://localhost/api/superadmin/beta-android?estado=${estado}`))
    expect(from.eq).not.toHaveBeenCalled()
  })

  it("estado desconocido: 400", async () => {
    const from = createChainMock([])
    mockSupabaseFrom({ android_beta_testers: from })
    const res = await GET(req("http://localhost/api/superadmin/beta-android?estado=HACKEADO"))
    expect(res.status).toBe(400)
    expect(from.select).not.toHaveBeenCalled()
  })

  it("si falla la base responde 500", async () => {
    mockSupabaseFrom({ android_beta_testers: createChainMock(null, { message: "boom" }) })
    expect((await GET(req("http://localhost/api/superadmin/beta-android"))).status).toBe(500)
  })

  it("tolera un usuario o taller que vino null (no revienta la lista)", async () => {
    mockSupabaseFrom({
      android_beta_testers: createChainMock([{ ...FILAS[0], users: null, organizations: null }]),
    })
    const { status, body } = await parseResponse(await GET(req("http://localhost/api/superadmin/beta-android")))
    expect(status).toBe(200)
    expect(body.testers[0].usuario).toBeNull()
    expect(body.testers[0].taller).toBeNull()
  })
})

describe("PATCH /api/superadmin/beta-android", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, "error").mockImplementation(() => {})
    requireSuperadmin.mockResolvedValue(OK)
  })

  it("AGREGADO en lote: setea estado y agregado_at sobre exactamente esos ids, y audita", async () => {
    const from = createChainMock([{ id: "b1" }, { id: "b2" }])
    mockSupabaseFrom({ android_beta_testers: from })
    const antes = Date.now()
    const { status, body } = await parseResponse(await PATCH(patch({ ids: ["b1", "b2"], estado: "AGREGADO" })))
    expect(status).toBe(200)
    expect(body).toEqual({ actualizados: 2 })
    const cambios = from.update.mock.calls[0][0] as Record<string, any>
    expect(cambios.estado).toBe("AGREGADO")
    expect(new Date(cambios.agregado_at).getTime()).toBeGreaterThanOrEqual(antes - 1000)
    expect(from.in).toHaveBeenCalledWith("id", ["b1", "b2"])
    expect(createSuperadminAuditLogger).toHaveBeenCalledWith("admin@stapp.com.ar", expect.anything())
    expect(betaAndroidUpdate).toHaveBeenCalledWith(["b1", "b2"], "AGREGADO")
  })

  it.each(["DESCARTADO", "PENDIENTE"])("%s limpia agregado_at", async (estado) => {
    const from = createChainMock([{ id: "b1" }])
    mockSupabaseFrom({ android_beta_testers: from })
    await PATCH(patch({ ids: ["b1"], estado }))
    expect(from.update.mock.calls[0][0]).toEqual({ estado, agregado_at: null })
  })

  it.each([
    ["sin ids", { estado: "AGREGADO" }],
    ["ids vacio", { ids: [], estado: "AGREGADO" }],
    ["id vacio", { ids: [""], estado: "AGREGADO" }],
    ["estado desconocido", { ids: ["b1"], estado: "BORRADO" }],
    ["sin estado", { ids: ["b1"] }],
  ])("%s: 400 y no escribe", async (_nombre, body) => {
    const from = createChainMock([])
    mockSupabaseFrom({ android_beta_testers: from })
    expect((await PATCH(patch(body))).status).toBe(400)
    expect(from.update).not.toHaveBeenCalled()
    expect(betaAndroidUpdate).not.toHaveBeenCalled()
  })

  it("acepta hasta 200 ids por lote", async () => {
    const ids = Array.from({ length: 200 }, (_, i) => `b${i}`)
    mockSupabaseFrom({ android_beta_testers: createChainMock(ids.map((id) => ({ id }))) })
    const { status, body } = await parseResponse(await PATCH(patch({ ids, estado: "AGREGADO" })))
    expect(status).toBe(200)
    expect(body).toEqual({ actualizados: 200 })
  })

  it("mas de 200 ids: 400 y no escribe (el .in() viaja en la URL de PostgREST)", async () => {
    const ids = Array.from({ length: 201 }, (_, i) => `b${i}`)
    const from = createChainMock([])
    mockSupabaseFrom({ android_beta_testers: from })
    expect((await PATCH(patch({ ids, estado: "AGREGADO" }))).status).toBe(400)
    expect(from.update).not.toHaveBeenCalled()
    expect(betaAndroidUpdate).not.toHaveBeenCalled()
  })

  it("si falla la base responde 500 y no audita", async () => {
    mockSupabaseFrom({ android_beta_testers: createChainMock(null, { message: "boom" }) })
    expect((await PATCH(patch({ ids: ["b1"], estado: "AGREGADO" }))).status).toBe(500)
    expect(betaAndroidUpdate).not.toHaveBeenCalled()
  })
})

describe("GET /api/superadmin/beta-android/stats", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, "error").mockImplementation(() => {})
    requireSuperadmin.mockResolvedValue(OK)
  })

  it("cuenta solo los PENDIENTE", async () => {
    const from = createChainMock(null, null, 7)
    mockSupabaseFrom({ android_beta_testers: from })
    const { status, body } = await parseResponse(await GET_STATS())
    expect(status).toBe(200)
    expect(body).toEqual({ pendientes: 7 })
    expect(from.eq).toHaveBeenCalledWith("estado", "PENDIENTE")
  })

  it("si falla la base responde 500", async () => {
    mockSupabaseFrom({ android_beta_testers: createChainMock(null, { message: "boom" }) })
    expect((await GET_STATS()).status).toBe(500)
  })
})
