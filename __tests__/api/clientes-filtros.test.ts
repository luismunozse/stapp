import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createGetRequest,
  parseResponse,
} from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

import { GET } from "@/app/api/clientes/route"

function mockRows() {
  return [
    { id: "c1", nombre: "Empresa SA", tipo_cliente: "EMPRESA", acepta_whatsapp: true, saldo_cuenta: "0", created_at: "2026-01-01", deuda_pendiente: "150.5", ordenes_count: 3, ultima_visita: "2026-05-01" },
  ]
}

describe("GET /api/clientes — filtros y resumen", () => {
  beforeEach(() => vi.clearAllMocks())

  it("lee de la vista v_clientes_resumen", async () => {
    mockAuthSuccess()
    const chain = createChainMock(mockRows(), null, 1)
    mockSupabaseFrom({ v_clientes_resumen: chain })
    const fromSpy = vi.mocked(supabaseAdmin.from)

    await GET(createGetRequest("http://localhost:3000/api/clientes"))

    expect(fromSpy).toHaveBeenCalledWith("v_clientes_resumen")
  })

  it("filtra por tipoCliente", async () => {
    mockAuthSuccess()
    const chain = createChainMock(mockRows(), null, 1)
    mockSupabaseFrom({ v_clientes_resumen: chain })

    await GET(createGetRequest("http://localhost:3000/api/clientes?tipoCliente=EMPRESA"))

    expect(chain.eq).toHaveBeenCalledWith("tipo_cliente", "EMPRESA")
  })

  it("filtra por conDeuda", async () => {
    mockAuthSuccess()
    const chain = createChainMock(mockRows(), null, 1)
    mockSupabaseFrom({ v_clientes_resumen: chain })

    await GET(createGetRequest("http://localhost:3000/api/clientes?conDeuda=true"))

    expect(chain.gt).toHaveBeenCalledWith("deuda_pendiente", 0)
  })

  it("filtra por fechaDesde y fechaHasta sobre created_at", async () => {
    mockAuthSuccess()
    const chain = createChainMock(mockRows(), null, 1)
    mockSupabaseFrom({ v_clientes_resumen: chain })

    await GET(createGetRequest("http://localhost:3000/api/clientes?fechaDesde=2026-01-01&fechaHasta=2026-02-01"))

    expect(chain.gte).toHaveBeenCalledWith("created_at", "2026-01-01T00:00:00")
    expect(chain.lte).toHaveBeenCalledWith("created_at", "2026-02-01T23:59:59")
  })

  it("filtra por aceptaWhatsapp=false", async () => {
    mockAuthSuccess()
    const chain = createChainMock(mockRows(), null, 1)
    mockSupabaseFrom({ v_clientes_resumen: chain })

    await GET(createGetRequest("http://localhost:3000/api/clientes?aceptaWhatsapp=false"))

    expect(chain.eq).toHaveBeenCalledWith("acepta_whatsapp", false)
  })

  it("sin filtros no aplica tipo/deuda/fecha/whatsapp", async () => {
    mockAuthSuccess()
    const chain = createChainMock(mockRows(), null, 1)
    mockSupabaseFrom({ v_clientes_resumen: chain })

    await GET(createGetRequest("http://localhost:3000/api/clientes"))

    const eqCalls = chain.eq.mock.calls.map((c: any) => c[0])
    expect(eqCalls).not.toContain("tipo_cliente")
    expect(eqCalls).not.toContain("acepta_whatsapp")
    expect(chain.gt).not.toHaveBeenCalled()
  })

  it("devuelve totalDeuda y los campos de resumen mapeados", async () => {
    mockAuthSuccess()
    const chain = createChainMock(mockRows(), null, 1)
    mockSupabaseFrom({ v_clientes_resumen: chain })

    const res = await GET(createGetRequest("http://localhost:3000/api/clientes"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.totalDeuda).toBe(150.5)
    expect(body.data[0].deudaPendiente).toBe(150.5)
    expect(body.data[0].ordenesCount).toBe(3)
    expect(body.data[0].ultimaVisita).toBe("2026-05-01")
  })
})
