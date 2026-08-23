import { describe, it, expect, vi, beforeEach } from "vitest"
import { auth } from "@/lib/auth"
import { supabaseAdmin } from "@/lib/supabase"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createGetRequest,
  parseResponse,
} from "./helpers"

import { GET as getKitsList } from "@/app/api/inventario/kits/route"
import { GET as getKitDetail } from "@/app/api/inventario/[id]/kit/route"

function ctx(id = "kit-1") {
  return { params: Promise.resolve({ id }) }
}

function mockTecnico() {
  vi.mocked(auth).mockResolvedValue({
    user: { id: "tecnico-1", organizationId: "org-1", role: "TECNICO", email: "t@t.com" },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } as any)
}

describe("GET /api/inventario/kits — cost visibility gated by hasInventarioAccess", () => {
  beforeEach(() => vi.clearAllMocks())

  const kitRow = {
    id: "kit-1",
    codigo: "K1",
    nombre: "Kit reparación",
    stock: 5,
    stock_reservado: 0,
    precio_compra: 1000,
    precio_venta: 2500,
    tipo_kit: "ENSAMBLADO",
    imagen_url: null,
    categoria: "Kits",
    tipo_dispositivo: "CELULAR",
  }
  const costRows = [{ kit_id: "kit-1", cantidad: 2, componente: { precio_compra: 500 } }]

  function wireSupabase() {
    mockSupabaseFrom({
      inventario: createChainMock([kitRow], null, 1),
      inventario_kit_items: createChainMock(costRows),
    })
  }

  it("includes precioCompra/costoCalculado for ADMIN (no behavior change)", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    wireSupabase()

    const res = await getKitsList(createGetRequest())
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.data[0].precioCompra).toBe(1000)
    expect(body.data[0].costoCalculado).toBe(1000) // 2 * 500
  })

  it("strips precioCompra/costoCalculado for TECNICO", async () => {
    mockTecnico()
    wireSupabase()

    const res = await getKitsList(createGetRequest())
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.data[0].precioCompra).toBeNull()
    expect(body.data[0].costoCalculado).toBeNull()
    expect(body.data[0].nombre).toBe("Kit reparación")
  })
})

describe("GET /api/inventario/[id]/kit — cost visibility gated by hasInventarioAccess", () => {
  beforeEach(() => vi.clearAllMocks())

  const kitRow = {
    id: "kit-1",
    codigo: "K1",
    nombre: "Kit reparación",
    stock: 5,
    stock_reservado: 0,
    precio_compra: 1000,
    precio_venta: 2500,
    es_kit: true,
    tipo_kit: "ENSAMBLADO",
    imagen_url: null,
  }
  const componentesRows = [
    {
      id: "comp-1",
      kit_id: "kit-1",
      componente_id: "inv-2",
      cantidad: 2,
      es_obligatorio: true,
      notas: null,
      orden: 0,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      componente: {
        id: "inv-2",
        codigo: "C2",
        nombre: "Batería",
        stock: 10,
        stock_reservado: 0,
        precio_compra: 500,
        imagen_url: null,
        es_kit: false,
        tipo_kit: null,
      },
    },
  ]

  function wireSupabase() {
    mockSupabaseFrom({
      inventario: createChainMock(kitRow),
      inventario_kit_items: createChainMock(componentesRows),
    })
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: 1000, error: null } as any)
  }

  it("includes per-component and kit cost for ADMIN (no behavior change)", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    wireSupabase()

    const res = await getKitDetail(createGetRequest(), ctx())
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.kit.precioCompra).toBe(1000)
    expect(body.componentes[0].componente.precioCompra).toBe(500)
    expect(body.componentes[0].subtotalCosto).toBe(1000) // 2 * 500
    expect(body.costoCalculado).toBe(1000)
  })

  it("strips per-component and kit cost for TECNICO", async () => {
    mockTecnico()
    wireSupabase()

    const res = await getKitDetail(createGetRequest(), ctx())
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.kit.precioCompra).toBeNull()
    expect(body.componentes[0].componente.precioCompra).toBeNull()
    expect(body.componentes[0].subtotalCosto).toBeNull()
    expect(body.costoCalculado).toBeNull()
    // Composition (what parts make up the kit) stays visible.
    expect(body.componentes[0].componente.nombre).toBe("Batería")
    expect(body.componentes[0].cantidad).toBe(2)
  })
})
