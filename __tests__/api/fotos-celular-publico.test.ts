// @vitest-environment node
// Subida de fotos desde el celular con enlace temporal (sin login): el token es
// la única credencial y el cupo se reserva antes de subir y se devuelve si falla.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextResponse } from "next/server"

const rpc = vi.fn()
const maybeSingle = vi.fn()
const insert = vi.fn()
vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    rpc: (...a: unknown[]) => rpc(...a),
    from: (tabla: string) => ({
      select: () => ({ eq: () => ({ maybeSingle }) }),
      insert: (fila: unknown) => insert(tabla, fila),
    }),
  },
}))
const enforcePlanLimit = vi.fn()
vi.mock("@/lib/plan-limits", () => ({ enforcePlanLimit: (...a: unknown[]) => enforcePlanLimit(...a) }))
const guardarFotoOrden = vi.fn()
vi.mock("@/lib/fotos/guardar-foto-orden", () => ({
  guardarFotoOrden: (...a: unknown[]) => guardarFotoOrden(...a),
}))

import { GET, POST } from "@/app/api/public/fotos-celular/[token]/route"
import { generarTokenCarga, hashTokenCarga, esTokenCargaValido } from "@/lib/fotos/carga-sesion"

const token = generarTokenCarga()
const ctx = (t = token) => ({ params: Promise.resolve({ token: t }) })
const post = (body: unknown, t = token) =>
  POST(new Request("http://x/api/public/fotos-celular/t", { method: "POST", body: JSON.stringify(body) }), ctx(t))
const SESION = { id: "s1", organization_id: "org1", orden_id: "ord1", tipo: "DIAGNOSTICO" }
const FOTO = { mime: "image/jpeg", data: "AAAA" }

beforeEach(() => {
  rpc.mockReset()
  maybeSingle.mockReset()
  guardarFotoOrden.mockReset()
  insert.mockReset().mockResolvedValue({ error: null })
  enforcePlanLimit.mockReset().mockResolvedValue(null)
})

describe("token de carga", () => {
  it("es de 256 bits en base64url y se guarda hasheado", () => {
    expect(esTokenCargaValido(token)).toBe(true)
    expect(hashTokenCarga(token)).toMatch(/^[0-9a-f]{64}$/)
    expect(hashTokenCarga(token)).not.toContain(token)
    expect(generarTokenCarga()).not.toBe(token)
  })
})

