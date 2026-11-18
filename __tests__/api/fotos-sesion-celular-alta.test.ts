// @vitest-environment node
// Enlace temporal para sacar fotos con el celular durante el alta de una orden:
// la sesión no tiene orden y solo la puede leer quien la creó.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextResponse } from "next/server"

const requireAuth = vi.fn()
vi.mock("@/lib/auth-utils", () => ({ requireAuth: () => requireAuth() }))

// Doble mínimo de PostgREST: registra cada consulta con sus filtros.
type Consulta = { tabla: string; op: string; valores?: unknown; filtros: [string, string, unknown][] }
const consultas: Consulta[] = []
let respuestas: Record<string, unknown[]> = {}
function from(tabla: string) {
  const c: Consulta = { tabla, op: "select", filtros: [] }
  consultas.push(c)
  const resultado = () => {
    const cola = respuestas[`${tabla}.${c.op}`] ?? []
    return (cola.length > 1 ? cola.shift() : cola[0]) ?? { data: null, error: null }
  }
  const q: Record<string, unknown> = {}
  for (const op of ["select", "insert", "update", "delete"]) {
    q[op] = (valores?: unknown) => {
      if (op !== "select" || c.op === "select") {
        if (op !== "select") {
          c.op = op
          c.valores = valores
        }
      }
      return q
    }
  }
  for (const f of ["eq", "is", "lt"]) {
    q[f] = (col: string, val: unknown) => {
      c.filtros.push([f, col, val])
      return q
    }
  }
  q.order = () => q
  q.limit = () => q
  q.single = async () => resultado()
  q.maybeSingle = async () => resultado()
  q.then = (ok: (v: unknown) => unknown) => Promise.resolve(resultado()).then(ok)
  return q
}
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: { from: (t: string) => from(t) } }))

import { POST, GET, DELETE } from "@/app/api/fotos/sesion-celular/route"
import { hashTokenCarga, esTokenCargaValido } from "@/lib/fotos/carga-sesion"

const SESION = {
  id: "s1", fotos_subidas: 1, max_fotos: 30,
  expires_at: new Date(Date.now() + 60_000).toISOString(), revoked_at: null,
}
const req = (qs = "", method = "GET") => new Request(`http://x/api/fotos/sesion-celular${qs}`, { method })
const de = (tabla: string, op: string) => consultas.filter((c) => c.tabla === tabla && c.op === op)

beforeEach(() => {
  consultas.length = 0
  respuestas = {}
  requireAuth.mockReset().mockResolvedValue({ error: null, organizationId: "org1", userId: "u1" })
})

describe("POST /api/fotos/sesion-celular", () => {
  it("sin sesión iniciada no crea nada", async () => {
    requireAuth.mockResolvedValueOnce({ error: NextResponse.json({ error: "No autorizado" }, { status: 401 }) })
    const res = await POST()
    expect(res.status).toBe(401)
    expect(consultas).toHaveLength(0)
  })

  it("crea una sesión sin orden, de quien la pide, y guarda solo el hash del token", async () => {
    respuestas["foto_carga_sesiones.insert"] = [{ data: { id: "s1" }, error: null }]
    const res = await POST()
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(esTokenCargaValido(body.token)).toBe(true)

    const [alta] = de("foto_carga_sesiones", "insert")
    expect(alta.valores).toMatchObject({
      organization_id: "org1",
      orden_id: null,
      created_by: "u1",
      tipo: "INGRESO",
      token_hash: hashTokenCarga(body.token),
    })
    expect(JSON.stringify(alta.valores)).not.toContain(body.token)
  })

  it("de paso borra las sesiones viejas, solo de su organización", async () => {
    respuestas["foto_carga_sesiones.insert"] = [{ data: { id: "s1" }, error: null }]
    await POST()
    const [limpieza] = de("foto_carga_sesiones", "delete")
    expect(limpieza.filtros).toContainEqual(["eq", "organization_id", "org1"])
    expect(limpieza.filtros.some(([f, col]) => f === "lt" && col === "expires_at")).toBe(true)
  })
})

describe("GET /api/fotos/sesion-celular", () => {
  it("busca la sesión acotada a la organización, al usuario y a las que no tienen orden", async () => {
    respuestas["foto_carga_sesiones.select"] = [{ data: null }]
    const res = await GET(req("?sesion=s1"))
    expect(res.status).toBe(404)
    const [lectura] = de("foto_carga_sesiones", "select")
    expect(lectura.filtros).toEqual(
      expect.arrayContaining([
        ["eq", "id", "s1"],
        ["eq", "organization_id", "org1"],
        ["eq", "created_by", "u1"],
        ["is", "orden_id", null],
      ])
    )
    // Sin sesión propia no se toca ninguna foto en tránsito.
    expect(consultas.filter((c) => c.tabla === "foto_carga_pendientes")).toHaveLength(0)
  })

  it("devuelve el estado y la foto en tránsito más vieja", async () => {
    respuestas["foto_carga_sesiones.select"] = [{ data: SESION }]
    respuestas["foto_carga_pendientes.select"] = [
      { data: [{ id: "p1", mime: "image/jpeg", data: "AAAA" }], count: 3 },
    ]
    const body = await (await GET(req("?sesion=s1"))).json()
    expect(body).toMatchObject({
      fotosSubidas: 1,
      activa: true,
      pendientes: 3,
      foto: { id: "p1", mime: "image/jpeg", data: "AAAA" },
    })
    expect(de("foto_carga_pendientes", "delete")).toHaveLength(0)
  })

  it("`recibida` borra esa foto, y solo dentro de la sesión propia", async () => {
    respuestas["foto_carga_sesiones.select"] = [{ data: SESION }]
    respuestas["foto_carga_pendientes.select"] = [{ data: [], count: 0 }]
    const body = await (await GET(req("?sesion=s1&recibida=p1"))).json()
    const [borrado] = de("foto_carga_pendientes", "delete")
    expect(borrado.filtros).toEqual([["eq", "id", "p1"], ["eq", "sesion_id", "s1"]])
    expect(body.foto).toBeNull()
  })

  it("400 sin el parámetro sesion", async () => {
    expect((await GET(req())).status).toBe(400)
  })
})

describe("DELETE /api/fotos/sesion-celular", () => {
  it("revoca la sesión propia y descarta lo que quedó en tránsito", async () => {
    respuestas["foto_carga_sesiones.select"] = [{ data: SESION }]
    const res = await DELETE(req("?sesion=s1", "DELETE"))
    expect(res.status).toBe(200)
    const [revocada] = de("foto_carga_sesiones", "update")
    expect(revocada.valores).toHaveProperty("revoked_at")
    expect(de("foto_carga_pendientes", "delete")[0].filtros).toEqual([["eq", "sesion_id", "s1"]])
  })

  it("no toca nada si la sesión es de otro usuario u organización", async () => {
    respuestas["foto_carga_sesiones.select"] = [{ data: null }]
    await DELETE(req("?sesion=ajena", "DELETE"))
    expect(de("foto_carga_sesiones", "update")).toHaveLength(0)
    expect(de("foto_carga_pendientes", "delete")).toHaveLength(0)
  })
})
