/**
 * GET /api/ordenes formats every row with formatOrden. It used to call it with
 * both cost gates left at their `true` defaults, safe only because that select
 * carries no repuestos_orden/cotizaciones embed — the day anyone adds one, the
 * detail route's gate is silently undone on the list. The gates are resolved
 * from the actor's role and passed explicitly, so correctness no longer depends
 * on the select's shape.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { auth } from "@/lib/auth"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createGetRequest,
  parseResponse,
} from "./helpers"

vi.mock("@/lib/sucursal", () => ({
  sucursalParaLectura: vi.fn().mockResolvedValue({ verTodas: true, sucursalId: null }),
}))

import { GET } from "@/app/api/ordenes/route"

function mockRole(role: string, userId = "user-1") {
  vi.mocked(auth).mockResolvedValue({
    user: { id: userId, organizationId: "org-1", role, email: "u@u.com" },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } as any)
}

// Simula el día en que alguien agrega los embeds al select de la lista: los
// gates tienen que seguir en pie sin tocar nada más.
const ordenRow = {
  id: "o1",
  numero_orden: 1,
  organization_id: "org-1",
  tecnico_id: "tec-1",
  estado: "RECIBIDO",
  clientes: null,
  users: null,
  repuestos_orden: [
    {
      id: "rep-1",
      orden_id: "o1",
      inventario_id: "inv-1",
      cantidad: 2,
      precio_unitario: 50,
      precio_venta_unitario: 120,
      inventario: { id: "inv-1", nombre: "Pantalla", stock: 5, precio_compra: 50, precio_venta: 120 },
    },
  ],
  cotizaciones: [
    {
      id: "cot-1",
      estado: "ACEPTADA",
      deleted_at: null,
      items_cotizacion: [{ cantidad: 1, inventario_id: "inv-2", inventario: { precio_compra: 300 } }],
    },
  ],
}

function wire(vendedoresAdministranInventario = false) {
  mockSupabaseFrom({
    ordenes_servicio: createChainMock([ordenRow], null, 1),
    organizations: createChainMock({ vendedores_administran_inventario: vendedoresAdministranInventario }),
  })
}

describe("GET /api/ordenes — cost gates reach formatOrden", () => {
  beforeEach(() => vi.clearAllMocks())

  it("ADMIN — costs are returned (no behavior change)", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    wire()

    const { status, body } = await parseResponse(await GET(createGetRequest("http://localhost:3000/api/ordenes")))

    expect(status).toBe(200)
    expect(body.data[0].costoRepuestosCotizaciones).toBe(300)
    expect(body.data[0].repuestos[0].precioUnitario).toBe(50)
    expect(body.data[0].repuestos[0].inventario.precioCompra).toBe(50)
  })

  it("TECNICO — both cost gates hold on every row", async () => {
    mockRole("TECNICO", "tec-1")
    wire()

    const { status, body } = await parseResponse(await GET(createGetRequest("http://localhost:3000/api/ordenes")))

    expect(status).toBe(200)
    expect(body.data[0].costoRepuestosCotizaciones).toBeNull()
    expect(body.data[0].repuestos[0].precioUnitario).toBeNull()
    expect(body.data[0].repuestos[0].inventario.precioCompra).toBeNull()
    // Lo que no es costo sigue disponible.
    expect(body.data[0].repuestos[0].cantidad).toBe(2)
    expect(body.data[0].repuestos[0].precioVentaUnitario).toBe(120)
  })

  it("VENDEDOR without inventario opt-in — both cost gates hold", async () => {
    mockRole("VENDEDOR")
    wire(false)

    const { status, body } = await parseResponse(await GET(createGetRequest("http://localhost:3000/api/ordenes")))

    expect(status).toBe(200)
    expect(body.data[0].costoRepuestosCotizaciones).toBeNull()
    expect(body.data[0].repuestos[0].precioUnitario).toBeNull()
  })

  // Los dos gates son independientes: el opt-in de inventario no abre el costo
  // de cotización, que es ADMIN-only.
  it("VENDEDOR with inventario opt-in — repuesto cost visible, cotización cost still gated", async () => {
    mockRole("VENDEDOR")
    wire(true)

    const { status, body } = await parseResponse(await GET(createGetRequest("http://localhost:3000/api/ordenes")))

    expect(status).toBe(200)
    expect(body.data[0].repuestos[0].precioUnitario).toBe(50)
    expect(body.data[0].costoRepuestosCotizaciones).toBeNull()
  })
})
