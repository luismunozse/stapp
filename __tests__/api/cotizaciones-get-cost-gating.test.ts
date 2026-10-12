import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createGetRequest,
  parseResponse,
} from "./helpers"

import { GET as getCotizacionDetail } from "@/app/api/cotizaciones/[id]/route"
import { GET as getCotizacionesList } from "@/app/api/cotizaciones/route"

function createParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

const baseCotizacionRow = (overrides: Record<string, any> = {}) => ({
  id: "cot-1",
  orden_id: null,
  cliente_id: "c1",
  sector_id: null,
  numero_cotizacion: "COT-001",
  estado: "BORRADOR",
  fecha_vencimiento: null,
  notas: null,
  subtotal: 500,
  iva: 0,
  total: 500,
  created_at: "2026-01-01T00:00:00Z",
  public_token: "tok",
  firma_aprobacion: null,
  firma_mime: null,
  fecha_aprobacion: null,
  descuento_global_tipo: "porcentaje",
  descuento_global_valor: 0,
  iva_porcentaje: 0,
  terminos: null,
  tipo: "ORDEN",
  equipo_snapshot: null,
  checklist_snapshot: null,
  convertida_a_orden_id: null,
  ordenes_servicio: null,
  clientes: null,
  sectores_cliente: null,
  created_by: "user-1",
  items_cotizacion: [
    {
      id: "item-1",
      descripcion: "Pantalla",
      cantidad: 1,
      precio_unitario: 500,
      costo_unitario: 300,
      subtotal: 500,
      unidad: "Unidad",
      descuento_tipo: "porcentaje",
      descuento_valor: 0,
      inventario_id: "inv-1",
      tipo_repuesto: "NO_APLICA",
    },
  ],
  ...overrides,
})

describe("GET /api/cotizaciones/[id] — cost visibility by role", () => {
  beforeEach(() => vi.clearAllMocks())

  it("includes costoUnitario for ADMIN", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const chain = createChainMock(baseCotizacionRow())
    mockSupabaseFrom({ cotizaciones: chain })

    const res = await getCotizacionDetail(createGetRequest(), createParams("cot-1"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.items[0].costoUnitario).toBe(300)
  })

  it("strips costoUnitario (returns null) for TECNICO even though the DB has a value", async () => {
    mockAuthSuccess({ role: "TECNICO" })
    const chain = createChainMock(baseCotizacionRow())
    mockSupabaseFrom({ cotizaciones: chain })

    const res = await getCotizacionDetail(createGetRequest(), createParams("cot-1"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.items[0].costoUnitario).toBeNull()
  })
})

describe("GET /api/cotizaciones (list) — cost visibility by role", () => {
  beforeEach(() => vi.clearAllMocks())

  it("includes costoUnitario for ADMIN in standalone (paginated) mode", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const chain = createChainMock([baseCotizacionRow()], null, 1)
    mockSupabaseFrom({ cotizaciones: chain })

    const res = await getCotizacionesList(createGetRequest("http://localhost:3000/api/cotizaciones"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.data[0].items[0].costoUnitario).toBe(300)
  })

  it("strips costoUnitario for TECNICO in standalone (paginated) mode", async () => {
    mockAuthSuccess({ role: "TECNICO", userId: "user-1" })
    const chain = createChainMock([baseCotizacionRow()], null, 1)
    mockSupabaseFrom({ cotizaciones: chain })

    const res = await getCotizacionesList(createGetRequest("http://localhost:3000/api/cotizaciones"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.data[0].items[0].costoUnitario).toBeNull()
  })

  it("strips costoUnitario for TECNICO in legacy ordenId mode", async () => {
    mockAuthSuccess({ role: "TECNICO", userId: "user-1" })
    const chain = createChainMock([baseCotizacionRow()])
    mockSupabaseFrom({ cotizaciones: chain })

    const res = await getCotizacionesList(
      createGetRequest("http://localhost:3000/api/cotizaciones?ordenId=orden-1")
    )
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body[0].items[0].costoUnitario).toBeNull()
  })
})
