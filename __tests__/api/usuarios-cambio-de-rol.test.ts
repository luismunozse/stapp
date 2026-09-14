// @vitest-environment node
/**
 * PATCH /api/usuarios/[id]/rol — cambio de rol por el ADMIN del taller.
 *
 * Hasta acá el rol se fijaba al crear el usuario y no habia forma de moverlo:
 * `/api/tecnicos` y `/api/vendedores` insertan un literal y sus PUT ni
 * siquiera aceptan el campo. Lo unico que existia era
 * `/api/superadmin/users/[userId]/change-role`, que es herramienta de
 * plataforma y no la ve ningun taller.
 *
 * Este endpoint es su equivalente para el ADMIN de la organizacion, y tiene
 * cuatro guards que el de superadmin no necesita porque un superadmin opera
 * desde afuera:
 *
 *   1. No cambiarse el rol a uno mismo: te quedas sin acceso en el acto y sin
 *      forma de volver.
 *   2. No dejar la organizacion sin ADMIN: degradar al ultimo deja al taller
 *      sin nadie que entre a Configuracion.
 *   3. El % de comision se re-confirma al entrar a un rol que cobra comision.
 *      `users.porcentaje_comision` es UNA sola columna compartida entre la
 *      comision de reparacion del tecnico y la de venta del vendedor
 *      (122_comisiones_vendedores.sql:6), asi que un 15% de reparacion se
 *      convierte solo en un 15% sobre ventas si nadie lo mira.
 *   4. Al usuario tocado se le corta el refresh token, para que su sesion no
 *      se siga extendiendo con el rol viejo.
 *
 * Y el que comparte con el de superadmin: reconciliar `sucursal_id`, o el
 * CHECK de la 241 (`rol = 'ADMIN' OR sucursal_id IS NOT NULL`) rebota.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, parseResponse } from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

vi.mock("@/lib/sucursal", () => ({
  getPrincipalId: vi.fn().mockResolvedValue("suc-principal"),
}))

vi.mock("@/lib/plan-limits", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/lib/plan-limits")
  return { ...actual, enforcePlanLimit: vi.fn().mockResolvedValue(null) }
})

import { invalidateRefreshToken } from "@/lib/auth"
import { enforcePlanLimit } from "@/lib/plan-limits"

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

function patchJson(id: string, body: unknown): Request {
  return new Request(`http://localhost/api/usuarios/${id}/rol`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

function usuario(overrides: Record<string, any> = {}) {
  return {
    id: "u-2",
    nombre: "Juan",
    email: "juan@taller.test",
    rol: "TECNICO",
    organization_id: "org-1",
    sucursal_id: "suc-A",
    porcentaje_comision: 15,
    ...overrides,
  }
}

/**
 * Arma los mocks de supabase para un cambio de rol.
 *
 * `adminsRestantes` es lo que devuelve el conteo de ADMIN que quedarian: solo
 * se consulta cuando se esta degradando a un ADMIN.
 */
function mockDb(target: Record<string, any>, opts: { adminsRestantes?: number; updateError?: any } = {}) {
  const updateChain = createChainMock(null, opts.updateError ?? null)
  const usersChain: any = createChainMock(target)
  usersChain.update = vi.fn().mockReturnValue(updateChain)
  // El conteo de admins usa `count`, no `.single()`.
  usersChain.select = vi.fn((_cols: string, o?: { count?: string }) => {
    if (o?.count) {
      const c: any = createChainMock(null, null, opts.adminsRestantes ?? 2)
      return c
    }
    return usersChain
  })

  const auditChain = createChainMock(null)
  vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
    if (table === "users") return usersChain as any
    if (table === "audit_logs") return auditChain as any
    return createChainMock(null) as any
  })
  return { usersChain, updateChain, auditChain }
}

