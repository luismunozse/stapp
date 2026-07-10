import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  mockAuthError,
  createChainMock,
  createPostRequest,
  parseResponse,
} from "./helpers"

vi.mock("@/lib/notifications/queue", () => ({
  queueNotification: vi.fn().mockResolvedValue(undefined),
}))

import { supabaseAdmin } from "@/lib/supabase"
import { queueNotification } from "@/lib/notifications/queue"
import { POST } from "@/app/api/cotizaciones/[id]/aprobar/route"

function createParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

const validBody = {
  firmaAprobacion: "data:image/png;base64,abc",
  firmaMime: "image/png",
}

const mockCotizacionEnviada = {
  id: "cot-1",
  numero_cotizacion: "COT-001",
  estado: "ENVIADA",
  tipo: "ORDEN",
  created_by: "user-1",
  organization_id: "org-1",
  orden_id: null,
  clientes: { id: "c1", nombre: "Juan" },
  ordenes_servicio: null,
  items_cotizacion: [],
  subtotal: 10000,
  iva: 0,
  total: 10000,
  firma_aprobacion: "data:image/png;base64,abc",
  firma_mime: "image/png",
  fecha_aprobacion: new Date().toISOString(),
}

// The full cotizacion with joins that aprobar re-fetches after success
const mockCotizacionAceptada = {
  ...mockCotizacionEnviada,
  estado: "ACEPTADA",
}

// Cotizacion linked to an order still in PRESUPUESTADO — signature approval
// must transition the order the same way the public portal routes do.
const mockCotizacionConOrden = {
  ...mockCotizacionEnviada,
  orden_id: "orden-1",
}
const mockCotizacionConOrdenAceptada = {
  ...mockCotizacionConOrden,
  estado: "ACEPTADA",
}

const mockOrdenPresupuestada = {
  id: "orden-1",
  estado: "PRESUPUESTADO",
  organization_id: "org-1",
  cliente_id: "c1",
  numero_orden: 42,
  dispositivo: "iPhone 12",
  public_token: "tok123",
  clientes: { id: "c1", nombre: "Juan", email: null, telefono: "123" },
  organizations: {
    nombre: "Taller",
    nombre_mostrar: null,
    slug: "taller",
    moneda: "ARS",
    zona_horaria: "America/Argentina/Buenos_Aires",
  },
}

