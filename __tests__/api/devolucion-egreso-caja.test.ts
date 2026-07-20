import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, parseResponse, createPostRequest } from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

vi.mock("@/lib/counters", () => ({
  getNextReturnNumber: vi.fn().mockResolvedValue("DEV-000001"),
}))
vi.mock("@/lib/audit", () => ({
  createAuditLogger: vi.fn(() => ({ create: vi.fn().mockResolvedValue(undefined) })),
}))

import { POST } from "@/app/api/ventas/[id]/devolucion/route"

const createParams = (id: string) => ({ params: Promise.resolve({ id }) })
const RPC_SUCCESS = { id: "d1", tipo: "PARCIAL", montoDevolucion: 900 }
const DEV_COMPLETA = { id: "d1", venta_id: "v1", monto_devolucion: "900", items_devolucion: [] }

function setup(movInsertPayloads: any[]) {
  vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: RPC_SUCCESS, error: null } as any)
  vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
    if (table === "ventas") return createChainMock({ id: "v1", sucursal_id: "suc-1" }) as any
    if (table === "devoluciones_venta") return createChainMock(DEV_COMPLETA) as any
    if (table === "sesiones_caja") return createChainMock({ id: "ses-1" }) as any
    if (table === "movimientos_caja") {
      const chain: any = {
        insert: vi.fn().mockImplementation((payload: any) => {
          movInsertPayloads.push(payload)
          return Promise.resolve({ data: null, error: null })
        }),
      }
      return chain
    }
    return createChainMock(null) as any
  })
}

const bodyCon = (metodoReembolso: string) => ({
  motivo: "Defectuoso",
  metodoReembolso,
  items: [{ itemVentaId: "iv1", cantidad: 2, precioUnitario: 10, restaurarStock: false }],
})

describe("devolución — egreso de caja en reembolso EFECTIVO (arqueo parte b)", () => {
  beforeEach(() => vi.clearAllMocks())

  it("reembolso EFECTIVO genera un movimiento_caja EGRESO por el monto devuelto", async () => {
    const payloads: any[] = []
    mockAuthSuccess({ role: "ADMIN" })
    setup(payloads)

    const res = await POST(
      createPostRequest(bodyCon("EFECTIVO"), "http://localhost/api/ventas/v1/devolucion"),
      createParams("v1")
    )
    expect((await parseResponse(res)).status).toBe(201)

    expect(payloads).toHaveLength(1)
    expect(payloads[0]).toMatchObject({
      tipo: "EGRESO",
      monto: 900,
      metodo_pago: "EFECTIVO",
      sucursal_id: "suc-1",
      afecta_rentabilidad: false,
    })
  })

  it("reembolso CUENTA_CORRIENTE NO genera egreso de caja (no es efectivo)", async () => {
    const payloads: any[] = []
    mockAuthSuccess({ role: "ADMIN" })
    setup(payloads)

    await POST(
      createPostRequest(bodyCon("CUENTA_CORRIENTE"), "http://localhost/api/ventas/v1/devolucion"),
      createParams("v1")
    )

    expect(payloads).toHaveLength(0)
  })
})
