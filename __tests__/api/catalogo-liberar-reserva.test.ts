import { describe, it, expect, beforeEach, vi } from "vitest"
import {
  mockAuthSuccess,
  mockSupabaseFrom,
  createChainMock,
  createPostRequest,
  parseResponse,
} from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

// La reserva del catálogo la toma un visitante anónimo. Si no hay forma de
// devolverla, cambiar "descuento" por "reserva" no arregla nada: el stock
// queda inmovilizado para siempre y el comprador sigue viendo "Agotado".
//
// La devolución la dispara el trigger cotizaciones_liberar_reserva_catalogo
// (migración 314) sobre la transición a estado terminal, así que ninguna de las
// cuatro rutas que matan una cotización tiene que acordarse de llamar. Lo que
// se prueba acá es lo que el trigger NO puede cubrir: que esas rutas sigan
// escribiendo la transición, y las reglas que viven en la app.

vi.mock("@/lib/orden-transicion", () => ({ transicionarOrden: vi.fn() }))
vi.mock("@/lib/audit", () => ({
  createAuditLogger: () => ({ create: vi.fn(), update: vi.fn(), delete: vi.fn() }),
}))
vi.mock("@/lib/cotizacion-aprobar-orden", () => ({
  aplicarAprobacionCotizacionAOrden: vi.fn(),
}))
vi.mock("@/lib/webhooks/dispatcher", () => ({ emitWebhookEvent: vi.fn() }))
vi.mock("@/lib/subscriptions", () => ({ hasPlanFeature: vi.fn(() => Promise.resolve(true)) }))

function rpcNames() {
  return vi.mocked(supabaseAdmin.rpc).mock.calls.map((c) => c[0])
}

describe("liberación de la reserva del catálogo", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN" })
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { ok: true }, error: null } as any)
  })

  it("refuses to walk a rejected catalog quote back to a live state", async () => {
    // Al rechazar se devolvio el stock. Reabrirla deja una solicitud viva
    // reteniendo cero: el storefront ofrece unidades que esa solicitud cree
    // tener. Para el catalogo lo correcto es una solicitud nueva.
    const { PUT } = await import("@/app/api/cotizaciones/[id]/route")

    mockSupabaseFrom({
      cotizaciones: createChainMock({
        id: "cot-1",
        estado: "RECHAZADA",
        tipo: "PRESUPUESTO",
        origen: "CATALOGO_PUBLICO",
        organization_id: "org-1",
        created_by: "user-1",
        orden_id: null,
        iva_porcentaje: 0,
        descuento_global_tipo: "porcentaje",
        descuento_global_valor: 0,
      }),
    })

    const req = new Request("http://localhost/api/cotizaciones/cot-1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ estado: "ENVIADA" }),
    })

    const res = await PUT(req, { params: Promise.resolve({ id: "cot-1" }) })
    const { status, body } = await parseResponse(res)

    expect(status).toBe(400)
    expect(body.error).toMatch(/rechazada/i)
  })

  it("still rejects from the public link (the release rides on the estado write)", async () => {
    // La liberación la hace el trigger de la migración 314 sobre el UPDATE de
    // estado, así que acá sólo se verifica que ese UPDATE siga ocurriendo: si
    // esta ruta dejara de escribir RECHAZADA, el trigger no tendría de qué
    // colgarse.
    const { POST } = await import("@/app/api/public/cotizaciones/[token]/rechazar/route")

    const cotChain = createChainMock({
      id: "cot-1",
      estado: "ENVIADA",
      orden_id: null,
      organization_id: "org-1",
    })
    mockSupabaseFrom({ cotizaciones: cotChain })

    const req = createPostRequest({ motivo: "no me sirve" })
    const res = await POST(req, { params: Promise.resolve({ token: "a".repeat(32) }) })

    expect(res.status).toBe(200)
    const updates = cotChain.update.mock.calls.map((c) => c[0])
    expect(updates.some((u: any) => u?.estado === "RECHAZADA")).toBe(true)
  })
})

describe("PUT /api/cotizaciones/[id] — editar items no borra la procedencia", () => {
  // El PUT borra todas las filas de items_cotizacion y reinserta. Si la
  // reinserción no repone catalogo_item_id / variante_id / variante_etiqueta,
  // después de cualquier edición de admin sobre una solicitud del catálogo la
  // restitución de variantes no matchea nada: el stock queda sin devolver.
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN" })
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { ok: true }, error: null } as any)
  })

  it("carries catalogo_item_id, variante_id and variante_etiqueta onto the new rows", async () => {
    const { PUT } = await import("@/app/api/cotizaciones/[id]/route")

    const itemsChain = createChainMock([
      {
        id: "it-1",
        descripcion: "Pantalla — Rojo",
        costo_unitario: null,
        inventario_id: null,
        catalogo_item_id: "cat-1",
        variante_id: "var-1",
        variante_etiqueta: "Rojo",
      },
    ])

    mockSupabaseFrom({
      cotizaciones: createChainMock({
        id: "cot-1",
        estado: "ENVIADA",
        tipo: "PRESUPUESTO",
        organization_id: "org-1",
        created_by: "user-1",
        orden_id: null,
        iva_porcentaje: 0,
        descuento_global_tipo: "porcentaje",
        descuento_global_valor: 0,
      }),
      items_cotizacion: itemsChain,
    })

    const req = new Request("http://localhost/api/cotizaciones/cot-1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [
          { id: "it-1", descripcion: "Pantalla — Rojo", cantidad: 2, precioUnitario: 100 },
        ],
      }),
    })

    await PUT(req, { params: Promise.resolve({ id: "cot-1" }) })

    const insertados = itemsChain.insert.mock.calls.at(-1)?.[0] as any[]
    expect(insertados).toBeDefined()
    expect(insertados[0]).toMatchObject({
      catalogo_item_id: "cat-1",
      variante_id: "var-1",
      variante_etiqueta: "Rojo",
    })
  })

  it("leaves the provenance columns null for a genuinely new line", async () => {
    const { PUT } = await import("@/app/api/cotizaciones/[id]/route")

    const itemsChain = createChainMock([])

    mockSupabaseFrom({
      cotizaciones: createChainMock({
        id: "cot-1",
        estado: "ENVIADA",
        tipo: "PRESUPUESTO",
        organization_id: "org-1",
        created_by: "user-1",
        orden_id: null,
        iva_porcentaje: 0,
        descuento_global_tipo: "porcentaje",
        descuento_global_valor: 0,
      }),
      items_cotizacion: itemsChain,
    })

    const req = new Request("http://localhost/api/cotizaciones/cot-1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ descripcion: "Mano de obra", cantidad: 1, precioUnitario: 500 }],
      }),
    })

    await PUT(req, { params: Promise.resolve({ id: "cot-1" }) })

    const insertados = itemsChain.insert.mock.calls.at(-1)?.[0] as any[]
    expect(insertados[0].catalogo_item_id).toBeNull()
    expect(insertados[0].variante_id).toBeNull()
  })
})
