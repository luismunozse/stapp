import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  mockAuthError,
  createChainMock,
  mockSupabaseFrom,
  createPostRequest,
  parseResponse,
} from "./helpers"

vi.mock("@/lib/sucursal", () => ({
  sucursalParaEscritura: vi.fn(),
}))

vi.mock("@/lib/audit", () => ({
  createAuditLogger: vi.fn(() => ({
    create: vi.fn().mockResolvedValue(undefined),
  })),
}))

vi.mock("@/lib/counters", () => ({
  getNextOrderNumberByType: vi.fn().mockResolvedValue({ codigo: "CEL-001", numero: 1 }),
}))

import { sucursalParaEscritura } from "@/lib/sucursal"
import { supabaseAdmin } from "@/lib/supabase"
import { POST } from "@/app/api/cotizaciones/[id]/convertir-orden/route"

function createParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

const mockCotizacion = {
  id: "cot-1",
  numero_cotizacion: "PRES-001",
  tipo: "PRESUPUESTO",
  convertida_a_orden_id: null,
  cliente_id: "c1",
  total: 15000,
  sector_id: null,
  iva: 0,
  descuento_global_tipo: null,
  descuento_global_valor: 0,
  equipo_snapshot: {
    dispositivo: "iPhone 12",
    problemaReportado: "Pantalla rota",
    tipoDispositivo: "CELULAR",
    marca: "Apple",
    color: "Negro",
    imei: null,
    modelo: null,
    numeroSerie: null,
    condiciones: {},
  },
  checklist_snapshot: null,
}

const mockOrden = {
  id: "ord-1",
  numero_orden: 1,
  codigo_orden: "CEL-001",
  sucursal_id: "suc-A",
}

describe("POST /api/cotizaciones/[id]/convertir-orden", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns 401 when not authenticated", async () => {
    mockAuthError()
    const response = await POST(createPostRequest({}), createParams("cot-1"))
    const { status } = await parseResponse(response)
    expect(status).toBe(401)
  })

  it("returns 403 when role is not ADMIN", async () => {
    mockAuthSuccess({ role: "TECNICO" })
    const response = await POST(createPostRequest({}), createParams("cot-1"))
    const { status } = await parseResponse(response)
    expect(status).toBe(403)
  })

  it("returns 500 when sucursalParaEscritura returns null (no principal)", async () => {
    mockAuthSuccess()
    vi.mocked(sucursalParaEscritura).mockResolvedValue(null)

    const response = await POST(createPostRequest({}), createParams("cot-1"))
    const { status } = await parseResponse(response)
    expect(status).toBe(500)
  })

  it("inserts ordenes_servicio with sucursal_id from sucursalParaEscritura", async () => {
    mockAuthSuccess()
    vi.mocked(sucursalParaEscritura).mockResolvedValue("suc-A")

    const cotizacionChain = createChainMock(mockCotizacion)
    const ordenChain = createChainMock(mockOrden)
    const eventosChain = createChainMock(null)
    eventosChain.then = (resolve: any) => resolve({ data: null, error: null })
    const cotizUpdateChain = createChainMock(null)
    cotizUpdateChain.then = (resolve: any) => resolve({ data: null, error: null })

    let insertedPayload: any = null
    const insertChain = createChainMock(mockOrden)
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "cotizaciones") {
        // First call: select; second call: update
        let callCount = 0
        const chain: any = createChainMock(mockCotizacion)
        const origUpdate = chain.update
        chain.update = vi.fn().mockReturnValue(cotizUpdateChain)
        return chain
      }
      if (table === "ordenes_servicio") {
        const chain: any = {
          insert: vi.fn().mockImplementation((payload: any) => {
            insertedPayload = payload
            return {
              select: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({ data: mockOrden, error: null }),
            }
          }),
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: mockCotizacion, error: null }),
        }
        return chain as any
      }
      if (table === "orden_eventos") return eventosChain as any
      return createChainMock(null) as any
    })

    const response = await POST(createPostRequest({}), createParams("cot-1"))
    const { status } = await parseResponse(response)

    expect(status).toBe(201)
    expect(insertedPayload).not.toBeNull()
    expect(insertedPayload.sucursal_id).toBe("suc-A")
  })

  it("calls sucursalParaEscritura with correct args", async () => {
    mockAuthSuccess({ organizationId: "org-99", role: "ADMIN" })
    vi.mocked(sucursalParaEscritura).mockResolvedValue("suc-B")

    // Minimal setup — just enough to reach the sucursalParaEscritura call
    // It will return 500 here because the cotizacion fetch will fail — that's fine,
    // we just need to verify the call happened correctly
    vi.mocked(supabaseAdmin.from).mockImplementation(() => createChainMock(null, { message: "not found" }) as any)

    await POST(createPostRequest({}), createParams("cot-1"))

    expect(sucursalParaEscritura).toHaveBeenCalledWith({
      role: "ADMIN",
      organizationId: "org-99",
      userSucursalId: null,
    })
  })
})