describe("PATCH /api/usuarios/[id]/rol", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1", userId: "u-admin" })
    vi.mocked(enforcePlanLimit).mockResolvedValue(null)
  })

  it("cambia el rol y persiste el % de comisión confirmado", async () => {
    const { usersChain } = mockDb(usuario())

    const { PATCH } = await import("@/app/api/usuarios/[id]/rol/route")
    const { status } = await parseResponse(
      (await PATCH(patchJson("u-2", { rol: "VENDEDOR", porcentajeComision: 5 }), ctx("u-2"))) as Response,
    )

    expect(status).toBe(200)
    const payload = usersChain.update.mock.calls[0][0]
    expect(payload.rol).toBe("VENDEDOR")
    // El 15 de reparación NO se arrastra a la comisión de venta.
    expect(payload.porcentaje_comision).toBe(5)
  })

  it("le corta el refresh token al usuario tocado, no al admin que ejecuta", async () => {
    mockDb(usuario())

    const { PATCH } = await import("@/app/api/usuarios/[id]/rol/route")
    await PATCH(patchJson("u-2", { rol: "VENDEDOR", porcentajeComision: 5 }), ctx("u-2"))

    expect(vi.mocked(invalidateRefreshToken)).toHaveBeenCalledWith("u-2")
    expect(vi.mocked(invalidateRefreshToken)).not.toHaveBeenCalledWith("u-admin")
  })

  it("exige el % de comisión al entrar a un rol que la cobra", async () => {
    mockDb(usuario())

    const { PATCH } = await import("@/app/api/usuarios/[id]/rol/route")
    const { status, body } = await parseResponse(
      (await PATCH(patchJson("u-2", { rol: "VENDEDOR" }), ctx("u-2"))) as Response,
    )

    expect(status).toBe(400)
    expect(body.error).toMatch(/comisi/i)
  })

  it("NO exige el % al pasar a ADMIN, que no cobra comisión", async () => {
    const { usersChain } = mockDb(usuario())

    const { PATCH } = await import("@/app/api/usuarios/[id]/rol/route")
    const { status } = await parseResponse(
      (await PATCH(patchJson("u-2", { rol: "ADMIN" }), ctx("u-2"))) as Response,
    )

    expect(status).toBe(200)
    const payload = usersChain.update.mock.calls[0][0]
    expect(payload).not.toHaveProperty("porcentaje_comision")
  })

  it("no deja que el admin se cambie el rol a sí mismo", async () => {
    const { usersChain } = mockDb(usuario({ id: "u-admin", rol: "ADMIN" }))

    const { PATCH } = await import("@/app/api/usuarios/[id]/rol/route")
    const { status, body } = await parseResponse(
      (await PATCH(patchJson("u-admin", { rol: "TECNICO", porcentajeComision: 10 }), ctx("u-admin"))) as Response,
    )

    expect(status).toBe(400)
    expect(body.error).toMatch(/vos mismo|tu propio/i)
    expect(usersChain.update).not.toHaveBeenCalled()
  })

  it("no deja degradar al último ADMIN de la organización", async () => {
    // El objetivo es ADMIN y no queda ningún otro: el taller se quedaría sin
    // nadie que pueda entrar a Configuración, ni a esta misma pantalla.
    const { usersChain } = mockDb(usuario({ id: "u-2", rol: "ADMIN", sucursal_id: null }), {
      adminsRestantes: 0,
    })

    const { PATCH } = await import("@/app/api/usuarios/[id]/rol/route")
    const { status, body } = await parseResponse(
      (await PATCH(patchJson("u-2", { rol: "TECNICO", porcentajeComision: 10 }), ctx("u-2"))) as Response,
    )

    expect(status).toBe(400)
    expect(body.error).toMatch(/único administrador|ultimo administrador/i)
    expect(usersChain.update).not.toHaveBeenCalled()
  })

  it("sí deja degradar a un ADMIN cuando queda otro", async () => {
    const { usersChain } = mockDb(usuario({ id: "u-2", rol: "ADMIN", sucursal_id: null }), {
      adminsRestantes: 1,
    })

    const { PATCH } = await import("@/app/api/usuarios/[id]/rol/route")
    const { status } = await parseResponse(
      (await PATCH(patchJson("u-2", { rol: "TECNICO", porcentajeComision: 10 }), ctx("u-2"))) as Response,
    )

    expect(status).toBe(200)
    // Sale de ADMIN sin sucursal: hay que backfillear o rebota el CHECK de la 241.
    expect(usersChain.update.mock.calls[0][0].sucursal_id).toBe("suc-principal")
  })

  it("al promover a ADMIN limpia la sucursal", async () => {
    const { usersChain } = mockDb(usuario())

    const { PATCH } = await import("@/app/api/usuarios/[id]/rol/route")
    await PATCH(patchJson("u-2", { rol: "ADMIN" }), ctx("u-2"))

    expect(usersChain.update.mock.calls[0][0].sucursal_id).toBeNull()
  })

  it("rechaza a un usuario de OTRA organización con 404", async () => {
    const { usersChain } = mockDb(usuario({ organization_id: "org-ajena" }))

    const { PATCH } = await import("@/app/api/usuarios/[id]/rol/route")
    const { status } = await parseResponse(
      (await PATCH(patchJson("u-2", { rol: "VENDEDOR", porcentajeComision: 5 }), ctx("u-2"))) as Response,
    )

    expect(status).toBe(404)
    expect(usersChain.update).not.toHaveBeenCalled()
  })

  it("rechaza el no-op: ya tiene ese rol", async () => {
    const { usersChain } = mockDb(usuario({ rol: "VENDEDOR" }))

    const { PATCH } = await import("@/app/api/usuarios/[id]/rol/route")
    const { status } = await parseResponse(
      (await PATCH(patchJson("u-2", { rol: "VENDEDOR", porcentajeComision: 5 }), ctx("u-2"))) as Response,
    )

    expect(status).toBe(400)
    expect(usersChain.update).not.toHaveBeenCalled()
  })

  it("frena la promoción que excede el cupo del plan, antes de tocar la fila", async () => {
    const { usersChain } = mockDb(usuario({ rol: "VENDEDOR" }))
    vi.mocked(enforcePlanLimit).mockResolvedValue(
      new Response(JSON.stringify({ code: "PLAN_LIMIT_EXCEEDED" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }) as any,
    )

    const { PATCH } = await import("@/app/api/usuarios/[id]/rol/route")
    const { status } = await parseResponse(
      (await PATCH(patchJson("u-2", { rol: "TECNICO", porcentajeComision: 10 }), ctx("u-2"))) as Response,
    )

    expect(status).toBe(403)
    expect(usersChain.update).not.toHaveBeenCalled()
  })

  it("el límite que levanta el trigger sale como 403 con motivo, no como 500", async () => {
    // Backstop atómico de la migración 323: entre el pre-chequeo y el UPDATE
    // puede entrar otra alta. El trigger es el que decide de verdad.
    mockDb(usuario({ rol: "VENDEDOR" }), {
      updateError: { code: "P0001", message: "PLAN_LIMIT_EXCEEDED:tecnicos:2:1", details: null, hint: null },
    })

    const { PATCH } = await import("@/app/api/usuarios/[id]/rol/route")
    const { status, body } = await parseResponse(
      (await PATCH(patchJson("u-2", { rol: "TECNICO", porcentajeComision: 10 }), ctx("u-2"))) as Response,
    )

    expect(status).toBe(403)
    expect(body.code).toBe("PLAN_LIMIT_EXCEEDED")
  })

  it("solo el ADMIN entra", async () => {
    mockAuthSuccess({ role: "VENDEDOR", organizationId: "org-1", userId: "u-v" })
    const { usersChain } = mockDb(usuario())

    const { PATCH } = await import("@/app/api/usuarios/[id]/rol/route")
    const { status } = await parseResponse(
      (await PATCH(patchJson("u-2", { rol: "TECNICO", porcentajeComision: 10 }), ctx("u-2"))) as Response,
    )

    expect(status).toBe(403)
    expect(usersChain.update).not.toHaveBeenCalled()
  })
})

