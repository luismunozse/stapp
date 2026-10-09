import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createPostRequest,
  parseResponse,
} from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

vi.mock("@/lib/counters", () => ({
  getNextReturnNumber: vi.fn().mockResolvedValue("DEV-000001"),
}))

vi.mock("@/lib/audit", () => ({
  createAuditLogger: vi.fn(() => ({
    create: vi.fn().mockResolvedValue(undefined),
  })),
}))

import { POST } from "@/app/api/ventas/[id]/devolucion/route"

const createParams = (id: string) => ({ params: Promise.resolve({ id }) })

const RPC_SUCCESS = { id: "d1", tipo: "PARCIAL", montoDevolucion: 20 }
const DEV_COMPLETA = { id: "d1", venta_id: "v1", numero_devolucion: "DEV-000001", motivo: "Defectuoso", tipo: "PARCIAL", monto_devolucion: "20", estado: "COMPLETADA", observaciones: null, procesado_por: "user-1", created_at: "2024-01-01", items_devolucion: [] }

describe("POST /api/ventas/[id]/devolucion — atomic RPC path", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: RPC succeeds
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: RPC_SUCCESS, error: null } as any)
  })

  it("happy path: calls registrar_devolucion_atomica with correct params, returns 201", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({
      // El route valida la existencia de la venta (scopeada por sucursal) antes
      // de llamar la RPC; sin este mock devuelve 404 "Venta no encontrada".
      ventas: createChainMock({ id: "v1" }),
      devoluciones_venta: createChainMock(DEV_COMPLETA),
    })

    const response = await POST(
      createPostRequest({
        motivo: "Defectuoso",
        items: [{ itemVentaId: "iv1", inventarioId: "inv1", cantidad: 2, precioUnitario: 10, restaurarStock: true }],
      }, "http://localhost/api/ventas/v1/devolucion"),
      createParams("v1")
    )
    const { status } = await parseResponse(response)

    expect(status).toBe(201)
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "registrar_devolucion_atomica",
      expect.objectContaining({
        p_venta_id: "v1",
        p_items: [{ itemVentaId: "iv1", inventarioId: "inv1", cantidad: 2, restaurarStock: true }],
      })
    )
  })

  it("agrega itemVentaId duplicados en p_items antes de llamar la RPC (anti over-refund)", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({
      ventas: createChainMock({ id: "v1" }),
      devoluciones_venta: createChainMock(DEV_COMPLETA),
    })
    let captured: any = null
    vi.mocked(supabaseAdmin.rpc).mockImplementation(((fn: string, params?: any) => {
      if (fn === "registrar_devolucion_atomica") captured = params
      return Promise.resolve({ data: RPC_SUCCESS, error: null })
    }) as any)

    await POST(
      createPostRequest({
        motivo: "Test",
        items: [
          { itemVentaId: "iv1", cantidad: 5, precioUnitario: 10, restaurarStock: false },
          { itemVentaId: "iv1", cantidad: 5, precioUnitario: 10, restaurarStock: false },
        ],
      }, "http://localhost/api/ventas/v1/devolucion"),
      createParams("v1")
    )

    expect(captured.p_items).toHaveLength(1)
    expect(captured.p_items[0]).toMatchObject({ itemVentaId: "iv1", cantidad: 10 })
  })

  it("rpc 'excede lo permitido' error → 400", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({ ventas: createChainMock({ id: "v1" }) })
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: null,
      error: { code: "P0001", message: 'La cantidad a devolver excede lo permitido para "Widget". Maximo: 3' },
    } as any)

    const response = await POST(
      createPostRequest({
        motivo: "Test",
        items: [{ itemVentaId: "iv1", cantidad: 10, precioUnitario: 5, restaurarStock: false }],
      }, "http://localhost/api/ventas/v1/devolucion"),
      createParams("v1")
    )
    const { status } = await parseResponse(response)

    expect(status).toBe(400)
  })

  it("rpc 'Venta no encontrada' error → 404", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    // Venta existe (pasa el chequeo previo); la RPC es la que reporta el 404.
    mockSupabaseFrom({ ventas: createChainMock({ id: "v1" }) })
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "Venta no encontrada" },
    } as any)

    const response = await POST(
      createPostRequest({
        motivo: "Test",
        items: [{ itemVentaId: "iv1", cantidad: 1, precioUnitario: 5, restaurarStock: false }],
      }, "http://localhost/api/ventas/v1/devolucion"),
      createParams("v1")
    )
    const { status } = await parseResponse(response)

    expect(status).toBe(404)
  })

  it("rpc 'completadas' error → 400", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({ ventas: createChainMock({ id: "v1" }) })
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "Solo se pueden crear devoluciones para ventas completadas" },
    } as any)

    const response = await POST(
      createPostRequest({
        motivo: "Test",
        items: [{ itemVentaId: "iv1", cantidad: 1, precioUnitario: 5, restaurarStock: false }],
      }, "http://localhost/api/ventas/v1/devolucion"),
      createParams("v1")
    )
    const { status } = await parseResponse(response)

    expect(status).toBe(400)
  })

  it("sin la RPC responde 503 y no escribe nada (ya no hay fallback JS)", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const devoluciones = createChainMock(DEV_COMPLETA)
    mockSupabaseFrom({
      ventas: createChainMock({ id: "v1", estado: "COMPLETADA", items_venta: [] }),
      devoluciones_venta: devoluciones,
    })
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: null,
      error: { code: "42883", message: "function registrar_devolucion_atomica does not exist" },
    } as any)

    const response = await POST(
      createPostRequest({
        motivo: "Defectuoso",
        items: [{ itemVentaId: "iv1", cantidad: 2, precioUnitario: 10, restaurarStock: false }],
      }, "http://localhost/api/ventas/v1/devolucion"),
      createParams("v1")
    )
    const { status, body } = await parseResponse(response)

    expect(status).toBe(503)
    expect(body.error).toMatch(/no están disponibles/)
    expect(devoluciones.insert).not.toHaveBeenCalled()
  })
})
