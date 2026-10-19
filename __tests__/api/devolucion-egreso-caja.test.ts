import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, parseResponse, createPostRequest } from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

vi.mock("@/lib/audit", () => ({
  createAuditLogger: vi.fn(() => ({ create: vi.fn().mockResolvedValue(undefined) })),
}))

import { POST } from "@/app/api/ventas/[id]/devolucion/route"

const createParams = (id: string) => ({ params: Promise.resolve({ id }) })
const RPC_SUCCESS = { id: "d1", numero: "NC-000001", tipo: "PARCIAL", montoDevolucion: 900, montoReembolso: 900, movimientoCajaId: "mov-1" }
const DEV_COMPLETA = { id: "d1", venta_id: "v1", monto_devolucion: "900", items_devolucion: [] }

function setup(tablas: string[]) {
  vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: RPC_SUCCESS, error: null } as any)
  vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
    tablas.push(table)
    if (table === "ventas") return createChainMock({ id: "v1", sucursal_id: "suc-1", cliente_id: "c1" }) as any
    if (table === "devoluciones_venta") return createChainMock(DEV_COMPLETA) as any
    return createChainMock(null) as any
  })
}

const bodyCon = (metodoReembolso: string) => ({
  motivo: "Defectuoso",
  metodoReembolso,
  items: [{ itemVentaId: "iv1", cantidad: 2, precioUnitario: 10, restaurarStock: false }],
})

// Desde la mig 367 el egreso de efectivo va adentro de la RPC, en la misma
// transacción que la NC (probes 8-12 de la 365). La ruta solo lo pide.
describe("devolución — el egreso de caja lo hace la RPC", () => {
  beforeEach(() => vi.clearAllMocks())

  it.each(["EFECTIVO", "CUENTA_CORRIENTE"])("con %s pide el egreso a la RPC y no escribe en la caja", async (metodo) => {
    const tablas: string[] = []
    mockAuthSuccess({ role: "ADMIN" })
    setup(tablas)

    const res = await POST(
      createPostRequest(bodyCon(metodo), "http://localhost/api/ventas/v1/devolucion"),
      createParams("v1")
    )
    expect((await parseResponse(res)).status).toBe(201)

    expect(vi.mocked(supabaseAdmin.rpc).mock.calls[0][1]).toMatchObject({
      p_registrar_egreso: true,
      p_metodo_reembolso: metodo,
    })
    expect(tablas).not.toContain("movimientos_caja")
    expect(tablas).not.toContain("sesiones_caja")
  })
})
