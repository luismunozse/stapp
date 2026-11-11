/**
 * Los emails de SUPERADMIN_EMAILS quedan reservados. El acceso a admin.* se
 * decide por email: si un taller pudiera crear (o renombrar) un usuario propio
 * con uno de esos emails, con su contraseña y su 2FA, entraría al panel.
 * La respuesta es la misma que un duplicado, para no revelar cuáles son.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { mockAuthSuccess, createPostRequest, parseResponse } from "./helpers"

// Lo que corre antes de la validación del email no es lo que se prueba acá.
vi.mock("@/lib/plan-limits", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/plan-limits")>()),
  enforcePlanLimit: vi.fn().mockResolvedValue(null),
}))
import { montarSupabaseEnMemoria } from "../helpers/supabase-memoria"

import { POST as crearTecnico } from "@/app/api/tecnicos/route"
import { PUT as editarTecnico } from "@/app/api/tecnicos/[id]/route"
import { POST as crearVendedor } from "@/app/api/vendedores/route"
import { PUT as editarVendedor } from "@/app/api/vendedores/[id]/route"

const RESERVADO = "root@stapp.com.ar"
const T1 = "11111111-1111-4111-8111-111111111111"
const V1 = "22222222-2222-4222-8222-222222222222"

const usuarios = [
  { id: "user-1", organization_id: "org-1", rol: "ADMIN", email: "admin@taller.com", nombre: "Admin", sucursal_id: null, deleted_at: null },
  { id: T1, organization_id: "org-1", rol: "TECNICO", email: "tec@taller.com", nombre: "Tec", sucursal_id: null, deleted_at: null },
  { id: V1, organization_id: "org-1", rol: "VENDEDOR", email: "ven@taller.com", nombre: "Ven", sucursal_id: null, deleted_at: null },
]

const escriturasEnUsers = (mem: ReturnType<typeof montarSupabaseEnMemoria>) =>
  mem.escrituras.filter((e) => e.tabla === "users" && (e.operacion === "insert" || e.operacion === "update"))

describe("emails de superadmin reservados", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("SUPERADMIN_EMAILS", `otro@stapp.com.ar, ${RESERVADO.toUpperCase()}`)
    mockAuthSuccess({ role: "ADMIN" })
  })
  afterEach(() => vi.unstubAllEnvs())

  it.each([
    ["alta de técnico", () => crearTecnico(createPostRequest({ nombre: "X", email: ` ${RESERVADO.toUpperCase()} `, password: "Password123!" }))],
    ["alta de vendedor", () => crearVendedor(createPostRequest({ nombre: "X", email: RESERVADO, password: "Password123!" }))],
    ["renombrar técnico", () => editarTecnico(createPostRequest({ email: RESERVADO }), { params: Promise.resolve({ id: T1 }) })],
    ["renombrar vendedor", () => editarVendedor(createPostRequest({ email: RESERVADO }), { params: Promise.resolve({ id: V1 }) })],
  ])("%s con un email de superadmin: misma respuesta que un duplicado y nada se escribe", async (_caso, llamar) => {
    const mem = montarSupabaseEnMemoria({
      users: usuarios,
      organizations: [{ id: "org-1", activo: true }],
      sucursales: [{ id: "suc-1", organization_id: "org-1", principal: true, activa: true, deleted_at: null }],
    })
    const { status, body } = await parseResponse(await (llamar() as Promise<Response>))
    expect(status).toBe(400)
    expect(body.error).toBe("Ya existe un usuario con este email")
    expect(escriturasEnUsers(mem)).toEqual([])
  })

  it("renombrar a un email común sigue funcionando", async () => {
    const mem = montarSupabaseEnMemoria({
      users: usuarios,
      organizations: [{ id: "org-1", activo: true }],
      sucursales: [{ id: "suc-1", organization_id: "org-1", principal: true, activa: true, deleted_at: null }],
    })
    const res = await editarTecnico(createPostRequest({ email: "nuevo@taller.com" }), { params: Promise.resolve({ id: T1 }) })
    expect(res.status).toBe(200)
    expect(escriturasEnUsers(mem)).toHaveLength(1)
  })
})
