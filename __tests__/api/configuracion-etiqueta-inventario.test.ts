import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { mockAuthSuccess, mockAuthError, mockSupabaseFrom, createChainMock, parseResponse } from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"
import { GET, PATCH } from "@/app/api/configuracion/etiqueta-inventario/route"
import { LABEL_SIZE_CONFIG } from "@/lib/labels/build-labels-html"

function patchReq(body: unknown) {
  return new Request("http://localhost:3000/api/configuracion/etiqueta-inventario", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  })
}

const COLUMNAS = "etiqueta_inventario_medio, etiqueta_inventario_tamano"

describe("GET /api/configuracion/etiqueta-inventario", () => {
  beforeEach(() => vi.clearAllMocks())

  it("devuelve medio y tamaño de la org y selecciona SOLO esas dos columnas", async () => {
    mockAuthSuccess({ role: "VENDEDOR", organizationId: "org-9" })
    const chain = createChainMock({ etiqueta_inventario_medio: "sheet", etiqueta_inventario_tamano: "40x30" })
    mockSupabaseFrom({ organizations: chain })

    const { status, body } = await parseResponse(await GET())

    expect(status).toBe(200)
    expect(body).toEqual({ medio: "sheet", tamano: "40x30" })
    expect(chain.select).toHaveBeenCalledWith(COLUMNAS)
    expect(chain.eq).toHaveBeenCalledWith("id", "org-9")
  })

  it("NULL en la base significa sin configurar", async () => {
    mockAuthSuccess({ role: "TECNICO" })
    mockSupabaseFrom({
      organizations: createChainMock({ etiqueta_inventario_medio: null, etiqueta_inventario_tamano: null }),
    })
    expect((await parseResponse(await GET())).body).toEqual({ medio: null, tamano: null })
  })

  it("valores fuera de la whitelist se tratan como sin configurar", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({
      organizations: createChainMock({ etiqueta_inventario_medio: "laser", etiqueta_inventario_tamano: "99x99" }),
    })
    expect((await parseResponse(await GET())).body).toEqual({ medio: null, tamano: null })
  })

  it("una combinación inválida (hoja + rollo) se trata como sin configurar", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({
      organizations: createChainMock({ etiqueta_inventario_medio: "sheet", etiqueta_inventario_tamano: "58mm" }),
    })
    expect((await parseResponse(await GET())).body).toEqual({ medio: null, tamano: null })
  })

  it.each([
    ["42703", { code: "42703", message: "column does not exist" }],
    ["PGRST204", { code: "PGRST204", message: "Could not find the column" }],
  ])("con la migración sin aplicar (%s) devuelve nulls en vez de 500", async (_n, err) => {
    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({ organizations: createChainMock(null, err) })

    const { status, body } = await parseResponse(await GET())

    expect(status).toBe(200)
    expect(body).toEqual({ medio: null, tamano: null })
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

describe("PATCH /api/configuracion/etiqueta-inventario", () => {
  beforeEach(() => vi.clearAllMocks())

  it.each(["ADMIN", "VENDEDOR", "TECNICO"])("%s puede guardar medio y tamaño de su org", async (role) => {
    mockAuthSuccess({ role, organizationId: "org-1" })
    const chain = createChainMock({ id: "org-1" })
    mockSupabaseFrom({ organizations: chain })

    const { status, body } = await parseResponse(await PATCH(patchReq({ medio: "thermal", tamano: "58mm" })))

    expect(status).toBe(200)
    expect(body).toEqual({ medio: "thermal", tamano: "58mm" })
    expect(chain.update).toHaveBeenCalledWith({
      etiqueta_inventario_medio: "thermal",
      etiqueta_inventario_tamano: "58mm",
    })
  })

  it("escribe solo en la org de la sesión, aunque el body traiga otra", async () => {
    mockAuthSuccess({ role: "VENDEDOR", organizationId: "org-A" })
    const chain = createChainMock({ id: "org-A" })
    mockSupabaseFrom({ organizations: chain })

    await PATCH(patchReq({ medio: "sheet", tamano: "40x30", organizationId: "org-B", id: "org-B" }))

    expect(chain.eq).toHaveBeenCalledWith("id", "org-A")
    expect(chain.eq).not.toHaveBeenCalledWith("id", "org-B")
  })

  it("un rol desconocido recibe 403 y no escribe", async () => {
    mockAuthSuccess({ role: "INVITADO" })
    const chain = createChainMock({ id: "org-1" })
    mockSupabaseFrom({ organizations: chain })

    expect((await PATCH(patchReq({ medio: "thermal", tamano: "50x30" }))).status).toBe(403)
    expect(chain.update).not.toHaveBeenCalled()
  })

  it.each([
    [{ medio: "laser", tamano: "50x30" }],
    [{ medio: "", tamano: "50x30" }],
    [{ medio: null, tamano: "50x30" }],
    [{ tamano: "50x30" }],
    [{ medio: "thermal", tamano: "99x99" }],
    [{ medio: "thermal", tamano: "" }],
    [{ medio: "thermal", tamano: null }],
    [{ medio: "thermal" }],
    [{ medio: "sheet", tamano: "58mm" }],
    [{ medio: "sheet", tamano: "80mm" }],
  ])("rechaza con 400 el body inválido %j", async (payload) => {
    mockAuthSuccess({ role: "ADMIN" })
    const chain = createChainMock({ id: "org-1" })
    mockSupabaseFrom({ organizations: chain })

    expect((await PATCH(patchReq(payload))).status).toBe(400)
    expect(chain.update).not.toHaveBeenCalled()
  })

  it("rechaza con 400 un body que no es JSON", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    expect((await PATCH(patchReq("{no-json"))).status).toBe(400)
  })

  it.each([
    ["42703", { code: "42703", message: "column does not exist" }],
    ["PGRST204", { code: "PGRST204", message: "Could not find the column" }],
  ])("con la migración sin aplicar (%s) responde 503 claro, no 500", async (_n, err) => {
    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({ organizations: createChainMock(null, err) })

    const { status, body } = await parseResponse(await PATCH(patchReq({ medio: "thermal", tamano: "50x30" })))

    expect(status).toBe(503)
    expect(body.code).toBe("COLUMNA_NO_DISPONIBLE")
  })

  it("un error de base cualquiera responde 500", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({ organizations: createChainMock(null, { code: "57P01", message: "boom" }) })
    expect((await PATCH(patchReq({ medio: "thermal", tamano: "50x30" }))).status).toBe(500)
  })

  it("sin sesión responde 401 y no toca la base", async () => {
    mockAuthError()
    expect((await PATCH(patchReq({ medio: "thermal", tamano: "50x30" }))).status).toBe(401)
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })
})

