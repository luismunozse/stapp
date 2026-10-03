import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, createPostRequest, parseResponse } from "./helpers"

vi.mock("@/lib/sucursal", () => ({
  sucursalParaEscritura: vi.fn(),
}))

import { sucursalParaEscritura } from "@/lib/sucursal"
import { supabaseAdmin } from "@/lib/supabase"
import { POST } from "@/app/api/cotizaciones/[id]/convertir-venta/route"

const params = (id: string) => ({ params: Promise.resolve({ id }) })

const body = {
  metodoPago: "EFECTIVO",
  items: [{ cotizacionItemId: "item-1", diasGarantia: 0 }],
}

const cotizacionBase = {
  id: "cot-1",
  numero_cotizacion: "COT-001",
  estado: "ACEPTADA",
  tipo: "ORDEN",
  venta_id: null as string | null,
  clientes: { id: "c1", nombre: "Juan", telefono: "123" },
  ordenes_servicio: null,
  items_cotizacion: [
    {
      id: "item-1",
      descripcion: "Servicio",
      cantidad: 1,
      precio_unitario: 10000,
      descuento_valor: 0,
      descuento_tipo: "monto",
      inventario_id: null,
      costo_unitario: null,
    },
  ],
  descuento_global_tipo: null,
  descuento_global_valor: 0,
  iva: 0,
}

/**
 * Mock de la tabla ventas que responde distinto según la consulta: por id
 * (maybeSingle), por clave de idempotencia u observación (ilike), el conteo
 * (head) y el número de la venta recién creada (single).
 */
function ventasMock(opts: {
  porId?: any
  porClave?: any[]
  porObservacion?: any[]
  conteo?: number
}) {
  return () => {
    const estado: { ilike?: string; head?: boolean } = {}
    const resultado = () => {
      if (estado.head) return { data: null, error: null, count: opts.conteo ?? 0 }
      if (estado.ilike === "idempotency_key") return { data: opts.porClave ?? [], error: null }
      if (estado.ilike === "observaciones") return { data: opts.porObservacion ?? [], error: null }
      return { data: opts.porId ?? null, error: null }
    }
    const chain: any = {}
    for (const m of ["eq", "neq", "order", "limit", "in", "is"]) chain[m] = vi.fn(() => chain)
    chain.select = vi.fn((_c: string, o?: { head?: boolean }) => {
      if (o?.head) estado.head = true
      return chain
    })
    chain.ilike = vi.fn((col: string) => {
      estado.ilike = col
      return chain
    })
    chain.maybeSingle = vi.fn(() => Promise.resolve(resultado()))
    chain.single = vi.fn(() => Promise.resolve({ data: { numero_venta: 7 }, error: null }))
    chain.then = (res: any, rej?: any) => Promise.resolve(resultado()).then(res, rej)
    return chain
  }
}

function setup(opts: { cotizacion?: any; ventas?: Parameters<typeof ventasMock>[0] } = {}) {
  const cotizacionesUpdates: any[] = []
  const nuevaVentas = ventasMock(opts.ventas ?? {})
  vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
    if (table === "cotizaciones") {
      const chain = createChainMock(opts.cotizacion ?? cotizacionBase)
      chain.update = vi.fn((payload: any) => {
        cotizacionesUpdates.push(payload)
        return chain
      })
      return chain as any
    }
    if (table === "ventas") return nuevaVentas() as any
    return createChainMock(null) as any
  })
  return { cotizacionesUpdates }
}

describe("POST /api/cotizaciones/[id]/convertir-venta — una sola conversión", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess()
    vi.mocked(sucursalParaEscritura).mockResolvedValue("suc-A")
  })

  it("manda una clave de idempotencia por cotización y graba venta_id al convertir", async () => {
    const { cotizacionesUpdates } = setup()
    let rpcParams: any = null
    vi.mocked(supabaseAdmin.rpc).mockImplementation((fn: string, p?: any) => {
      if (fn === "convertir_cotizacion_venta_atomica") rpcParams = p
      return Promise.resolve({ data: { ventaId: "venta-1" }, error: null }) as any
    })

    const res = await POST(createPostRequest(body), params("cot-1"))
    const { status } = await parseResponse(res)

    expect(status).toBe(201)
    expect(rpcParams.p_idempotency_key).toBe("cotizacion:cot-1")
    expect(cotizacionesUpdates).toContainEqual({ venta_id: "venta-1" })
  })

  it("devuelve 409 sin crear otra venta si la cotización ya tiene una venta vigente", async () => {
    setup({
      cotizacion: { ...cotizacionBase, venta_id: "venta-1" },
      ventas: { porId: { id: "venta-1", numero_venta: 15, estado: "COMPLETADA" } },
    })

    const res = await POST(createPostRequest(body), params("cot-1"))
    const { status, body: data } = await parseResponse(res)

    expect(status).toBe(409)
    expect(data.numeroVenta).toBe(15)
    expect(data.error).toContain("#15")
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("reconoce conversiones anteriores al control por la observación de la venta", async () => {
    setup({
      ventas: {
        porObservacion: [
          // Otra cotización con número que empieza igual: no cuenta.
          { id: "v-otra", numero_venta: 3, estado: "COMPLETADA", observaciones: "Convertida desde COT-0010" },
          { id: "v-vieja", numero_venta: 4, estado: "COMPLETADA", observaciones: "Convertida desde COT-001. Retira el lunes" },
        ],
      },
    })

    const res = await POST(createPostRequest(body), params("cot-1"))
    const { status, body: data } = await parseResponse(res)

    expect(status).toBe(409)
    expect(data.ventaId).toBe("v-vieja")
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it("permite volver a convertir si la venta anterior se anuló, con una clave nueva", async () => {
    setup({
      cotizacion: { ...cotizacionBase, venta_id: "venta-1" },
      ventas: {
        porId: { id: "venta-1", numero_venta: 15, estado: "ANULADA" },
        porClave: [{ id: "venta-1", numero_venta: 15, estado: "ANULADA" }],
        conteo: 1,
      },
    })
    let rpcParams: any = null
    vi.mocked(supabaseAdmin.rpc).mockImplementation((fn: string, p?: any) => {
      if (fn === "convertir_cotizacion_venta_atomica") rpcParams = p
      return Promise.resolve({ data: { ventaId: "venta-2" }, error: null }) as any
    })

    const res = await POST(createPostRequest(body), params("cot-1"))
    const { status } = await parseResponse(res)

    expect(status).toBe(201)
    expect(rpcParams.p_idempotency_key).toBe("cotizacion:cot-1:1")
  })

  it("una conversión simultánea que choca con el índice de idempotencia responde 409", async () => {
    setup()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: null,
      error: {
        code: "23505",
        message: 'duplicate key value violates unique constraint "ventas_idempotency_key_unique"',
      },
    } as any)

    const res = await POST(createPostRequest(body), params("cot-1"))
    const { status } = await parseResponse(res)

    expect(status).toBe(409)
  })

  it("el rechazo de la migración 327 (P0020) también responde 409", async () => {
    setup()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: null,
      error: { code: "P0020", message: "COTIZACION_YA_CONVERTIDA: venta-1" },
    } as any)

    const res = await POST(createPostRequest(body), params("cot-1"))
    const { status } = await parseResponse(res)

    expect(status).toBe(409)
  })
})