describe("POST /api/public/fotos-celular/[token]", () => {
  it("sube la foto a la orden y con el tipo de la sesión, no los que mande el cliente", async () => {
    rpc.mockResolvedValueOnce({ data: [SESION], error: null })
    guardarFotoOrden.mockResolvedValueOnce({ foto: { id: "f1", url: "secreta" } })

    const res = await post({ ...FOTO, tipo: "ENTREGA", ordenId: "otra", organizationId: "otra" })

    expect(res.status).toBe(201)
    expect(rpc).toHaveBeenCalledWith("reservar_foto_carga_sesion", { p_token_hash: hashTokenCarga(token) })
    expect(guardarFotoOrden).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org1", ordenId: "ord1", tipo: "DIAGNOSTICO", mime: "image/jpeg" })
    )
    // El enlace solo sirve para subir: no devuelve la foto ni su URL.
    expect(await res.json()).toEqual({ ok: true })
  })

  it("rechaza con 404 si la sesión venció, fue revocada o no tiene cupo (la reserva no devuelve filas)", async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null })
    const res = await post(FOTO)
    expect(res.status).toBe(404)
    expect(guardarFotoOrden).not.toHaveBeenCalled()
  })

  it("ni consulta la base con un token mal formado", async () => {
    const res = await post(FOTO, "abc")
    expect(res.status).toBe(404)
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each(["image/svg+xml", "text/html", "application/pdf"])("no acepta %s y no gasta cupo", async (mime) => {
    const res = await post({ mime, data: "AAAA" })
    expect(res.status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it("devuelve el cupo si el plan rechaza la foto", async () => {
    rpc.mockResolvedValueOnce({ data: [SESION], error: null }).mockResolvedValueOnce({ error: null })
    guardarFotoOrden.mockResolvedValueOnce({
      error: NextResponse.json({ error: "Límite de almacenamiento" }, { status: 403 }),
    })
    const res = await post(FOTO)
    expect(res.status).toBe(403)
    expect(rpc).toHaveBeenLastCalledWith("liberar_foto_carga_sesion", { p_sesion_id: "s1" })
    expect(rpc).toHaveBeenCalledTimes(2)
  })

  it("devuelve el cupo si la subida explota", async () => {
    rpc.mockResolvedValueOnce({ data: [SESION], error: null }).mockResolvedValueOnce({ error: null })
    guardarFotoOrden.mockRejectedValueOnce(new Error("storage caído"))
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const res = await post(FOTO)
    errorSpy.mockRestore()
    expect(res.status).toBe(500)
    expect(rpc).toHaveBeenLastCalledWith("liberar_foto_carga_sesion", { p_sesion_id: "s1" })
  })
})

describe("POST con una sesión sin orden (orden nueva)", () => {
  const SIN_ORDEN = { ...SESION, orden_id: null, tipo: "INGRESO" }

  it("deja la foto en tránsito y no escribe en fotos_orden", async () => {
    rpc.mockResolvedValueOnce({ data: [SIN_ORDEN], error: null })
    const res = await post(FOTO)
    expect(res.status).toBe(201)
    expect(insert).toHaveBeenCalledWith("foto_carga_pendientes", {
      sesion_id: "s1",
      mime: "image/jpeg",
      data: "AAAA",
    })
    expect(guardarFotoOrden).not.toHaveBeenCalled()
  })

  it("respeta el límite de almacenamiento del plan y devuelve el cupo", async () => {
    rpc.mockResolvedValueOnce({ data: [SIN_ORDEN], error: null }).mockResolvedValueOnce({ error: null })
    enforcePlanLimit.mockResolvedValueOnce(NextResponse.json({ error: "Límite" }, { status: 403 }))
    const res = await post(FOTO)
    expect(res.status).toBe(403)
    expect(insert).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenLastCalledWith("liberar_foto_carga_sesion", { p_sesion_id: "s1" })
  })

  it("devuelve el cupo si no se pudo guardar la foto en tránsito", async () => {
    rpc.mockResolvedValueOnce({ data: [SIN_ORDEN], error: null }).mockResolvedValueOnce({ error: null })
    insert.mockResolvedValueOnce({ error: new Error("db caída") })
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const res = await post(FOTO)
    errorSpy.mockRestore()
    expect(res.status).toBe(500)
    expect(rpc).toHaveBeenLastCalledWith("liberar_foto_carga_sesion", { p_sesion_id: "s1" })
  })

  it("rechaza imágenes de más de 5MB sin gastar cupo", async () => {
    const res = await post({ mime: "image/jpeg", data: "A".repeat(7_100_000) })
    expect(res.status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe("GET /api/public/fotos-celular/[token]", () => {
  const fila = (extra: Record<string, unknown> = {}) => ({
    fotos_subidas: 2,
    max_fotos: 30,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    revoked_at: null,
    ordenes_servicio: { codigo_orden: "OS-12", dispositivo: "Notebook", cliente_id: "c1" },
    organizations: { nombre: "Taller", nombre_mostrar: "Taller SRL" },
    ...extra,
  })
  const get = () => GET(new Request("http://x"), ctx())

  it("devuelve solo lo mínimo para la pantalla del celular", async () => {
    maybeSingle.mockResolvedValueOnce({ data: fila() })
    const res = await get()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({
      orden: { codigo: "OS-12", dispositivo: "Notebook" },
      organizacion: "Taller SRL",
      expiresAt: expect.any(String),
      fotosSubidas: 2,
      maxFotos: 30,
    })
  })

  it("orden nueva: orden viene en null", async () => {
    maybeSingle.mockResolvedValueOnce({ data: fila({ ordenes_servicio: null }) })
    const body = await (await get()).json()
    expect(body.orden).toBeNull()
  })

  it.each([
    ["vencida", { expires_at: new Date(Date.now() - 1000).toISOString() }],
    ["revocada", { revoked_at: new Date().toISOString() }],
  ])("404 si la sesión está %s", async (_n, extra) => {
    maybeSingle.mockResolvedValueOnce({ data: fila(extra) })
    expect((await get()).status).toBe(404)
  })

  it("404 si el token no existe", async () => {
    maybeSingle.mockResolvedValueOnce({ data: null })
    expect((await get()).status).toBe(404)
  })
})