describe("migración de etiqueta_inventario_*", () => {
  const dir = path.join(process.cwd(), "supabase", "migrations")
  const file = readdirSync(dir).find((f) => /etiqueta_inventario/.test(f))

  function valoresDelCheck(sql: string, columna: string): string[] {
    const re = new RegExp(`CHECK\\s*\\(\\s*${columna}\\s+IS NULL OR ${columna}\\s+IN\\s*\\(([^)]*)\\)`, "i")
    const lista = sql.match(re)?.[1] ?? ""
    return [...lista.matchAll(/'([^']+)'/g)].map((m) => m[1])
  }

  it("el CHECK del tamaño coincide exactamente con LABEL_SIZE_CONFIG", () => {
    expect(file, "falta la migración de etiqueta_inventario").toBeDefined()
    const sql = readFileSync(path.join(dir, file!), "utf8")
    expect(valoresDelCheck(sql, "etiqueta_inventario_tamano").sort()).toEqual(
      Object.keys(LABEL_SIZE_CONFIG).sort(),
    )
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS etiqueta_inventario_tamano text/i)
  })

  it("el CHECK del medio coincide exactamente con PrintMedium", () => {
    expect(file, "falta la migración de etiqueta_inventario").toBeDefined()
    const sql = readFileSync(path.join(dir, file!), "utf8")
    expect(valoresDelCheck(sql, "etiqueta_inventario_medio").sort()).toEqual(["sheet", "thermal"])
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS etiqueta_inventario_medio text/i)
  })
})
