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

vi.mock("@/lib/recargos", async (orig) => {
  const actual = (await orig()) as any
  return {
    ...actual,
    getRecargosMetodo: vi.fn().mockResolvedValue({ CUENTA_CORRIENTE: 3 }),
  }
})
vi.mock("@/lib/audit", () => ({
  createAuditLogger: () => ({ create: vi.fn() }),
}))
vi.mock("@/lib/webhooks/dispatcher", () => ({
  emitWebhookEvent: vi.fn().mockResolvedValue(undefined),
}))

import { POST } from "@/app/api/ventas/route"

const precioBase = 1000
const factor = 1.03
const qty = 1

function buildTableMocks() {
  // sucursales: sucursalParaEscritura needs this
  const sucursalesChain = createChainMock({ id: "suc-principal" })

  // depositos: getDepositoDeSucursal needs this
  const depositosChain: any = {}
  for (const m of ["select", "eq", "is"])
    depositosChain[m] = vi.fn().mockReturnValue(depositosChain)
  depositosChain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })

  // ventas: post-RPC selects
  const ventasChain = createChainMock({ id: "v1", numero_venta: 1, total: 1030 })

  mockSupabaseFrom({
    // EXENTO → no IVA branch, no extra ventas.update() for IVA snapshot
    organizations: createChainMock({ iva_regimen: "EXENTO" }),
    sucursales: sucursalesChain,
    depositos: depositosChain,
    ventas: ventasChain,
  })
}

describe("POST /api/ventas — Task 5: factor de recargo por método de pago", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN" })

    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: { ventaId: "v1", numeroVenta: 1, garantias: [], items: ["i1"] },
      error: null,
    } as any)

    buildTableMocks()
  })

  it("aplica factor 1.03 al p_total y a p_items[0].precioUnitario cuando el pago principal es CUENTA_CORRIENTE", async () => {
    const body = {
      clienteId: "c1",
      clienteNombre: "Juan",
      items: [
        {
          inventarioId: "inv1",
          descripcion: "X",
          cantidad: qty,
          precioUnitario: precioBase,
          diasGarantia: 0,
          descuento: 0,
          tipoDescuento: "MONTO",
          porcentajeDescuento: 0,
        },
      ],
      descuento: 0,
      tipoDescuento: "MONTO",
      porcentajeDescuento: 0,
      metodoPago: "CUENTA_CORRIENTE",
      pagos: [{ metodo: "CUENTA_CORRIENTE", monto: precioBase * factor * qty }],
    }

    const res = await POST(
      createPostRequest(body, "http://localhost/api/ventas")
    )
    await parseResponse(res)

    const [, params] = vi.mocked(supabaseAdmin.rpc).mock.calls[0]
    const expected = Math.round((precioBase * factor + Number.EPSILON) * 100) / 100
    expect(params.p_total).toBeCloseTo(expected, 2)
    expect(params.p_items[0].precioUnitario).toBeCloseTo(expected, 2)
  })

  it("no aplica factor (1.0) cuando el método es EFECTIVO (sin recargo)", async () => {
    const body = {
      clienteId: "c1",
      clienteNombre: "Juan",
      items: [
        {
          inventarioId: "inv1",
          descripcion: "X",
          cantidad: qty,
          precioUnitario: precioBase,
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
      pagos: [{ metodo: "EFECTIVO", monto: precioBase }],
    }

    const res = await POST(
      createPostRequest(body, "http://localhost/api/ventas")
    )
    await parseResponse(res)

    const [, params] = vi.mocked(supabaseAdmin.rpc).mock.calls[0]
    expect(params.p_total).toBeCloseTo(precioBase, 2)
    expect(params.p_items[0].precioUnitario).toBeCloseTo(precioBase, 2)
  })
})
