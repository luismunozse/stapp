import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, parseResponse, createPostRequest } from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

import { POST } from "@/app/api/notas-credito/route"

function setup(movInsertPayloads: any[]) {
  vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { id: "nc1", numero: "NC-0001" }, error: null } as any)
  vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
    if (table === "ventas") return createChainMock({ id: "v1", total: "500", sucursal_id: "suc-1" }) as any
    if (table === "sesiones_caja") return createChainMock({ id: "ses-1" }) as any
    if (table === "movimientos_caja") {
      return {
        insert: vi.fn().mockImplementation((payload: any) => {
          movInsertPayloads.push(payload)
          return Promise.resolve({ data: null, error: null })
        }),
      } as any
    }
    return createChainMock(null) as any
  })
}

const body = (metodoDevolucion: string) => ({
  ventaId: "v1",
  motivo: "DEVOLUCION",
  monto: 500,
  metodoDevolucion,
})

describe("nota de crédito — egreso de caja en reembolso EFECTIVO (arqueo parte b)", () => {
  beforeEach(() => vi.clearAllMocks())

  it("NC en EFECTIVO genera un movimiento_caja EGRESO por el monto", async () => {
    const payloads: any[] = []
    mockAuthSuccess({ role: "ADMIN" })
    setup(payloads)

    const res = await POST(createPostRequest(body("EFECTIVO"), "http://localhost/api/notas-credito"))
    expect((await parseResponse(res)).status).toBe(201)

    expect(payloads).toHaveLength(1)
    expect(payloads[0]).toMatchObject({
      tipo: "EGRESO",
      monto: 500,
      metodo_pago: "EFECTIVO",
      sucursal_id: "suc-1",
      afecta_rentabilidad: false,
    })
  })

  it("NC en TRANSFERENCIA NO genera egreso de caja", async () => {
    const payloads: any[] = []
    mockAuthSuccess({ role: "ADMIN" })
    setup(payloads)

    await POST(createPostRequest(body("TRANSFERENCIA"), "http://localhost/api/notas-credito"))

    expect(payloads).toHaveLength(0)
  })
})
