/**
 * Firma unica de POST /api/recepciones.
 *
 * La firma del cliente viaja una sola vez, al lote (recepcion), y no por
 * cada equipo. Este test fija ese contrato: si algun cambio futuro empieza
 * a mandar `firmaCliente` por equipo, este test debe fallar.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom, createPostRequest, parseResponse } from "./helpers"

vi.mock("@/lib/subscriptions", () => ({ hasPlanFeature: vi.fn().mockResolvedValue(true) }))
vi.mock("@/lib/plan-limits", () => ({
  enforcePlanLimit: vi.fn().mockResolvedValue(null),
  isPlanLimitError: vi.fn().mockReturnValue(false),
  planLimitErrorResponse: vi.fn(),
}))
vi.mock("@/lib/sucursal", () => ({ sucursalParaEscritura: vi.fn().mockResolvedValue("suc-1") }))
vi.mock("@/lib/operadores", () => ({ resolveOperador: vi.fn().mockResolvedValue("user-1") }))
vi.mock("@/lib/tipos-dispositivo-config", () => ({ tipoValidaImei: vi.fn().mockResolvedValue(false) }))
vi.mock("@/lib/audit", () => ({ createAuditLogger: () => ({ create: vi.fn().mockResolvedValue(undefined) }) }))

import { supabaseAdmin } from "@/lib/supabase"
import { POST } from "@/app/api/recepciones/route"

const body = {
  clienteId: "cli-1",
  terminosAceptados: true,
  firmaCliente: "data:image/png;base64,abc",
  firmaMime: "image/png",
  equipos: [
    { dispositivo: "iPhone 13", tipoDispositivo: "CELULAR", problemaReportado: "No enciende" },
    { dispositivo: "Notebook HP", tipoDispositivo: "COMPUTADORA", problemaReportado: "Muy lenta" },
  ],
}

const rpcOk = {
  recepcion: { id: "rec-1", numero: 1, codigo: "REC001" },
  ordenes: [
    { id: "ord-1", numeroOrden: 1, codigoOrden: "CEL001", dispositivo: "iPhone 13", publicToken: "aaa" },
    { id: "ord-2", numeroOrden: 2, codigoOrden: "PC002", dispositivo: "Notebook HP", publicToken: "bbb" },
  ],
}

describe("POST /api/recepciones — firma unica", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess()
    mockSupabaseFrom({
      orden_eventos: createChainMock(null, null),
      fotos_orden: createChainMock(null, null),
    })
  })

  it("manda la firma una sola vez, al lote y no por orden", async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: rpcOk, error: null } as any)

    await POST(createPostRequest(body))

    const params = vi.mocked(supabaseAdmin.rpc).mock.calls[0][1] as Record<string, any>
    expect(params.p_firma_cliente).toBe("data:image/png;base64,abc")
    expect(params.p_firma_mime).toBe("image/png")

    // Ningun equipo lleva firma propia
    for (const equipo of params.p_equipos) {
      expect("firmaCliente" in equipo).toBe(false)
    }
  })
})
