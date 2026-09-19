import { describe, it, expect, beforeEach, vi } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import { mockAuthSuccess, createChainMock, parseResponse } from "./helpers"

const logAuditMock = vi.fn().mockResolvedValue(undefined)
vi.mock("@/lib/audit", () => ({
  logAudit: (...args: any[]) => logAuditMock(...args),
  createAuditLogger: vi.fn(() => ({ create: vi.fn(), update: vi.fn() })),
  diffObjects: vi.fn().mockReturnValue({ before: {}, after: {} }),
}))

vi.mock("@/lib/sucursal", () => ({
  sucursalParaLectura: vi.fn().mockResolvedValue({ verTodas: true, sucursalId: null }),
  sucursalParaEscritura: vi.fn().mockResolvedValue("suc-1"),
}))

import { DELETE } from "@/app/api/caja/movimientos/[id]/route"

const params = (id: string) => ({ params: Promise.resolve({ id }) })

function req(body?: any): Request {
  return new Request("http://localhost:3000/api/caja/movimientos/mov-1", {
    method: "DELETE",
    ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  })
}

const MOVIMIENTO: {
  id: string
  tipo: string
  monto: string
  concepto: string
  metodo_pago: string
  fecha: string
  anulado: boolean
  organization_id: string
  sucursal_id: string | null
  sesion_caja_id: string | null
  sesiones_caja: { id: string; estado: string } | null
} = {
  id: "mov-1",
  tipo: "EGRESO",
  monto: "5000",
  concepto: "Compra de insumos",
  metodo_pago: "EFECTIVO",
  fecha: "2026-09-10T15:00:00Z",
  anulado: false,
  organization_id: "org-1",
  sucursal_id: "suc-1",
  sesion_caja_id: null,
  sesiones_caja: null,
}

/**
 * Auditoría contable, punto 1.6.
 *
 * Antes esto hacía un delete físico: la fila desaparecía y no quedaba quién
 * la dio de baja, cuándo, ni cuánto decía. Y como el único freno era que la
 * sesión estuviera cerrada, un movimiento cargado SIN caja abierta se podía
 * borrar meses después, cambiando la ganancia de un mes ya reportado.
 */
describe("anular un movimiento de caja", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    logAuditMock.mockClear()
    mockAuthSuccess({ role: "ADMIN" })
  })

  /** Chain que resuelve el .single() de la lectura y el .select() del update. */
  function mockMovimientos(overrides: Partial<typeof MOVIMIENTO> = {}) {
    const chain: any = createChainMock([{ id: "mov-1" }])
    chain.single = vi.fn().mockResolvedValue({
      data: { ...MOVIMIENTO, ...overrides },
      error: null,
    })
    vi.mocked(supabaseAdmin.from).mockImplementation(() => chain)
    return chain
  }

  it("marca la fila como anulada en vez de borrarla", async () => {
    const chain = mockMovimientos()

    const { status } = await parseResponse(await DELETE(req(), params("mov-1")))

    expect(status).toBe(200)
    expect(chain.delete).not.toHaveBeenCalled()
    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        anulado: true,
        anulado_por: "user-1",
        anulado_at: expect.any(String),
      })
    )
  })

  it("deja registrado quién anuló, cuánto era y por qué", async () => {
    mockMovimientos()

    await DELETE(req({ motivo: "Lo cargué dos veces" }), params("mov-1"))

    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "DELETE",
        entity: "movimientos_caja",
        entityId: "mov-1",
        userId: "user-1",
        changes: expect.objectContaining({
          before: expect.objectContaining({ monto: "5000", concepto: "Compra de insumos" }),
        }),
      })
    )
    const desc = logAuditMock.mock.calls[0][0].description
    expect(desc).toContain("Compra de insumos")
    expect(desc).toContain("Lo cargué dos veces")
  })

  it("el motivo es opcional: el cliente viejo manda DELETE sin body", async () => {
    mockMovimientos()

    const { status } = await parseResponse(await DELETE(req(), params("mov-1")))

    expect(status).toBe(200)
    expect(logAuditMock).toHaveBeenCalled()
  })

  it("un movimiento ya anulado responde ok sin volver a auditarlo", async () => {
    // Idempotente: el doble click no genera dos entradas de auditoría.
    mockMovimientos({ anulado: true })

    const { status, body } = await parseResponse(await DELETE(req(), params("mov-1")))

    expect(status).toBe(200)
    expect(body.yaAnulado).toBe(true)
    expect(logAuditMock).not.toHaveBeenCalled()
  })

  it("sigue sin poder tocarse un movimiento de una caja ya cerrada", async () => {
    mockMovimientos({ sesion_caja_id: "ses-1", sesiones_caja: { id: "ses-1", estado: "CERRADA" } })

    const { status, body } = await parseResponse(await DELETE(req(), params("mov-1")))

    expect(status).toBe(400)
    expect(body.error).toMatch(/cerrada/i)
  })

  it("si otra request lo anuló primero, no audita dos veces", async () => {
    // El .eq("anulado", false) del update es el lock optimista: el segundo
    // pedido afecta 0 filas.
    const chain: any = createChainMock([])
    chain.single = vi.fn().mockResolvedValue({ data: MOVIMIENTO, error: null })
    vi.mocked(supabaseAdmin.from).mockImplementation(() => chain)

    const { status, body } = await parseResponse(await DELETE(req(), params("mov-1")))

    expect(status).toBe(200)
    expect(body.yaAnulado).toBe(true)
    expect(logAuditMock).not.toHaveBeenCalled()
  })

  it("un motivo larguísimo se recorta en vez de romper el insert", async () => {
    mockMovimientos()

    await DELETE(req({ motivo: "x".repeat(2000) }), params("mov-1"))

    const motivo = logAuditMock.mock.calls[0][0].changes.after.anulado_motivo
    expect(motivo).toHaveLength(500)
  })
})
