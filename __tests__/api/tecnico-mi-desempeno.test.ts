import { describe, it, expect, vi, beforeEach } from "vitest"
import { auth } from "@/lib/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { createChainMock, createGetRequest, mockAuthError, parseResponse } from "./helpers"
import { requireAdminOrSelf } from "@/lib/auth-utils"

/**
 * "Mi desempeño" del técnico.
 *
 * La pantalla estaba entera —`/tecnicos` redirige al técnico a su propia
 * ficha, la ficha calcula `canView`, y este guard cubre la API— pero muerta:
 * `/tecnicos` vivía en RUTAS_ADMIN, así que el middleware rebotaba al técnico
 * al panel antes de que corriera una sola línea.
 *
 * Al abrir la ruta en el middleware, `requireAdminOrSelf` pasa a ser el guard
 * que sostiene todo: es lo único que impide que un técnico lea la ficha —y las
 * comisiones— de un compañero cambiando el id en la URL. No tenía tests.
 */

function mockRole(role: string, userId: string) {
  vi.mocked(auth).mockResolvedValue({
    user: { id: userId, organizationId: "org-1", role, sucursalId: "suc-1", email: "u@u.com" },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } as any)
}

describe("requireAdminOrSelf", () => {
  beforeEach(() => vi.clearAllMocks())

  it("rechaza 401 sin sesión", async () => {
    mockAuthError()

    const { error } = await requireAdminOrSelf("tecnico-1")

    expect(error?.status).toBe(401)
  })

  it("el ADMIN pasa para cualquier id: la ficha ajena es su trabajo", async () => {
    mockRole("ADMIN", "admin-1")

    const { error, role } = await requireAdminOrSelf("tecnico-1")

    expect(error).toBeNull()
    expect(role).toBe("ADMIN")
  })

  it("el técnico pasa para su propio id", async () => {
    mockRole("TECNICO", "tecnico-1")

    const { error, userId } = await requireAdminOrSelf("tecnico-1")

    expect(error).toBeNull()
    expect(userId).toBe("tecnico-1")
  })

  it("el técnico NO pasa para el id de un compañero", async () => {
    // El caso que el middleware tapaba por accidente. Ahora que la ruta está
    // abierta, este 403 es lo único que separa "mi desempeño" de "el de todos".
    mockRole("TECNICO", "tecnico-1")

    const { error } = await requireAdminOrSelf("tecnico-2")

    expect(error?.status).toBe(403)
    expect((await parseResponse(error!)).body.error).toBe("Acceso denegado")
  })

  it("un rol desconocido tampoco pasa con un id ajeno", async () => {
    mockRole("GERENTE", "gerente-1")

    const { error } = await requireAdminOrSelf("tecnico-2")

    expect(error?.status).toBe(403)
  })
})

describe("GET /api/tecnicos/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(supabaseAdmin.from).mockImplementation(
      (() => createChainMock({ id: "tecnico-2", nombre: "Otro", rol: "TECNICO" })) as any,
    )
    ;(supabaseAdmin as any).rpc = vi.fn().mockResolvedValue({ data: [], error: null })
  })

  const pedir = async (id: string) => {
    const { GET } = await import("@/app/api/tecnicos/[id]/route")
    const res = await GET(createGetRequest(`http://localhost/api/tecnicos/${id}`), {
      params: Promise.resolve({ id }),
    })
    return (await parseResponse(res)).status
  }

  it("un técnico no lee la ficha de otro técnico", async () => {
    mockRole("TECNICO", "tecnico-1")

    expect(await pedir("tecnico-2")).toBe(403)
  })

  it("un vendedor no lee la ficha de un técnico", async () => {
    mockRole("VENDEDOR", "vendedor-1")

    expect(await pedir("tecnico-2")).toBe(403)
  })
})
