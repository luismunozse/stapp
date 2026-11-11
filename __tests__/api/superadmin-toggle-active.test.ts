// @vitest-environment node
/**
 * 394: "Desactivar usuario" bloquea el acceso de verdad (acceso_bloqueado_at +
 * revocar refresh tokens) en vez de tocar email_verified, y no se puede usar
 * contra un superadmin.
 */
import { describe, it, expect, vi } from "vitest"
import { parseResponse } from "./helpers"
import { montarSupabaseEnMemoria } from "../helpers/supabase-memoria"

vi.mock("@/lib/superadmin-auth", () => ({
  requireSuperadmin: vi.fn().mockResolvedValue({ error: null, email: "root@stapp.com.ar" }),
}))

import { POST } from "@/app/api/superadmin/users/[userId]/toggle-active/route"

const post = (userId: string, body: unknown) =>
  POST(
    new Request(`http://localhost/api/superadmin/users/${userId}/toggle-active`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ userId }) },
  )

const usuario = (extra: Record<string, unknown> = {}) => ({
  id: "u1",
  nombre: "Tec",
  email: "tec@taller.com",
  organization_id: "org-1",
  email_verified: true,
  acceso_bloqueado_at: null,
  acceso_bloqueado_por: null,
  es_superadmin: false,
  refresh_token: "x",
  refresh_token_expires: "2030-01-01",
  ...extra,
})

describe("POST /api/superadmin/users/[userId]/toggle-active", () => {
  it("bloquear setea fecha y autor, revoca los refresh tokens y no toca email_verified", async () => {
    const mem = montarSupabaseEnMemoria({
      users: [usuario(), usuario({ id: "u2", email: "otro@taller.com" })],
      refresh_tokens: [{ id: "rt1", user_id: "u1" }, { id: "rt2", user_id: "u2" }],
    })
    const { status } = await parseResponse(await post("u1", { activo: false }))
    expect(status).toBe(200)

    const [u1, u2] = mem.filas("users")
    expect(u1.acceso_bloqueado_at).toEqual(expect.any(String))
    expect(u1.acceso_bloqueado_por).toBe("root@stapp.com.ar")
    expect(u1.email_verified).toBe(true)
    expect(u1.refresh_token).toBeNull()
    expect(u2.acceso_bloqueado_at).toBeNull()
    expect(mem.filas("refresh_tokens").map((t) => t.id)).toEqual(["rt2"])

    const audit = mem.escrituras.find((e) => e.tabla === "audit_logs")
    expect(audit?.carga).toMatchObject({ entity_id: "u1", changes: { after: "bloqueado" } })
  })

  it("habilitar limpia el bloqueo y no revoca nada", async () => {
    const mem = montarSupabaseEnMemoria({
      users: [usuario({ acceso_bloqueado_at: "2026-11-01T00:00:00Z", acceso_bloqueado_por: "root@stapp.com.ar" })],
      refresh_tokens: [{ id: "rt1", user_id: "u1" }],
    })
    expect((await post("u1", { activo: true })).status).toBe(200)
    const [u1] = mem.filas("users")
    expect(u1.acceso_bloqueado_at).toBeNull()
    expect(u1.acceso_bloqueado_por).toBeNull()
    expect(mem.filas("refresh_tokens")).toHaveLength(1)
  })

  it("un superadmin no se bloquea desde el panel: 403 y nada escrito", async () => {
    const mem = montarSupabaseEnMemoria({ users: [usuario({ es_superadmin: true })] })
    const { status } = await parseResponse(await post("u1", { activo: false }))
    expect(status).toBe(403)
    expect(mem.escrituras).toEqual([])
  })

  it("usuario inexistente: 404 y nada escrito", async () => {
    const mem = montarSupabaseEnMemoria({ users: [] })
    expect((await post("nope", { activo: false })).status).toBe(404)
    expect(mem.escrituras).toEqual([])
  })
})
