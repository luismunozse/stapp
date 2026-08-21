import { describe, it, expect, vi, beforeEach } from "vitest"
import { auth } from "@/lib/auth"
import {
  createChainMock,
  mockSupabaseFrom,
  createGetRequest,
  parseResponse,
} from "./helpers"

vi.mock("@/lib/audit", () => ({
  createAuditLogger: vi.fn(() => ({ update: vi.fn().mockResolvedValue(undefined) })),
  diffObjects: vi.fn().mockReturnValue({ before: {}, after: {} }),
}))

vi.mock("@/lib/notifications/queue", () => ({
  queueNotification: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/webhooks/dispatcher", () => ({
  emitWebhookEvent: vi.fn().mockResolvedValue(undefined),
}))

import { GET, PUT } from "@/app/api/ordenes/[id]/route"

function ctx(id = "o1") {
  return { params: Promise.resolve({ id }) }
}

function mockRole(role: string, overrides: Record<string, any> = {}) {
  vi.mocked(auth).mockResolvedValue({
    user: {
      id: overrides.userId || "user-1",
      organizationId: "org-1",
      role,
      email: "u@u.com",
      ...overrides,
    },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } as any)
}

const ordenRow = {
  id: "o1",
  organization_id: "org-1",
  tecnico_id: "tec-1",
  clientes: null,
  users: null,
  recibido: null,
  repuestos_orden: [
    {
      id: "rep-1",
      orden_id: "o1",
      inventario_id: "inv-1",
      nombre: null,
      cantidad: 2,
      precio_unitario: 50,
      precio_venta_unitario: 120,
      inventario: {
        id: "inv-1",
        codigo: "C1",
        nombre: "Pantalla",
        stock: 5,
        stock_reservado: 0,
        precio_compra: 50,
        precio_venta: 120,
      },
    },
  ],
  cotizaciones: [
    {
      id: "cot-1",
      estado: "ACEPTADA",
      deleted_at: null,
      items_cotizacion: [
        { cantidad: 1, inventario_id: "inv-2", inventario: { precio_compra: 300 } },
      ],
    },
  ],
  garantias: [],
  organizations: {
    nombre: "Org",
    nombre_mostrar: "Org",
    logo_url: null,
    telefono: null,
    direccion: null,
    comprobante_terminos: null,
    moneda: "ARS",
    zona_horaria: "America/Argentina/Buenos_Aires",
    garantia_dias_default: 30,
  },
}

function wireSupabase(vendedoresAdministranInventario = false) {
  const ordenChain = createChainMock(ordenRow)
  const eventosChain = createChainMock(null)
  const orgChain = createChainMock({ vendedores_administran_inventario: vendedoresAdministranInventario })
  mockSupabaseFrom({
    ordenes_servicio: ordenChain,
    orden_eventos: eventosChain,
    organizations: orgChain,
  })
}

describe("GET /api/ordenes/[id] — inventario purchase cost visibility", () => {
  beforeEach(() => vi.clearAllMocks())

  it("ADMIN sees both repuestos.inventario.precioCompra and cotizaciones items inventario cost (no behavior change)", async () => {
    mockRole("ADMIN")
    wireSupabase()

    const res = await GET(createGetRequest(), ctx())
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.repuestos[0].inventario.precioCompra).toBe(50)
    expect(body.cotizaciones[0].items_cotizacion[0].inventario.precio_compra).toBe(300)
  })

  it("TECNICO (assigned) — both purchase-cost embeds are stripped", async () => {
    mockRole("TECNICO", { userId: "tec-1" })
    wireSupabase()

    const res = await GET(createGetRequest(), ctx())
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.repuestos[0].inventario.precioCompra).toBeNull()
    expect(body.cotizaciones[0].items_cotizacion[0].inventario.precio_compra).toBeNull()
    // Non-cost fields on the same embeds stay intact.
    expect(body.repuestos[0].inventario.nombre).toBe("Pantalla")
  })

  it("VENDEDOR without inventario opt-in — both embeds stripped", async () => {
    mockRole("VENDEDOR")
    wireSupabase(false)

    const res = await GET(createGetRequest(), ctx())
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.repuestos[0].inventario.precioCompra).toBeNull()
    expect(body.cotizaciones[0].items_cotizacion[0].inventario.precio_compra).toBeNull()
  })

  it("VENDEDOR with inventario opt-in — repuestos cost visible, but cotización cost stays ADMIN-only (independent gates)", async () => {
    mockRole("VENDEDOR")
    wireSupabase(true)

    const res = await GET(createGetRequest(), ctx())
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.repuestos[0].inventario.precioCompra).toBe(50)
    expect(body.cotizaciones[0].items_cotizacion[0].inventario.precio_compra).toBeNull()
  })
})