describe("POST /api/cotizaciones/[id]/aprobar — atomic RPC path", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns 401 when not authenticated", async () => {
    mockAuthError()
    const response = await POST(createPostRequest(validBody), createParams("cot-1"))
    const { status } = await parseResponse(response)
    expect(status).toBe(401)
  })

  it("returns 404 when cotizacion not found", async () => {
    mockAuthSuccess()
    vi.mocked(supabaseAdmin.from).mockImplementation(() =>
      createChainMock(null, { message: "not found" }) as any
    )
    const response = await POST(createPostRequest(validBody), createParams("cot-1"))
    const { status } = await parseResponse(response)
    expect(status).toBe(404)
  })

  it("returns 400 when cotizacion is not ENVIADA (pre-RPC JS guard)", async () => {
    mockAuthSuccess()
    const notEnviada = { ...mockCotizacionEnviada, estado: "ACEPTADA", created_by: "user-1" }
    vi.mocked(supabaseAdmin.from).mockImplementation(() =>
      createChainMock(notEnviada) as any
    )
    const response = await POST(createPostRequest(validBody), createParams("cot-1"))
    const { status, body } = await parseResponse(response)
    expect(status).toBe(400)
    expect(body.error).toMatch(/enviadas/i)
  })

  it("returns 400 when firma is missing for non-PRESUPUESTO", async () => {
    mockAuthSuccess()
    vi.mocked(supabaseAdmin.from).mockImplementation(() =>
      createChainMock(mockCotizacionEnviada) as any
    )
    const response = await POST(createPostRequest({}), createParams("cot-1"))
    const { status } = await parseResponse(response)
    expect(status).toBe(400)
  })

  it("calls aprobar_cotizacion_atomica rpc with correct p_cotizacion_id", async () => {
    mockAuthSuccess()

    // first .from("cotizaciones") for the pre-validation fetch
    const fetchChain = createChainMock(mockCotizacionEnviada)
    // second .from("cotizaciones") for the re-fetch after RPC
    const refetchChain = createChainMock(mockCotizacionAceptada)

    let callCount = 0
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "cotizaciones") {
        callCount++
        return (callCount === 1 ? fetchChain : refetchChain) as any
      }
      return createChainMock(null) as any
    })

    let capturedRpcName: string | null = null
    let capturedRpcParams: any = null

    vi.mocked(supabaseAdmin.rpc).mockImplementation((fn: string, params?: any) => {
      capturedRpcName = fn
      capturedRpcParams = params
      return Promise.resolve({ data: { ok: true }, error: null }) as any
    })

    const response = await POST(createPostRequest(validBody), createParams("cot-1"))
    const { status } = await parseResponse(response)

    expect(status).toBe(200)
    expect(capturedRpcName).toBe("aprobar_cotizacion_atomica")
    expect(capturedRpcParams).not.toBeNull()
    expect(capturedRpcParams.p_cotizacion_id).toBe("cot-1")
    expect(capturedRpcParams.p_org_id).toBe("org-1")
    expect(capturedRpcParams.p_firma).toBe(validBody.firmaAprobacion)
    expect(capturedRpcParams.p_firma_mime).toBe(validBody.firmaMime)
  })

  it("returns 400 when rpc error message contains 'enviadas'", async () => {
    mockAuthSuccess()
    const fetchChain = createChainMock(mockCotizacionEnviada)
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "cotizaciones") return fetchChain as any
      return createChainMock(null) as any
    })

    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: null,
      error: { message: "Solo se pueden aprobar cotizaciones enviadas", code: "P0001" },
    } as any)

    const response = await POST(createPostRequest(validBody), createParams("cot-1"))
    const { status } = await parseResponse(response)
    expect(status).toBe(400)
  })

  it("returns 404 when rpc error message contains 'no encontrada'", async () => {
    mockAuthSuccess()
    const fetchChain = createChainMock(mockCotizacionEnviada)
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "cotizaciones") return fetchChain as any
      return createChainMock(null) as any
    })

    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: null,
      error: { message: "Cotizacion no encontrada", code: "P0001" },
    } as any)

    const response = await POST(createPostRequest(validBody), createParams("cot-1"))
    const { status } = await parseResponse(response)
    expect(status).toBe(404)
  })

  it("returns 200 with correct shape on success", async () => {
    mockAuthSuccess()

    let callCount = 0
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "cotizaciones") {
        callCount++
        if (callCount === 1) return createChainMock(mockCotizacionEnviada) as any
        return createChainMock(mockCotizacionAceptada) as any
      }
      return createChainMock(null) as any
    })

    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: { ok: true },
      error: null,
    } as any)

    const response = await POST(createPostRequest(validBody), createParams("cot-1"))
    const { status, body } = await parseResponse(response)

    expect(status).toBe(200)
    expect(body).toHaveProperty("id")
    expect(body).toHaveProperty("estado")
    expect(body.estado).toBe("ACEPTADA")
  })

  it("transitions linked order to APROBADO and records orden_eventos on signature approval", async () => {
    mockAuthSuccess({ userId: "user-1" })

    const ordenChain = createChainMock(mockOrdenPresupuestada)
    const eventosChain = createChainMock(null)

    let cotizacionCallCount = 0
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "cotizaciones") {
        cotizacionCallCount++
        return (cotizacionCallCount === 1 ? createChainMock(mockCotizacionConOrden) : createChainMock(mockCotizacionConOrdenAceptada)) as any
      }
      if (table === "ordenes_servicio") return ordenChain as any
      if (table === "orden_eventos") return eventosChain as any
      return createChainMock(null) as any
    })

    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { ok: true }, error: null } as any)

    const response = await POST(createPostRequest(validBody), createParams("cot-1"))
    const { status } = await parseResponse(response)

    expect(status).toBe(200)

    const updateCall = ordenChain.update.mock.calls.find(
      (call: any[]) => call[0]?.estado === "APROBADO"
    )
    expect(updateCall).toBeDefined()

    const insertCall = eventosChain.insert.mock.calls.find(
      (call: any[]) => call[0]?.tipo === "PRESUPUESTO_APROBADO"
    )
    expect(insertCall).toBeDefined()
    expect(insertCall![0]).toMatchObject({
      orden_id: "orden-1",
      organization_id: "org-1",
      estado_anterior: "PRESUPUESTADO",
      estado_nuevo: "APROBADO",
    })

    expect(queueNotification).toHaveBeenCalled()
  })

  it("does not transition the order when it is not in PRESUPUESTADO state", async () => {
    mockAuthSuccess({ userId: "user-1" })

    const ordenYaAprobada = { ...mockOrdenPresupuestada, estado: "APROBADO" }
    const ordenChain = createChainMock(ordenYaAprobada)
    const eventosChain = createChainMock(null)

    let cotizacionCallCount = 0
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "cotizaciones") {
        cotizacionCallCount++
        return (cotizacionCallCount === 1 ? createChainMock(mockCotizacionConOrden) : createChainMock(mockCotizacionConOrdenAceptada)) as any
      }
      if (table === "ordenes_servicio") return ordenChain as any
      if (table === "orden_eventos") return eventosChain as any
      return createChainMock(null) as any
    })

    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { ok: true }, error: null } as any)

    const response = await POST(createPostRequest(validBody), createParams("cot-1"))
    const { status } = await parseResponse(response)

    expect(status).toBe(200)
    expect(ordenChain.update).not.toHaveBeenCalled()
    expect(eventosChain.insert).not.toHaveBeenCalled()
  })
})