describe("GET /api/usuarios — el equipo de la organización", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1", userId: "u-admin" })
  })

  it("devuelve a todos los roles juntos, acotado a la organización", async () => {
    const chain = createChainMock([
      usuario({ id: "u-1", nombre: "Ana", rol: "ADMIN", sucursal_id: null }),
      usuario({ id: "u-2", nombre: "Juan", rol: "TECNICO" }),
      usuario({ id: "u-3", nombre: "Eva", rol: "VENDEDOR" }),
    ])
    vi.mocked(supabaseAdmin.from).mockImplementation(() => chain as any)

    const { GET } = await import("@/app/api/usuarios/route")
    const { status, body } = await parseResponse((await GET()) as Response)

    expect(status).toBe(200)
    expect(body.map((u: any) => u.rol)).toEqual(["ADMIN", "TECNICO", "VENDEDOR"])
    expect(chain.eq).toHaveBeenCalledWith("organization_id", "org-1")
  })

  it("no publica password ni refresh_token", async () => {
    // El SELECT es explícito y nunca `*`, justamente para que agregar una
    // columna sensible a `users` mañana no la publique sola.
    const chain = createChainMock([
      { ...usuario(), password: "hash-secreto", refresh_token: "rt-secreto" },
    ])
    vi.mocked(supabaseAdmin.from).mockImplementation(() => chain as any)

    const { GET } = await import("@/app/api/usuarios/route")
    const { body } = await parseResponse((await GET()) as Response)

    expect(body[0]).not.toHaveProperty("password")
    expect(body[0]).not.toHaveProperty("refresh_token")
    const cols = chain.select.mock.calls[0][0] as string
    expect(cols).not.toContain("*")
    expect(cols).not.toContain("password")
  })

  it("solo el ADMIN entra", async () => {
    mockAuthSuccess({ role: "TECNICO", organizationId: "org-1", userId: "u-t" })
    vi.mocked(supabaseAdmin.from).mockImplementation(() => createChainMock([]) as any)

    const { GET } = await import("@/app/api/usuarios/route")
    const { status } = await parseResponse((await GET()) as Response)

    expect(status).toBe(403)
  })
})