// repuestos_orden.precio_unitario is the purchase cost frozen when the part was
// loaded onto the order — the same number as inventario.precio_compra, just
// stored on a different row. Nulling only the live embed left the frozen copy
// readable by every role.
describe("GET /api/ordenes/[id] — repuesto frozen purchase cost (precioUnitario)", () => {
  beforeEach(() => vi.clearAllMocks())

  it("ADMIN sees precioUnitario (no behavior change)", async () => {
    mockRole("ADMIN")
    wireSupabase()

    const { status, body } = await parseResponse(await GET(createGetRequest(), ctx()))

    expect(status).toBe(200)
    expect(body.repuestos[0].precioUnitario).toBe(50)
  })

  it("TECNICO (assigned) — precioUnitario stripped, non-cost fields and sale price kept", async () => {
    mockRole("TECNICO", { userId: "tec-1" })
    wireSupabase()

    const { status, body } = await parseResponse(await GET(createGetRequest(), ctx()))

    expect(status).toBe(200)
    expect(body.repuestos[0].precioUnitario).toBeNull()
    // What a gated role legitimately needs stays available.
    expect(body.repuestos[0].cantidad).toBe(2)
    expect(body.repuestos[0].precioVentaUnitario).toBe(120)
    expect(body.repuestos[0].inventario.nombre).toBe("Pantalla")
  })

  it("VENDEDOR without inventario opt-in — precioUnitario stripped", async () => {
    mockRole("VENDEDOR")
    wireSupabase(false)

    const { status, body } = await parseResponse(await GET(createGetRequest(), ctx()))

    expect(status).toBe(200)
    expect(body.repuestos[0].precioUnitario).toBeNull()
  })

  it("VENDEDOR with inventario opt-in — precioUnitario visible (same predicate as the embed)", async () => {
    mockRole("VENDEDOR")
    wireSupabase(true)

    const { status, body } = await parseResponse(await GET(createGetRequest(), ctx()))

    expect(status).toBe(200)
    expect(body.repuestos[0].precioUnitario).toBe(50)
  })
})

// costoRepuestosCotizaciones is derived from items_cotizacion[].inventario
// .precio_compra INSIDE formatOrden, before the route nulls those fields. For a
// single-item cotización it is precio_compra × cantidad — the exact number the
// rest of the branch hides.
describe("GET /api/ordenes/[id] — costoRepuestosCotizaciones aggregate", () => {
  beforeEach(() => vi.clearAllMocks())

  it("ADMIN sees the aggregate (no behavior change)", async () => {
    mockRole("ADMIN")
    wireSupabase()

    const { status, body } = await parseResponse(await GET(createGetRequest(), ctx()))

    expect(status).toBe(200)
    expect(body.costoRepuestosCotizaciones).toBe(300)
  })

  it("TECNICO — aggregate is not returned as a number", async () => {
    mockRole("TECNICO", { userId: "tec-1" })
    wireSupabase()

    const { status, body } = await parseResponse(await GET(createGetRequest(), ctx()))

    expect(status).toBe(200)
    expect(body.costoRepuestosCotizaciones).toBeNull()
  })

  it("VENDEDOR with inventario opt-in — aggregate still gated (cotización costs are ADMIN-only)", async () => {
    mockRole("VENDEDOR")
    wireSupabase(true)

    const { status, body } = await parseResponse(await GET(createGetRequest(), ctx()))

    expect(status).toBe(200)
    expect(body.costoRepuestosCotizaciones).toBeNull()
  })
})