describe("POST /api/cotizaciones/[id]/aprobar — function-missing fallback", () => {
  beforeEach(() => vi.clearAllMocks())

  it("uses .eq('estado','ENVIADA') optimistic lock on update in fallback path", async () => {
    mockAuthSuccess()

    const fetchChain = createChainMock(mockCotizacionEnviada)
    // The fallback does an update with .eq("estado","ENVIADA") then a joined select re-fetch
    const updateChain = createChainMock(mockCotizacionAceptada)
    const refetchChain = createChainMock(mockCotizacionAceptada)

    let cotizacionCallCount = 0
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "cotizaciones") {
        cotizacionCallCount++
        if (cotizacionCallCount === 1) return fetchChain as any
        if (cotizacionCallCount === 2) return updateChain as any
        return refetchChain as any
      }
      return createChainMock(null) as any
    })

    // First rpc call: return function-missing error
    // Second rpc call (reservar_items_cotizacion in fallback): return success
    let rpcCallCount = 0
    vi.mocked(supabaseAdmin.rpc).mockImplementation((fn: string) => {
      rpcCallCount++
      if (rpcCallCount === 1) {
        return Promise.resolve({
          data: null,
          error: { code: "PGRST202", message: "Could not find the function" },
        }) as any
      }
      // reservar_items_cotizacion
      return Promise.resolve({ data: { success: true }, error: null }) as any
    })

    const response = await POST(createPostRequest(validBody), createParams("cot-1"))
    const { status } = await parseResponse(response)
    expect(status).toBe(200)

    // Verify the update chain received .eq("estado", "ENVIADA") call
    const updateEqCalls = updateChain.eq.mock.calls
    const hasEstadoEnviadaLock = updateEqCalls.some(
      (call: any[]) => call[0] === "estado" && call[1] === "ENVIADA"
    )
    expect(hasEstadoEnviadaLock).toBe(true)
  })

  it("returns 400 if fallback update returns no rows (double-approve prevented)", async () => {
    mockAuthSuccess()

    const fetchChain = createChainMock(mockCotizacionEnviada)
    // Update returns null (no row matched — already approved by someone else)
    const updateChain = createChainMock(null)

    let cotizacionCallCount = 0
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "cotizaciones") {
        cotizacionCallCount++
        if (cotizacionCallCount === 1) return fetchChain as any
        return updateChain as any
      }
      return createChainMock(null) as any
    })

    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: null,
      error: { code: "PGRST202", message: "Could not find the function" },
    } as any)

    const response = await POST(createPostRequest(validBody), createParams("cot-1"))
    const { status } = await parseResponse(response)
    expect(status).toBe(400)
  })
})
