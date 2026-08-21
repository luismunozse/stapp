import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createPostRequest,
  parseResponse,
} from "./helpers"

vi.mock("@/lib/audit", () => ({
  createAuditLogger: vi.fn(() => ({ update: vi.fn().mockResolvedValue(undefined) })),
  diffObjects: vi.fn().mockReturnValue({ before: {}, after: {} }),
}))

vi.mock("@/lib/notifications/queue", () => ({
  queueNotification: vi.fn().mockResolvedValue(undefined),
}))

import { supabaseAdmin } from "@/lib/supabase"
import { POST } from "@/app/api/ordenes/[id]/entregar/route"

function createParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

const ordenBase = {
  id: "o1",
  estado: "REPARADO",
  organization_id: "org-1",
  sucursal_id: "suc-1",
  cliente_id: "c1",
  numero_orden: 7,
  codigo_orden: "ORD-7",
  tecnico_id: null,
  costo_final: "0",
  descuento_cobro: "0",
  total_cobrado: "0",
  fecha_completado: null,
}

/**
 * Prepara la orden y los repuestos. Devuelve el chain de ordenes_servicio para
 * poder inspeccionar el .update() y ver qué costo_final se persistió.
 */
function mockEntrega(repuestos: Array<Record<string, unknown>>) {
  const ordenes = createChainMock({ ...ordenBase, estado: "ENTREGADO", users: null })
  mockSupabaseFrom({
    ordenes_servicio: ordenes,
    repuestos_orden: createChainMock(repuestos),
    organizations: createChainMock({ nombre: "Taller", zona_horaria: "America/Argentina/Buenos_Aires" }),
    garantias: createChainMock(null),
    orden_eventos: createChainMock(null),
  })
  // El primer .single() trae la orden ORIGINAL (en REPARADO).
  ;(ordenes as any).single.mockResolvedValueOnce({ data: ordenBase, error: null })
  return ordenes
}

/** costo_final que quedó en el UPDATE de la entrega. */
function costoFinalPersistido(ordenes: any) {
  const call = ordenes.update.mock.calls.at(-1)
  return call?.[0]?.costo_final
}

describe("POST /api/ordenes/[id]/entregar — total a cobrar y repuestos", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { success: true }, error: null } as any)
  })

  it("con incluyeRepuestos=true usa el total tal cual (no los suma dos veces)", async () => {
    mockAuthSuccess()
    const ordenes = mockEntrega([
      { cantidad: 2, precio_unitario: "1000", precio_venta_unitario: "4500" },
    ])

    const res = await POST(
      createPostRequest({ totalACobrar: 150000, incluyeRepuestos: true }),
      createParams("o1")
    )

    expect((await parseResponse(res)).status).toBe(200)
    expect(costoFinalPersistido(ordenes)).toBe(150000)
  })

  it("con incluyeRepuestos=false suma los repuestos a PRECIO DE VENTA", async () => {
    mockAuthSuccess()
    const ordenes = mockEntrega([
      { cantidad: 2, precio_unitario: "1000", precio_venta_unitario: "4500" }, // 9000
      { cantidad: 1, precio_unitario: "500", precio_venta_unitario: "1200" },  // 1200
    ])

    const res = await POST(
      createPostRequest({ totalACobrar: 50000, incluyeRepuestos: false }),
      createParams("o1")
    )

    expect((await parseResponse(res)).status).toBe(200)
    // 50000 + 9000 + 1200 — con el COSTO habria dado 50000 + 2000 + 500.
    expect(costoFinalPersistido(ordenes)).toBe(60200)
  })

  it("cae al costo en repuestos anteriores a la migracion 286 (sin precio de venta)", async () => {
    mockAuthSuccess()
    const ordenes = mockEntrega([
      { cantidad: 3, precio_unitario: "800", precio_venta_unitario: null },
    ])

    const res = await POST(
      createPostRequest({ totalACobrar: 10000, incluyeRepuestos: false }),
      createParams("o1")
    )

    expect((await parseResponse(res)).status).toBe(200)
    expect(costoFinalPersistido(ordenes)).toBe(12400) // 10000 + 3 × 800
  })

  it("no toca costo_final si no se confirmo un total", async () => {
    mockAuthSuccess()
    const ordenes = mockEntrega([
      { cantidad: 1, precio_unitario: "1000", precio_venta_unitario: "3000" },
    ])

    const res = await POST(createPostRequest({}), createParams("o1"))

    expect((await parseResponse(res)).status).toBe(200)
    // La clave no debe estar presente: la orden conserva el costo que traia.
    expect(costoFinalPersistido(ordenes)).toBeUndefined()
  })

  it("ignora el total en una entrega sin cobro", async () => {
    mockAuthSuccess()
    const ordenes = mockEntrega([
      { cantidad: 1, precio_unitario: "1000", precio_venta_unitario: "3000" },
    ])

    const res = await POST(
      createPostRequest({ sinCobro: true, totalACobrar: 50000, incluyeRepuestos: false }),
      createParams("o1")
    )

    expect((await parseResponse(res)).status).toBe(200)
    expect(costoFinalPersistido(ordenes)).toBeUndefined()
  })

  it("redondea a dos decimales", async () => {
    mockAuthSuccess()
    const ordenes = mockEntrega([
      { cantidad: 3, precio_unitario: "100", precio_venta_unitario: "333.33" },
    ])

    const res = await POST(
      createPostRequest({ totalACobrar: 1000.01, incluyeRepuestos: false }),
      createParams("o1")
    )

    expect((await parseResponse(res)).status).toBe(200)
    expect(costoFinalPersistido(ordenes)).toBe(2000) // 1000.01 + 999.99
  })
})
