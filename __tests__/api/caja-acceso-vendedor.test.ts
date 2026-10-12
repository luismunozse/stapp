import { describe, it, expect, vi, beforeEach } from "vitest"
import { auth } from "@/lib/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { createChainMock, mockAuthError, parseResponse } from "./helpers"
import { requireCajaAccess } from "@/lib/auth-utils"

/**
 * La operativa de caja estaba cerrada al VENDEDOR por rol: abrir el turno,
 * cerrarlo con arqueo y cargar un movimiento manual eran todos requireAdmin().
 * En un local con un solo dueño eso significa que nadie puede arrancar el día
 * sin él.
 *
 * `vendedores_manejan_caja` es el mismo patrón opt-in por organización que ya
 * usan `vendedores_administran_inventario` (275) y `tecnicos_operan_pos` (314):
 * default apagado, lo prende el ADMIN, y NO toca el rol del usuario.
 *
 * Alcance deliberadamente parcial: el vendedor opera SU turno. El histórico
 * financiero —export CSV e historial de cierres— sigue siendo del ADMIN.
 */

function mockRole(role: string, userId = "user-1") {
  vi.mocked(auth).mockResolvedValue({
    user: { id: userId, organizationId: "org-1", role, sucursalId: "suc-1", email: "u@u.com" },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } as any)
}

function organizationsReads() {
  return vi.mocked(supabaseAdmin.from).mock.calls.filter(([t]) => t === "organizations").length
}

function mockOrgFlag(vendedoresManejanCaja: boolean | null, error: any = null) {
  vi.mocked(supabaseAdmin.from).mockImplementation(
    (() =>
      createChainMock(
        vendedoresManejanCaja === null
          ? null
          : { vendedores_manejan_caja: vendedoresManejanCaja },
        error,
      )) as any,
  )
}

describe("requireCajaAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOrgFlag(false)
  })

  it("rechaza 401 sin sesión", async () => {
    mockAuthError()

    const { error } = await requireCajaAccess()

    expect(error?.status).toBe(401)
  })

  it("ADMIN pasa, y sin pagar la lectura del flag", async () => {
    mockRole("ADMIN")

    const { error, role } = await requireCajaAccess()

    expect(error).toBeNull()
    expect(role).toBe("ADMIN")
    expect(organizationsReads()).toBe(0)
  })

  it("VENDEDOR pasa con el flag de la org prendido", async () => {
    mockRole("VENDEDOR", "vendedor-1")
    mockOrgFlag(true)

    const { error, role, userId } = await requireCajaAccess()

    expect(error).toBeNull()
    expect(role).toBe("VENDEDOR")
    expect(userId).toBe("vendedor-1")
  })

  it("VENDEDOR recibe 403 con el flag apagado", async () => {
    mockRole("VENDEDOR", "vendedor-1")
    mockOrgFlag(false)

    const { error } = await requireCajaAccess()

    expect(error?.status).toBe(403)
    expect((await parseResponse(error!)).body.error).toBe("Acceso denegado")
  })

  it("VENDEDOR recibe 403 si el flag no se puede leer: fail-closed", async () => {
    mockRole("VENDEDOR", "vendedor-1")
    // La columna todavía no existe (migración sin aplicar): en este proyecto
    // las migraciones se corren A MANO después del merge, así que siempre hay
    // una ventana en la que el deploy va adelante de su migración. Ahí el
    // vendedor queda como estaba: afuera. Nunca adentro por accidente.
    mockOrgFlag(null, { code: "42703", message: "column does not exist" })

    const { error } = await requireCajaAccess()

    expect(error?.status).toBe(403)
  })

  it("expone el flag resuelto para el handler que lo necesite", async () => {
    mockRole("VENDEDOR", "vendedor-1")
    mockOrgFlag(true)

    const { vendedoresManejanCaja } = await requireCajaAccess()

    expect(vendedoresManejanCaja).toBe(true)
  })

  it("TECNICO no entra ni con el flag prendido", async () => {
    // El permiso habilita al VENDEDOR y a nadie más. `tecnicos_operan_pos` lo
    // deja vender, que no es lo mismo que arquear la caja del local.
    mockRole("TECNICO", "tecnico-1")
    mockOrgFlag(true)

    const { error } = await requireCajaAccess()

    expect(error?.status).toBe(403)
  })

  it("un rol desconocido no entra ni con el flag prendido", async () => {
    mockRole("GERENTE")
    mockOrgFlag(true)

    const { error } = await requireCajaAccess()

    expect(error?.status).toBe(403)
  })
})