// The PUT returns formatOrden(updatedOrden) too. It used to call it with both
// cost gates left at their `true` defaults, safe only because that select
// carries no repuestos_orden/cotizaciones embed — the day anyone adds one, the
// GET's gate is silently undone on the same resource. The gates are resolved
// and passed explicitly so correctness does not depend on the select's shape.
describe("PUT /api/ordenes/[id] — cost gates reach formatOrden", () => {
  beforeEach(() => vi.clearAllMocks())

  const ordenBase = {
    id: "o1",
    numero_orden: 1,
    organization_id: "org-1",
    tecnico_id: "tec-1",
    estado: "RECIBIDO",
    presupuesto: null,
    costo_final: null,
    clientes: { id: "c1", nombre: "Juan", email: "j@test.com", telefono: "123" },
    organizations: { id: "org-1", nombre: "Taller", moneda: "ARS", zona_horaria: "America/Argentina/Buenos_Aires" },
  }

  // Simula el día en que alguien agrega los embeds al select del UPDATE: el
  // gate tiene que seguir en pie sin tocar nada más.
  const updatedConEmbeds = {
    ...ordenBase,
    observaciones: "actualizado",
    repuestos_orden: ordenRow.repuestos_orden,
    cotizaciones: ordenRow.cotizaciones,
  }

  function wirePut(vendedoresAdministranInventario = false) {
    const chain = createChainMock(null)
    let calls = 0
    chain.single = vi.fn().mockImplementation(() => {
      calls++
      return Promise.resolve({
        data: calls === 1 ? ordenBase : updatedConEmbeds,
        error: null,
      })
    })
    mockSupabaseFrom({
      ordenes_servicio: chain,
      orden_eventos: createChainMock(null),
      organizations: createChainMock({ vendedores_administran_inventario: vendedoresAdministranInventario }),
    })
  }

  function putRequest() {
    return new Request("http://localhost:3000/api/ordenes/o1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ observaciones: "actualizado" }),
    })
  }

  it("ADMIN — costs are returned (no behavior change)", async () => {
    mockRole("ADMIN")
    wirePut()

    const { status, body } = await parseResponse(await PUT(putRequest(), ctx()))

    expect(status).toBe(200)
    expect(body.costoRepuestosCotizaciones).toBe(300)
    expect(body.repuestos[0].precioUnitario).toBe(50)
    expect(body.repuestos[0].inventario.precioCompra).toBe(50)
  })

  it("TECNICO (assigned) — both cost gates hold on the PUT response", async () => {
    mockRole("TECNICO", { userId: "tec-1" })
    wirePut()

    const { status, body } = await parseResponse(await PUT(putRequest(), ctx()))

    expect(status).toBe(200)
    expect(body.costoRepuestosCotizaciones).toBeNull()
    expect(body.repuestos[0].precioUnitario).toBeNull()
    expect(body.repuestos[0].inventario.precioCompra).toBeNull()
    // Lo que no es costo sigue disponible.
    expect(body.repuestos[0].cantidad).toBe(2)
    expect(body.repuestos[0].precioVentaUnitario).toBe(120)
  })

  it("VENDEDOR without inventario opt-in — both cost gates hold on the PUT response", async () => {
    mockRole("VENDEDOR")
    wirePut(false)

    const { status, body } = await parseResponse(await PUT(putRequest(), ctx()))

    expect(status).toBe(200)
    expect(body.costoRepuestosCotizaciones).toBeNull()
    expect(body.repuestos[0].precioUnitario).toBeNull()
  })

  // Los dos gates son independientes: el opt-in de inventario no abre el costo
  // de cotización, que es ADMIN-only.
  it("VENDEDOR with inventario opt-in — repuesto cost visible, cotización cost still gated", async () => {
    mockRole("VENDEDOR")
    wirePut(true)

    const { status, body } = await parseResponse(await PUT(putRequest(), ctx()))

    expect(status).toBe(200)
    expect(body.repuestos[0].precioUnitario).toBe(50)
    expect(body.costoRepuestosCotizaciones).toBeNull()
  })
})
