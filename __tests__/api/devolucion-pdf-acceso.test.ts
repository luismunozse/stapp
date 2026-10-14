import { describe, it, expect, vi, beforeEach } from "vitest"
import { cookies } from "next/headers"
import { supabaseAdmin } from "@/lib/supabase"
import { mockAuthSuccess, mockAuthError, createChainMock, createGetRequest } from "./helpers"
import { GET } from "@/app/api/ventas/[id]/devolucion/[devolucionId]/pdf/route"

/**
 * Caracterización: vale antes Y después de pasar la ruta al generador nuevo.
 * Mocks por tabla, sin mockear módulos propios, para que la ruta vieja (que
 * lee `ventas` directo) y la nueva (que pasa por v_notas_credito) se prueben
 * con lo mismo.
 */
const params = { params: Promise.resolve({ id: "v-1", devolucionId: "nc-v" }) }
const get = () => GET(createGetRequest("http://localhost/api/ventas/v-1/devolucion/nc-v/pdf"), params)

function setup(opts: { tecnicosOperanPos?: boolean; venta?: unknown }) {
  vi.mocked(cookies).mockResolvedValue({ get: vi.fn(() => undefined), set: vi.fn() } as any)
  vi.mocked(supabaseAdmin.from).mockImplementation((t: string) => {
    if (t === "organizations") return createChainMock({ tecnicos_operan_pos: opts.tecnicosOperanPos ?? false }) as any
    if (t === "v_notas_credito") {
      return createChainMock({
        id: "nc-v", origen: "VENTA", origen_id: "v-1", origen_numero: "1", numero: "NC-000001",
        fecha: "2026-10-13T15:00:00+00:00", modo: "ITEMS", motivo_nc: null, detalle: "x", monto: "1",
        monto_aplicado_deuda: "0", monto_reembolso: "1", metodo: null, cliente_id: null,
        sucursal_id: null, organization_id: "org-1", user_id: null, anulada: false,
      }) as any
    }
    if (t === "ventas") return createChainMock(opts.venta ?? null) as any
    return createChainMock(null) as any
  })
}

describe("PDF de devolución — acceso (caracterización)", () => {
  beforeEach(() => vi.clearAllMocks())

  it("sin sesión responde 401", async () => {
    mockAuthError()
    expect((await get()).status).toBe(401)
  })

  it("el técnico sin permiso de POS recibe 403", async () => {
    mockAuthSuccess({ role: "TECNICO", sucursalId: "suc-1" })
    setup({ tecnicosOperanPos: false })
    expect((await get()).status).toBe(403)
  })

  it("una venta que el vendedor no ve (otra sucursal u otro vendedor) da 404", async () => {
    mockAuthSuccess({ role: "VENDEDOR", sucursalId: "suc-1" })
    setup({ venta: null })
    expect((await get()).status).toBe(404)
  })
})
