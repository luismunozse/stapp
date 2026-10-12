import { describe, it, expect, vi, beforeEach } from "vitest"
import { auth } from "@/lib/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { createChainMock, mockAuthError, parseResponse } from "./helpers"
import { requirePosAccess } from "@/lib/auth-utils"

/**
 * El POS estaba cerrado al TECNICO por rol, y la única salida era cambiarle el
 * rol a VENDEDOR — un canje, no una suma: al dejar de ser TECNICO desaparecía
 * de la lista de asignables a órdenes (`/api/tecnicos` filtra por rol), perdía
 * "Mi desempeño" y sus comisiones de reparación.
 *
 * `tecnicos_operan_pos` es el mismo patrón opt-in por organización que ya usa
 * `vendedores_administran_inventario`: default apagado, lo prende el ADMIN, y
 * NO toca el rol del usuario.
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

function mockOrgFlag(tecnicosOperanPos: boolean | null, error: any = null) {
  vi.mocked(supabaseAdmin.from).mockImplementation(
    (() =>
      createChainMock(
        tecnicosOperanPos === null ? null : { tecnicos_operan_pos: tecnicosOperanPos },
        error,
      )) as any,
  )
}

describe("requirePosAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOrgFlag(false)
  })

  it("rechaza 401 sin sesión", async () => {
    mockAuthError()

    const { error } = await requirePosAccess()

    expect(error?.status).toBe(401)
  })

  it("ADMIN pasa, y sin pagar la lectura del flag", async () => {
    mockRole("ADMIN")

    const { error, role } = await requirePosAccess()

    expect(error).toBeNull()
    expect(role).toBe("ADMIN")
    expect(organizationsReads()).toBe(0)
  })

  it("VENDEDOR pasa, y sin pagar la lectura del flag: vender ES su rol", async () => {
    mockRole("VENDEDOR")

    const { error, role } = await requirePosAccess()

    expect(error).toBeNull()
    expect(role).toBe("VENDEDOR")
    expect(organizationsReads()).toBe(0)
  })

  it("TECNICO pasa con el flag de la org prendido", async () => {
    mockRole("TECNICO", "tecnico-1")
    mockOrgFlag(true)

    const { error, role, userId } = await requirePosAccess()

    expect(error).toBeNull()
    expect(role).toBe("TECNICO")
    expect(userId).toBe("tecnico-1")
  })

  it("TECNICO recibe 403 con el flag apagado", async () => {
    mockRole("TECNICO", "tecnico-1")
    mockOrgFlag(false)

    const { error } = await requirePosAccess()

    expect(error?.status).toBe(403)
    expect((await parseResponse(error!)).body.error).toBe("Acceso denegado")
  })

  it("TECNICO recibe 403 si el flag no se puede leer: fail-closed", async () => {
    mockRole("TECNICO", "tecnico-1")
    // La columna todavía no existe (migración sin aplicar): en este proyecto
    // las migraciones se corren A MANO después del merge, así que siempre hay
    // una ventana en la que el deploy va adelante de su migración. Ahí el
    // técnico queda como estaba: afuera. Nunca adentro por accidente.
    mockOrgFlag(null, { code: "42703", message: "column does not exist" })

    const { error } = await requirePosAccess()

    expect(error?.status).toBe(403)
  })

  it("un rol desconocido no entra ni con el flag prendido", async () => {
    mockRole("GERENTE")
    mockOrgFlag(true)

    const { error } = await requirePosAccess()

    expect(error?.status).toBe(403)
  })
})
