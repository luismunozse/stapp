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
vi.mock("@/lib/audit", () => ({ createAuditLogger: () => ({ create: vi.fn() }) }))
vi.mock("@/lib/webhooks/dispatcher", () => ({
  emitWebhookEvent: vi.fn().mockResolvedValue(undefined),
}))

import { POST } from "@/app/api/ventas/route"
import { resolveOperador } from "@/lib/operadores"

const mockedResolveOperador = resolveOperador as ReturnType<typeof vi.fn>
const TECNICO_ID = "cltecnico00000001"

function buildTableMocks(tecnicosOperanPos: boolean) {
  const depositosChain: any = {}
  for (const m of ["select", "eq", "is"]) depositosChain[m] = vi.fn().mockReturnValue(depositosChain)
  depositosChain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })

  mockSupabaseFrom({
    organizations: createChainMock({
      iva_regimen: "EXENTO",
      tecnicos_operan_pos: tecnicosOperanPos,
    }),
    sucursales: createChainMock({ id: "suc-principal" }),
    depositos: depositosChain,
  })
}

const ventaBody = {
  clienteNombre: "Consumidor Final",
  items: [
    {
      inventarioId: "inv1",
      descripcion: "Cargador",
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
}

function post() {
  return POST(createPostRequest(ventaBody, "http://localhost/api/ventas"))
}

describe("POST /api/ventas — técnico habilitado en el POS", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "TECNICO", userId: TECNICO_ID })
    mockedResolveOperador.mockResolvedValue(TECNICO_ID)
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: { ventaId: "v1", numeroVenta: 1, garantias: [], items: ["i1"] },
      error: null,
    } as any)
  })

  it("con el flag prendido, crea la venta", async () => {
    buildTableMocks(true)

    const res = await post()

    expect(res.status).toBe(201)
    expect(vi.mocked(supabaseAdmin.rpc)).toHaveBeenCalled()
  })

  it("con el flag prendido, el técnico es acreditable como operador de la venta", async () => {
    // Si el técnico no entra en la lista de roles, resolveOperador lo descarta
    // en silencio y cae al fallback. Hoy el fallback es él mismo, así que el
    // resultado coincide por casualidad — pero apenas el POS mande un
    // vendedorId explícito la atribución se pierde sin ruido.
    buildTableMocks(true)

    await post()

    expect(mockedResolveOperador).toHaveBeenCalledWith(
      "org-1",
      undefined,
      TECNICO_ID,
      { roles: ["VENDEDOR", "ADMIN", "TECNICO"] },
    )
  })

  it("con el flag apagado, rechaza con 403 y no toca la venta", async () => {
    buildTableMocks(false)

    const res = await post()

    expect(res.status).toBe(403)
    expect((await parseResponse(res)).body.error).toBe("Acceso denegado")
    expect(vi.mocked(supabaseAdmin.rpc)).not.toHaveBeenCalled()
  })

  it("el vendedor no pierde nada: el flag apagado no lo toca", async () => {
    mockAuthSuccess({ role: "VENDEDOR", userId: "vendedor-1" })
    mockedResolveOperador.mockResolvedValue("vendedor-1")
    buildTableMocks(false)

    const res = await post()

    expect(res.status).toBe(201)
    expect(mockedResolveOperador).toHaveBeenCalledWith(
      "org-1",
      undefined,
      "vendedor-1",
      { roles: ["VENDEDOR", "ADMIN"] },
    )
  })
})
