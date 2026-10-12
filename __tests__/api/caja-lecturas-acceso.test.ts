import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/caja-utils", () => ({
  fetchMovimientosDia: vi.fn().mockResolvedValue([]),
  computeTotales: vi.fn().mockReturnValue({
    totalIngresos: 0,
    totalEgresos: 0,
    totalIngresosEfectivo: 0,
    totalEgresosEfectivo: 0,
    totalCostosFinancieros: 0,
    totalDia: 0,
    porMetodo: {},
    porTipo: {},
    ingresoReal: 0,
  }),
}))

import { auth } from "@/lib/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { createChainMock, createGetRequest, parseResponse } from "./helpers"

/**
 * Las LECTURAS de caja eran todas `requireAuth`: cualquier rol autenticado que
 * escribiera /caja en la URL —o pegara directo a la API— veía los totales del
 * día de la organización y el historial de cierres. El navbar mostraba el
 * módulo solo al ADMIN, pero eso es decoración, no un permiso.
 *
 * El corte queda así:
 *   - resumen del día        -> requireCajaAccess (quien opera la caja)
 *   - sesión abierta actual  -> requirePosAccess  (el POS la necesita)
 *   - historial de cierres   -> requireAdmin      (histórico financiero)
 *   - detalle de un cierre   -> requireAdmin      (idem)
 */

function mockRole(role: string, sucursalId: string | null = "suc-1") {
  vi.mocked(auth).mockResolvedValue({
    user: { id: "user-1", organizationId: "org-1", role, sucursalId, email: "u@u.com" },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } as any)
}

/** La org contesta con los dos flags y la zona horaria que piden los handlers. */
function mockOrg(flags: Record<string, any> = {}) {
  vi.mocked(supabaseAdmin.from).mockImplementation(
    ((tabla: string) => {
      if (tabla === "organizations") {
        return createChainMock({
          zona_horaria: "America/Argentina/Buenos_Aires",
          vendedores_manejan_caja: false,
          tecnicos_operan_pos: false,
          ...flags,
        })
      }
      return createChainMock(null)
    }) as any,
  )
}

async function statusDe(promesa: Promise<Response>) {
  return (await parseResponse(await promesa)).status
}

describe("GET /api/caja — resumen del día", () => {
  beforeEach(() => vi.clearAllMocks())

  it("el VENDEDOR sin el permiso no ve los totales de la organización", async () => {
    mockRole("VENDEDOR")
    mockOrg({ vendedores_manejan_caja: false })

    const { GET } = await import("@/app/api/caja/route")

    expect(await statusDe(GET(createGetRequest("http://localhost/api/caja")) as any)).toBe(403)
  })

  it("el VENDEDOR con el permiso sí los ve", async () => {
    mockRole("VENDEDOR")
    mockOrg({ vendedores_manejan_caja: true })

    const { GET } = await import("@/app/api/caja/route")

    expect(await statusDe(GET(createGetRequest("http://localhost/api/caja")) as any)).toBe(200)
  })

  it("el TECNICO queda afuera aunque opere el POS", async () => {
    // Vender no es arquear: `tecnicos_operan_pos` no abre la caja.
    mockRole("TECNICO")
    mockOrg({ tecnicos_operan_pos: true, vendedores_manejan_caja: true })

    const { GET } = await import("@/app/api/caja/route")

    expect(await statusDe(GET(createGetRequest("http://localhost/api/caja")) as any)).toBe(403)
  })

  it("el ADMIN entra sin depender de ningún flag", async () => {
    mockRole("ADMIN", null)
    mockOrg({ vendedores_manejan_caja: false })

    const { GET } = await import("@/app/api/caja/route")

    expect(await statusDe(GET(createGetRequest("http://localhost/api/caja")) as any)).toBe(200)
  })
})

describe("GET /api/caja/sesiones?current=true — sesión abierta", () => {
  beforeEach(() => vi.clearAllMocks())

  const url = "http://localhost/api/caja/sesiones?current=true"

  it("el VENDEDOR la lee aunque NO maneje la caja: el POS la necesita", async () => {
    // pos-terminal.tsx pega acá para enganchar la venta a la sesión abierta.
    // Cerrarla con el permiso de caja dejaría al vendedor sin poder vender.
    mockRole("VENDEDOR")
    mockOrg({ vendedores_manejan_caja: false })

    const { GET } = await import("@/app/api/caja/sesiones/route")

    expect(await statusDe(GET(createGetRequest(url)) as any)).toBe(200)
  })

  it("el TECNICO habilitado en el POS también", async () => {
    mockRole("TECNICO")
    mockOrg({ tecnicos_operan_pos: true })

    const { GET } = await import("@/app/api/caja/sesiones/route")

    expect(await statusDe(GET(createGetRequest(url)) as any)).toBe(200)
  })

  it("el TECNICO sin el POS habilitado no", async () => {
    mockRole("TECNICO")
    mockOrg({ tecnicos_operan_pos: false })

    const { GET } = await import("@/app/api/caja/sesiones/route")

    expect(await statusDe(GET(createGetRequest(url)) as any)).toBe(403)
  })
})

describe("GET /api/caja/sesiones — historial de cierres", () => {
  beforeEach(() => vi.clearAllMocks())

  const url = "http://localhost/api/caja/sesiones"

  it("el VENDEDOR no lo ve ni con el permiso de caja prendido", async () => {
    // El vendedor opera SU turno; el histórico financiero de la organización
    // es del dueño. Mismo corte que el export CSV.
    mockRole("VENDEDOR")
    mockOrg({ vendedores_manejan_caja: true })

    const { GET } = await import("@/app/api/caja/sesiones/route")

    expect(await statusDe(GET(createGetRequest(url)) as any)).toBe(403)
  })

  it("el TECNICO tampoco", async () => {
    mockRole("TECNICO")
    mockOrg({ tecnicos_operan_pos: true })

    const { GET } = await import("@/app/api/caja/sesiones/route")

    expect(await statusDe(GET(createGetRequest(url)) as any)).toBe(403)
  })

  it("el ADMIN sí", async () => {
    mockRole("ADMIN", null)
    mockOrg()

    const { GET } = await import("@/app/api/caja/sesiones/route")

    expect(await statusDe(GET(createGetRequest(url)) as any)).toBe(200)
  })
})

describe("GET /api/caja/sesiones/[id] — detalle de un cierre", () => {
  beforeEach(() => vi.clearAllMocks())

  const params = { params: Promise.resolve({ id: "ses-1" }) }

  it("el VENDEDOR no lo ve ni con el permiso de caja prendido", async () => {
    mockRole("VENDEDOR")
    mockOrg({ vendedores_manejan_caja: true })

    const { GET } = await import("@/app/api/caja/sesiones/[id]/route")

    expect(
      await statusDe(GET(createGetRequest("http://localhost/api/caja/sesiones/ses-1"), {
        params: Promise.resolve({ id: "ses-1" }),
      }) as any),
    ).toBe(403)
  })

  it("el ADMIN sí llega al handler (la sesión inexistente da 404, no 403)", async () => {
    mockRole("ADMIN", null)
    mockOrg()

    const { GET } = await import("@/app/api/caja/sesiones/[id]/route")

    expect(
      await statusDe(GET(createGetRequest("http://localhost/api/caja/sesiones/ses-1"), params) as any),
    ).toBe(404)
  })
})
