// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  mockSupabaseFrom,
  createChainMock,
  createPostRequest,
  parseResponse,
} from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

vi.mock("@/lib/operadores", () => ({ resolveOperador: vi.fn() }))
vi.mock("@/lib/audit", () => ({
  createAuditLogger: () => ({ create: vi.fn() }),
}))
vi.mock("@/lib/webhooks/dispatcher", () => ({
  emitWebhookEvent: vi.fn().mockResolvedValue(undefined),
}))

import { POST } from "@/app/api/ventas/route"
import { resolveOperador } from "@/lib/operadores"

const mockedResolveOperador = resolveOperador as ReturnType<typeof vi.fn>

const VENDEDOR_UUID = "11111111-1111-1111-1111-111111111111"

function buildTableMocks() {
  const sucursalesChain = createChainMock({ id: "suc-principal" })

  const depositosChain: any = {}
  for (const m of ["select", "eq", "is"])
    depositosChain[m] = vi.fn().mockReturnValue(depositosChain)
  depositosChain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })

  mockSupabaseFrom({
    organizations: createChainMock({ iva_regimen: "EXENTO" }),
    sucursales: sucursalesChain,
    depositos: depositosChain,
  })
}

describe("POST /api/ventas — vendedor seleccionable", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN", userId: "sess-user-1" })
    mockedResolveOperador.mockResolvedValue(VENDEDOR_UUID)

    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: { ventaId: "v1", numeroVenta: 1, garantias: [], items: ["i1"] },
      error: null,
    } as any)

    buildTableMocks()
  })

  it("usa el vendedor resuelto por resolveOperador en p_vendedor_id", async () => {
    const body = {
      clienteNombre: "Consumidor Final",
      items: [
        {
          inventarioId: "inv1",
          descripcion: "X",
          cantidad: 1,
          precioUnitario: 1000,
          diasGarantia: 0,
          descuento: 0,
          tipoDescuento: "MONTO",
          porcentajeDescuento: 0,
        },
      ],
      descuento: 0,
      tipoDescuento: "MONTO",
      porcentajeDescuento: 0,
      metodoPago: "EFECTIVO",
      pagos: [{ metodo: "EFECTIVO", monto: 1000 }],
      vendedorId: VENDEDOR_UUID,
    }

    const res = await POST(createPostRequest(body, "http://localhost/api/ventas"))
    await parseResponse(res)

    expect(mockedResolveOperador).toHaveBeenCalledWith(
      "org-1",
      VENDEDOR_UUID,
      "sess-user-1",
      { roles: ["VENDEDOR", "ADMIN"] }
    )

    const [, params] = vi.mocked(supabaseAdmin.rpc).mock.calls[0]
    expect(params.p_vendedor_id).toBe(VENDEDOR_UUID)
  })
})
