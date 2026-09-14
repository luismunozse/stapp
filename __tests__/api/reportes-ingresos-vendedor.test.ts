// @vitest-environment node
/**
 * Permiso `vendedores_ven_ingresos` (migración 326) sobre los reportes de
 * ingresos.
 *
 * Es el primero de los permisos por organización que va al revés: los otros
 * cuatro AGREGAN algo que nadie tenía y nacen apagados; éste QUITA algo que
 * todos tienen y nace prendido. Casi todo lo que este archivo fija sale de esa
 * inversión, que es exactamente lo que alguien va a "corregir" de memoria
 * copiando el patrón de los otros:
 *
 *   - default prendido: sin tocar nada, el vendedor sigue viendo lo de siempre;
 *   - fail-OPEN: si la columna no existe todavía o la lectura falla, el
 *     vendedor VE. Negar ahí le sacaría los reportes a los vendedores de las
 *     223 organizaciones por una migración que aún no corrió;
 *   - sólo un `false` explícito cierra.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock, parseResponse } from "./helpers"

vi.mock("@/lib/sucursal", () => ({
  sucursalParaLectura: vi.fn().mockResolvedValue({ sucursalId: null, todas: true }),
  sucursalParaEscritura: vi.fn().mockResolvedValue("suc-1"),
  getPrincipalId: vi.fn().mockResolvedValue("suc-1"),
}))

/** Lo que devuelve la lectura del flag en `organizations`. */
function mockOrg(valor: boolean | null | undefined, error: any = null) {
  return createChainMock(
    valor === undefined ? null : { vendedores_ven_ingresos: valor },
    error,
  )
}

const RUTAS = [
  "ingresos",
  "ingresos-unificados",
  "comparativa-ingresos",
  "resumen-ingresos",
  "top-clientes",
] as const

function req() {
  return new Request("http://localhost/api/reportes/x?desde=2026-01-01&hasta=2026-12-31")
}

describe("reportes de ingresos — permiso del vendedor", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each(RUTAS)("%s: el VENDEDOR con el permiso apagado recibe 403", async (ruta) => {
    mockAuthSuccess({ role: "VENDEDOR", organizationId: "org-1", userId: "v-1" })
    mockSupabaseFrom({ organizations: mockOrg(false) })

    const { GET } = await import(`@/app/api/reportes/${ruta}/route`)
    const { status } = await parseResponse((await GET(req())) as Response)

    expect(status).toBe(403)
  })

  it.each(RUTAS)("%s: con el permiso prendido el VENDEDOR pasa el guard", async (ruta) => {
    mockAuthSuccess({ role: "VENDEDOR", organizationId: "org-1", userId: "v-1" })
    mockSupabaseFrom({ organizations: mockOrg(true) })

    const { GET } = await import(`@/app/api/reportes/${ruta}/route`)
    const { status } = await parseResponse((await GET(req())) as Response)

    expect(status).not.toBe(403)
  })

  it("con la migración 326 sin aplicar el VENDEDOR SIGUE VIENDO (fail-open)", async () => {
    // El punto entero de la inversión. Los otros permisos son fail-closed
    // porque negar deja las cosas como estaban; acá negar le sacaría los
    // reportes a todos los vendedores de todas las organizaciones por una
    // columna que todavía no existe.
    mockAuthSuccess({ role: "VENDEDOR", organizationId: "org-1", userId: "v-1" })
    mockSupabaseFrom({
      organizations: mockOrg(undefined, {
        code: "42703",
        message: 'column "vendedores_ven_ingresos" does not exist',
      }),
    })

    const { GET } = await import("@/app/api/reportes/ingresos/route")
    const { status } = await parseResponse((await GET(req())) as Response)

    expect(status).not.toBe(403)
  })

  it("una fila vieja con NULL tampoco cierra: nadie lo apagó", async () => {
    mockAuthSuccess({ role: "VENDEDOR", organizationId: "org-1", userId: "v-1" })
    mockSupabaseFrom({ organizations: mockOrg(null) })

    const { GET } = await import("@/app/api/reportes/ingresos/route")
    const { status } = await parseResponse((await GET(req())) as Response)

    expect(status).not.toBe(403)
  })

  it("el ADMIN entra aunque el permiso esté apagado, y no paga el round-trip", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1", userId: "a-1" })
    const orgChain = mockOrg(false)
    mockSupabaseFrom({ organizations: orgChain })

    const { GET } = await import("@/app/api/reportes/ingresos/route")
    const { status } = await parseResponse((await GET(req())) as Response)

    expect(status).not.toBe(403)
    expect(orgChain.select).not.toHaveBeenCalledWith("vendedores_ven_ingresos")
  })

  it("el TECNICO no entra ni con el permiso prendido", async () => {
    // El middleware ya lo frena en /reportes; el servidor lo dice igual.
    mockAuthSuccess({ role: "TECNICO", organizationId: "org-1", userId: "t-1" })
    mockSupabaseFrom({ organizations: mockOrg(true) })

    const { GET } = await import("@/app/api/reportes/ingresos/route")
    const { status } = await parseResponse((await GET(req())) as Response)

    expect(status).toBe(403)
  })
})

describe("reportes que NO quedan detrás del permiso", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Son operativos: qué produce cada técnico y cuántos equipos vuelven. El
  // vendedor los necesita para atender al cliente, y cortarlos sería cobrar el
  // permiso más caro de lo que se pidió. Mencionan "ingreso" en el payload, así
  // que es justo el error que alguien cometería barriendo por nombre.
  it.each(["performance-tecnicos", "tasa-retorno"])(
    "%s sigue abierto al VENDEDOR con el permiso apagado",
    async (ruta) => {
      mockAuthSuccess({ role: "VENDEDOR", organizationId: "org-1", userId: "v-1" })
      mockSupabaseFrom({ organizations: mockOrg(false) })

      const { GET } = await import(`@/app/api/reportes/${ruta}/route`)
      const { body } = await parseResponse((await GET(req())) as Response)

      // Se pregunta por el mensaje y no por el status: en estas rutas conviven
      // DOS 403 distintos. `tasa-retorno` tiene además un gate de plan
      // (`advanced_reports`), que contesta 403 con code FEATURE_REQUIRED y no
      // tiene nada que ver con este permiso. Mirar solo el status daría por
      // bueno un corte por rol que en realidad era comercial, y al revés.
      expect(body.error).not.toBe("Acceso denegado")
    },
  )
})
