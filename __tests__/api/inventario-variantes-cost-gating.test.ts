import { describe, it, expect, vi, beforeEach } from "vitest"
import { auth } from "@/lib/auth"
import { supabaseAdmin } from "@/lib/supabase"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createGetRequest,
  createPostRequest,
  parseResponse,
} from "./helpers"

import { GET as getVariante } from "@/app/api/inventario/variantes/[varianteId]/route"
import {
  GET as getVariantesList,
  POST as postVariantes,
} from "@/app/api/inventario/[id]/variantes/route"

function mockTecnico() {
  vi.mocked(auth).mockResolvedValue({
    user: { id: "tecnico-1", organizationId: "org-1", role: "TECNICO", email: "t@t.com" },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } as any)
}

describe("GET /api/inventario/variantes/[varianteId] — cost visibility gated by hasInventarioAccess", () => {
  beforeEach(() => vi.clearAllMocks())

  function ctx(varianteId = "var-1") {
    return { params: Promise.resolve({ varianteId }) }
  }

  const varianteRow = {
    id: "var-1",
    inventario_id: "inv-1",
    nombre: "128GB Negro",
    atributos: {},
    codigo_variante: "V1",
    barcode: null,
    stock: 3,
    stock_reservado: 0,
    precio_compra: 400,
    precio_venta: 1000,
    imagen_url: null,
    imagen_path: null,
    activo: true,
    orden: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  }

  it("includes precioCompra for ADMIN (no behavior change)", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({ inventario_variantes: createChainMock(varianteRow) })

    const res = await getVariante(createGetRequest(), ctx())
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.precioCompra).toBe(400)
  })

  it("strips precioCompra for TECNICO", async () => {
    mockTecnico()
    mockSupabaseFrom({ inventario_variantes: createChainMock(varianteRow) })

    const res = await getVariante(createGetRequest(), ctx())
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.precioCompra).toBeNull()
    expect(body.nombre).toBe("128GB Negro")
  })
})

describe("GET /api/inventario/[id]/variantes — cost visibility gated by hasInventarioAccess", () => {
  beforeEach(() => vi.clearAllMocks())

  function ctx(id = "inv-1") {
    return { params: Promise.resolve({ id }) }
  }

  const varianteRows = [
    {
      id: "var-1",
      inventario_id: "inv-1",
      nombre: "128GB Negro",
      atributos: {},
      codigo_variante: "V1",
      barcode: null,
      stock: 3,
      stock_reservado: 0,
      precio_compra: 400,
      precio_venta: 1000,
      imagen_url: null,
      imagen_path: null,
      activo: true,
      orden: 0,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
  ]
  const parentRow = {
    id: "inv-1",
    nombre: "iPhone 12",
    stock: 3,
    stock_reservado: 0,
    tiene_variantes: true,
    precio_compra: 350,
    precio_venta: 950,
  }

  function wireSupabase() {
    const inventarioVariantesChain = createChainMock(varianteRows)
    const inventarioChain = createChainMock(parentRow)
    inventarioChain.maybeSingle = vi.fn().mockResolvedValue({ data: parentRow, error: null })
    mockSupabaseFrom({
      inventario_variantes: inventarioVariantesChain,
      inventario: inventarioChain,
    })
  }

  it("includes precioCompra for variants and parent for ADMIN (no behavior change)", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    wireSupabase()

    const res = await getVariantesList(createGetRequest(), ctx())
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.data[0].precioCompra).toBe(400)
    expect(body.parent.precioCompra).toBe(350)
  })

  it("strips precioCompra for variants and parent for TECNICO", async () => {
    mockTecnico()
    wireSupabase()

    const res = await getVariantesList(createGetRequest(), ctx())
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.data[0].precioCompra).toBeNull()
    expect(body.parent.precioCompra).toBeNull()
    expect(body.parent.nombre).toBe("iPhone 12")
  })
})

describe("POST /api/inventario/[id]/variantes — bulk-create response gates every row the same way", () => {
  beforeEach(() => vi.clearAllMocks())

  function ctx(id = "inv-1") {
    return { params: Promise.resolve({ id }) }
  }

  function createdRow(suffix: string, precioCompra: number) {
    return {
      id: `var-${suffix}`,
      inventario_id: "inv-1",
      nombre: `Variante ${suffix}`,
      atributos: {},
      codigo_variante: `V${suffix}`,
      barcode: null,
      stock: 1,
      stock_reservado: 0,
      precio_compra: precioCompra,
      precio_venta: 1000,
      imagen_url: null,
      imagen_path: null,
      activo: true,
      orden: 0,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    }
  }

  const createdRows = [createdRow("1", 400), createdRow("2", 500), createdRow("3", 600)]

  const payload = createdRows.map((r) => ({
    nombre: r.nombre,
    codigoVariante: r.codigo_variante,
    precioCompra: Number(r.precio_compra),
    precioVenta: Number(r.precio_venta),
  }))

  // POST is behind requireInventarioAccess, so the caller always has cost
  // access. Every created row must come back with its cost — not just the ones
  // whose array position happens to be truthy.
  it("returns precioCompra for every created variant, including the first", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: { success: true, ids: createdRows.map((r) => r.id), count: createdRows.length },
      error: null,
    } as any)
    mockSupabaseFrom({ inventario_variantes: createChainMock(createdRows) })

    const res = await postVariantes(createPostRequest(payload), ctx())
    const { status, body } = await parseResponse(res)

    expect(status).toBe(201)
    expect(body.data).toHaveLength(3)
    expect(body.data.map((v: any) => v.precioCompra)).toEqual([400, 500, 600])
  })
})
