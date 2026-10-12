import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { mockAuthSuccess, mockAuthError, mockSupabaseFrom, createChainMock, parseResponse } from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"
import { GET, PATCH } from "@/app/api/configuracion/etiqueta/route"
import { LABEL_SIZES } from "@/lib/etiqueta-tamano"

function patchReq(body: unknown) {
  return new Request("http://localhost:3000/api/configuracion/etiqueta", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  })
}

describe("GET /api/configuracion/etiqueta", () => {
  beforeEach(() => vi.clearAllMocks())

  it("devuelve el tamaño configurado de la org y selecciona SOLO esa columna", async () => {
    mockAuthSuccess({ role: "VENDEDOR", organizationId: "org-9" })
    const chain = createChainMock({ etiqueta_tamano: "50x30" })
    mockSupabaseFrom({ organizations: chain })

    const { status, body } = await parseResponse(await GET())

    expect(status).toBe(200)
    expect(body).toEqual({ tamano: "50x30" })
    expect(chain.select).toHaveBeenCalledWith("etiqueta_tamano")
    expect(chain.eq).toHaveBeenCalledWith("id", "org-9")
  })

  it("NULL en la base significa sin configurar", async () => {
    mockAuthSuccess({ role: "TECNICO" })
    mockSupabaseFrom({ organizations: createChainMock({ etiqueta_tamano: null }) })
    expect((await parseResponse(await GET())).body).toEqual({ tamano: null })
  })

  it("un valor fuera de la whitelist se trata como sin configurar", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({ organizations: createChainMock({ etiqueta_tamano: "99x99" }) })
    expect((await parseResponse(await GET())).body).toEqual({ tamano: null })
  })

  it.each([
    ["42703", { code: "42703", message: 'column organizations.etiqueta_tamano does not exist' }],
    ["PGRST204", { code: "PGRST204", message: "Could not find the 'etiqueta_tamano' column" }],
  ])("con la migración sin aplicar (%s) devuelve null en vez de 500", async (_n, err) => {
    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({ organizations: createChainMock(null, err) })

    const { status, body } = await parseResponse(await GET())

    expect(status).toBe(200)
    expect(body).toEqual({ tamano: null })
  })

  it("un error de base que no es de columna faltante responde 500", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({ organizations: createChainMock(null, { code: "57P01", message: "boom" }) })
    expect((await GET()).status).toBe(500)
  })

  it("sin sesión responde 401", async () => {
    mockAuthError()
    expect((await GET()).status).toBe(401)
  })
})

describe("PATCH /api/configuracion/etiqueta", () => {
  beforeEach(() => vi.clearAllMocks())

  it.each(["ADMIN", "VENDEDOR", "TECNICO"])("%s puede guardar el tamaño de su org", async (role) => {
    mockAuthSuccess({ role, organizationId: "org-1" })
    const chain = createChainMock({ id: "org-1" })
    mockSupabaseFrom({ organizations: chain })

    const { status, body } = await parseResponse(await PATCH(patchReq({ tamano: "58mm" })))

    expect(status).toBe(200)
    expect(body).toEqual({ tamano: "58mm" })
    expect(chain.update).toHaveBeenCalledWith({ etiqueta_tamano: "58mm" })
  })

  it("escribe solo en la org de la sesión, aunque el body traiga otra", async () => {
    mockAuthSuccess({ role: "VENDEDOR", organizationId: "org-A" })
    const chain = createChainMock({ id: "org-A" })
    mockSupabaseFrom({ organizations: chain })

    await PATCH(patchReq({ tamano: "40x30", organizationId: "org-B", id: "org-B" }))

    expect(chain.eq).toHaveBeenCalledWith("id", "org-A")
    expect(chain.eq).not.toHaveBeenCalledWith("id", "org-B")
    expect(chain.update).toHaveBeenCalledWith({ etiqueta_tamano: "40x30" })
  })

  it("un rol desconocido recibe 403 y no escribe", async () => {
    mockAuthSuccess({ role: "INVITADO" })
    const chain = createChainMock({ id: "org-1" })
    mockSupabaseFrom({ organizations: chain })

    expect((await PATCH(patchReq({ tamano: "60x40" }))).status).toBe(403)
    expect(chain.update).not.toHaveBeenCalled()
  })

  it.each(["99x99", "", null, 60, undefined, "60X40"])("rechaza con 400 el valor inválido %j", async (tamano) => {
    mockAuthSuccess({ role: "ADMIN" })
    const chain = createChainMock({ id: "org-1" })
    mockSupabaseFrom({ organizations: chain })

    expect((await PATCH(patchReq({ tamano }))).status).toBe(400)
    expect(chain.update).not.toHaveBeenCalled()
  })

  it("rechaza con 400 un body que no es JSON", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    expect((await PATCH(patchReq("{no-json"))).status).toBe(400)
  })

  it.each([
    ["42703", { code: "42703", message: "column etiqueta_tamano does not exist" }],
    ["PGRST204", { code: "PGRST204", message: "Could not find the 'etiqueta_tamano' column" }],
  ])("con la migración sin aplicar (%s) responde 503 claro, no 500", async (_n, err) => {
    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({ organizations: createChainMock(null, err) })

    const { status, body } = await parseResponse(await PATCH(patchReq({ tamano: "60x40" })))

    expect(status).toBe(503)
    expect(body.code).toBe("COLUMNA_NO_DISPONIBLE")
  })

  it("un error de base cualquiera responde 500", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({ organizations: createChainMock(null, { code: "57P01", message: "boom" }) })
    expect((await PATCH(patchReq({ tamano: "60x40" }))).status).toBe(500)
  })

  it("sin sesión responde 401 y no toca la base", async () => {
    mockAuthError()
    expect((await PATCH(patchReq({ tamano: "60x40" }))).status).toBe(401)
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })
})

describe("migración de etiqueta_tamano", () => {
  it("el CHECK de la migración coincide exactamente con LABEL_SIZES", () => {
    const dir = path.join(process.cwd(), "supabase", "migrations")
    const file = readdirSync(dir).find((f) => /etiqueta_tamano/.test(f))
    expect(file, "falta la migración de etiqueta_tamano").toBeDefined()
    const sql = readFileSync(path.join(dir, file!), "utf8")
    const check = sql.match(/CHECK\s*\(([\s\S]*?)\)\s*;/i)?.[1] ?? ""
    const valores = [...check.matchAll(/'([^']+)'/g)].map((m) => m[1])
    expect([...valores].sort()).toEqual([...LABEL_SIZES].sort())
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS etiqueta_tamano text/i)
  })
})
