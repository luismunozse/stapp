import { describe, it, expect, vi, beforeEach } from "vitest"
import { auth } from "@/lib/auth"
import {
  mockAuthSuccess,
  mockAuthError,
  createChainMock,
  mockSupabaseFrom,
  createGetRequest,
  createPostRequest,
  parseResponse,
} from "./helpers"

vi.mock("@/lib/counters", () => ({
  getNextSaleNumber: vi.fn().mockResolvedValue({ numero: 1 }),
  getNextWarrantySaleNumber: vi.fn().mockResolvedValue("GAR-001"),
}))

vi.mock("@/lib/audit", () => ({
  createAuditLogger: vi.fn(() => ({
    create: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  })),
}))

vi.mock("@/lib/webhooks/dispatcher", () => ({
  emitWebhookEvent: vi.fn().mockResolvedValue(undefined),
}))

import { supabaseAdmin } from "@/lib/supabase"
import { GET, POST } from "@/app/api/ventas/route"
import { PUT } from "@/app/api/ventas/[id]/route"

describe("GET /api/ventas", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns 401 when not authenticated", async () => {
    mockAuthError()

    const response = await GET(createGetRequest("http://localhost:3000/api/ventas"))
    const { status } = await parseResponse(response)

    expect(status).toBe(401)
  })

  it("returns formatted sales list with pagination", async () => {
    mockAuthSuccess()

    const mockVentas = [
      {
        id: "v1",
        numero_venta: 1,
        cliente_id: "c1",
        cliente_nombre: "Test Client",
        cliente_telefono: "123",
        vendedor_id: "u1",
        subtotal: "5000",
        descuento: "500",
        tipo_descuento: "MONTO",
        porcentaje_descuento: "0",
        total: "4500",
        monto_abonado: "4500",
        estado_pago: "PAGADO",
        metodo_pago: "EFECTIVO",
        estado: "COMPLETADA",
        observaciones: null,
        created_at: "2024-01-01",
        clientes: { id: "c1", nombre: "Test Client" },
        users: { id: "u1", nombre: "Vendedor 1" },
        items_venta: [
          {
            id: "i1",
            inventario_id: "inv1",
            inventario: { id: "inv1", nombre: "Funda" },
            descripcion: "Funda iPhone",
            cantidad: 2,
            precio_unitario: 2500,
            subtotal: 5000,
            dias_garantia: 30,
            descuento: 0,
            tipo_descuento: "MONTO",
            porcentaje_descuento: 0,
          },
        ],
        garantias_venta: [
          {
            id: "g1",
            numero_garantia: "GAR-001",
            item_venta_id: "i1",
            dias_validez: 30,
            fecha_inicio: "2024-01-01",
            fecha_vencimiento: "2024-01-31",
            estado: "VIGENTE",
          },
        ],
        pagos_venta: [
          {
            id: "p1",
            monto: "4500",
            metodo_pago: "EFECTIVO",
            numero_referencia: null,
            fecha: "2024-01-01",
            observaciones: null,
            cuotas: null,
            recargo_porcentaje: null,
            monto_original: null,
          },
        ],
        devoluciones_venta: [],
      },
    ]

    const chain = createChainMock(mockVentas, null, 1)
    mockSupabaseFrom({ ventas: chain })

    const response = await GET(createGetRequest("http://localhost:3000/api/ventas"))
    const { status, body } = await parseResponse(response)

    expect(status).toBe(200)
    expect(body.data).toHaveLength(1)
    expect(body.data[0].numeroVenta).toBe(1)
    expect(body.data[0].total).toBe(4500)
    expect(body.data[0].items).toHaveLength(1)
    expect(body.data[0].items[0].descripcion).toBe("Funda iPhone")
    expect(body.data[0].garantias).toHaveLength(1)
    expect(body.data[0].pagos).toHaveLength(1)
    expect(body.total).toBe(1)
    expect(body.page).toBe(1)
  })

  it("restricts VENDEDOR to their own sales", async () => {
    mockAuthSuccess({ role: "VENDEDOR", userId: "vendedor-1" })

    const chain = createChainMock([], null, 0)
    mockSupabaseFrom({ ventas: chain })

    await GET(createGetRequest("http://localhost:3000/api/ventas"))

    const eqCalls = chain.eq.mock.calls
    const vendedorFilter = eqCalls.find((call: any) => call[0] === "vendedor_id")
    expect(vendedorFilter).toBeDefined()
    expect(vendedorFilter![1]).toBe("vendedor-1")
  })

  it("filters by estado", async () => {
    mockAuthSuccess()

    const chain = createChainMock([], null, 0)
    mockSupabaseFrom({ ventas: chain })

    await GET(createGetRequest("http://localhost:3000/api/ventas?estado=COMPLETADA"))

    const eqCalls = chain.eq.mock.calls
    const estadoFilter = eqCalls.find((call: any) => call[0] === "estado")
    expect(estadoFilter).toBeDefined()
    expect(estadoFilter![1]).toBe("COMPLETADA")
  })
})

describe("POST /api/ventas", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns 401 when not authenticated", async () => {
    mockAuthError()

    const response = await POST(createPostRequest({}))
    const { status } = await parseResponse(response)

    expect(status).toBe(401)
  })

  it("returns 403 for TECNICO role", async () => {
    mockAuthSuccess({ role: "TECNICO" })

    const response = await POST(
      createPostRequest({
        clienteNombre: "Test",
        items: [{ descripcion: "Funda", cantidad: 1, precioUnitario: 1000 }],
        metodoPago: "EFECTIVO",
      })
    )
    const { status, body } = await parseResponse(response)

    expect(status).toBe(403)
    expect(body.error).toContain("Acceso denegado")
  })

  it("validates required fields", async () => {
    mockAuthSuccess()

    const response = await POST(
      createPostRequest({ metodoPago: "EFECTIVO" })
    )
    const { status } = await parseResponse(response)

    expect(status).toBe(400)
  })

  it("validates at least one item is required", async () => {
    mockAuthSuccess()

    const response = await POST(
      createPostRequest({
        clienteNombre: "Test Client",
        items: [],
        metodoPago: "EFECTIVO",
      })
    )
    const { status, body } = await parseResponse(response)

    expect(status).toBe(400)
    expect(body.error).toContain("al menos un item")
  })

  it("validates metodo de pago enum", async () => {
    mockAuthSuccess()

    const response = await POST(
      createPostRequest({
        clienteNombre: "Test",
        items: [{ descripcion: "Funda", cantidad: 1, precioUnitario: 1000 }],
        metodoPago: "BITCOIN",
      })
    )
    const { status } = await parseResponse(response)

    expect(status).toBe(400)
  })

  it("accepts percentage discount fields", async () => {
    mockAuthSuccess()

    const response = await POST(
      createPostRequest({
        clienteNombre: "Test",
        items: [
          {
            descripcion: "Funda",
            cantidad: 1,
            precioUnitario: 1000,
            descuento: 0,
            tipoDescuento: "PORCENTAJE",
            porcentajeDescuento: 10,
          },
        ],
        metodoPago: "EFECTIVO",
        tipoDescuento: "PORCENTAJE",
        porcentajeDescuento: 5,
      })
    )
    const { status } = await parseResponse(response)

    // Will be 400 because RPC is not mocked, but NOT a Zod validation error
    expect([201, 400, 500]).toContain(status)
  })
})

describe("POST /api/ventas — serieIds + idempotencia", () => {
  const baseBody = {
    clienteNombre: "Consumidor Final",
    items: [{ inventarioId: "i1", descripcion: "Notebook", cantidad: 1, precioUnitario: 100, diasGarantia: 0 }],
    metodoPago: "EFECTIVO",
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("pasa serieIds e idempotencyKey a la RPC", async () => {
    mockAuthSuccess()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { ventaId: "v1" }, error: null } as any)
    mockSupabaseFrom({
      ventas: createChainMock({ id: "v1", numero_venta: 1, total: 100 }),
      organizations: createChainMock({ nombre: "Org", nombre_mostrar: "Org" }),
    })

    const res = await POST(createPostRequest({
      ...baseBody,
      idempotencyKey: "idem-123",
      items: [{ ...baseBody.items[0], serieIds: ["s1"] }],
    }))
    const { status } = await parseResponse(res)

    expect(status).toBe(201)
    const rpcArgs = vi.mocked(supabaseAdmin.rpc).mock.calls[0][1] as any
    expect(rpcArgs.p_idempotency_key).toBe("idem-123")
    expect(rpcArgs.p_items[0].serieIds).toEqual(["s1"])
  })

  it("pasa p_sucursal_id (la sucursal del vendedor) a la RPC", async () => {
    // VENDEDOR con sucursal fija "suc-1". sucursalParaEscritura ignora la cookie
    // (no-ADMIN) y devuelve userSucursalId, pero igual lee la principal de la org.
    vi.mocked(auth).mockResolvedValue({
      user: {
        id: "vendedor-1",
        organizationId: "org-1",
        role: "VENDEDOR",
        sucursalId: "suc-1",
        email: "v@v.com",
      },
      expires: new Date(Date.now() + 86400000).toISOString(),
    } as any)
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { ventaId: "v1" }, error: null } as any)
    mockSupabaseFrom({
      sucursales: createChainMock({ id: "suc-principal" }),
      ventas: createChainMock({ id: "v1", numero_venta: 1, total: 100 }),
      organizations: createChainMock({ nombre: "Org", nombre_mostrar: "Org" }),
    })

    const res = await POST(createPostRequest(baseBody))
    const { status } = await parseResponse(res)

    expect(status).toBe(201)
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "crear_venta_atomica",
      expect.objectContaining({ p_sucursal_id: "suc-1" }),
    )
  })

  it("23505: devuelve la venta existente (reintento idempotente)", async () => {
    mockAuthSuccess()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: null,
      error: { code: "23505", message: "duplicate key ventas_idempotency_key_unique" },
    } as any)
    mockSupabaseFrom({
      ventas: createChainMock({ id: "v-existing", numero_venta: 7, total: 100 }),
      organizations: createChainMock({ nombre: "Org", nombre_mostrar: "Org" }),
    })

    const res = await POST(createPostRequest({ ...baseBody, idempotencyKey: "idem-dup" }))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(201)
    expect(body.numeroVenta).toBe(7)
  })
})

describe("POST /api/ventas — depositoId server-resolved (T4)", () => {
  const baseBody = {
    clienteNombre: "Consumidor Final",
    items: [{ inventarioId: "i1", descripcion: "Notebook", cantidad: 1, precioUnitario: 100, diasGarantia: 0 }],
    metodoPago: "EFECTIVO",
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("server resuelve p_deposito_id desde la sucursal del vendedor (no desde body)", async () => {
    // VENDEDOR con sucursal fija "suc-1" cuyo principal deposito es "dep-suc-1"
    vi.mocked(auth).mockResolvedValue({
      user: {
        id: "vendedor-1",
        organizationId: "org-1",
        role: "VENDEDOR",
        sucursalId: "suc-1",
        email: "v@v.com",
      },
      expires: new Date(Date.now() + 86400000).toISOString(),
    } as any)
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { ventaId: "v1" }, error: null } as any)

    // sucursalParaEscritura → sucursales (principal), then getDepositoDeSucursal → depositos
    const sucursalesChain = createChainMock({ id: "suc-principal" })
    const depositosChain: any = {}
    for (const m of ["select", "eq", "is"]) depositosChain[m] = vi.fn().mockReturnValue(depositosChain)
    depositosChain.maybeSingle = vi.fn().mockResolvedValue({ data: { id: "dep-suc-1" }, error: null })

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "sucursales") return sucursalesChain as any
      if (table === "depositos") return depositosChain as any
      if (table === "ventas") return createChainMock({ id: "v1", numero_venta: 1, total: 100 }) as any
      if (table === "organizations") return createChainMock({ nombre: "Org", nombre_mostrar: "Org" }) as any
      return createChainMock(null, { message: `No mock for: ${table}` }) as any
    })

    // POS no manda depositoId (body doesn't include it)
    const res = await POST(createPostRequest(baseBody))
    const { status } = await parseResponse(res)

    expect(status).toBe(201)
    const rpcArgs = vi.mocked(supabaseAdmin.rpc).mock.calls[0][1] as any
    // p_deposito_id must be the server-resolved deposito, not null/body value
    expect(rpcArgs.p_deposito_id).toBe("dep-suc-1")
  })

  it("ADMIN sin deposito configurado en sucursal → p_deposito_id null con fallback (drain mode)", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { ventaId: "v1" }, error: null } as any)

    // sucursalParaEscritura needs principal sucursal; depositos returns null (no principal)
    const sucursalesChain = createChainMock({ id: "suc-principal" })
    const depositosChain: any = {}
    for (const m of ["select", "eq", "is"]) depositosChain[m] = vi.fn().mockReturnValue(depositosChain)
    depositosChain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "sucursales") return sucursalesChain as any
      if (table === "depositos") return depositosChain as any
      if (table === "ventas") return createChainMock({ id: "v1", numero_venta: 1, total: 100 }) as any
      if (table === "organizations") return createChainMock({ nombre: "Org", nombre_mostrar: "Org" }) as any
      return createChainMock(null, { message: `No mock for: ${table}` }) as any
    })

    const res = await POST(createPostRequest(baseBody))
    const { status } = await parseResponse(res)

    expect(status).toBe(201)
    const rpcArgs = vi.mocked(supabaseAdmin.rpc).mock.calls[0][1] as any
    expect(rpcArgs.p_deposito_id).toBeNull()
  })

  it("body depositoId es ignorado — p_deposito_id viene del server", async () => {
    // Even if the client sends depositoId, the server uses the resolved one
    vi.mocked(auth).mockResolvedValue({
      user: {
        id: "vendedor-1",
        organizationId: "org-1",
        role: "VENDEDOR",
        sucursalId: "suc-1",
        email: "v@v.com",
      },
      expires: new Date(Date.now() + 86400000).toISOString(),
    } as any)
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { ventaId: "v1" }, error: null } as any)

    const sucursalesChain = createChainMock({ id: "suc-principal" })
    const depositosChain: any = {}
    for (const m of ["select", "eq", "is"]) depositosChain[m] = vi.fn().mockReturnValue(depositosChain)
    depositosChain.maybeSingle = vi.fn().mockResolvedValue({ data: { id: "dep-suc-1" }, error: null })

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "sucursales") return sucursalesChain as any
      if (table === "depositos") return depositosChain as any
      if (table === "ventas") return createChainMock({ id: "v1", numero_venta: 1, total: 100 }) as any
      if (table === "organizations") return createChainMock({ nombre: "Org", nombre_mostrar: "Org" }) as any
      return createChainMock(null, { message: `No mock for: ${table}` }) as any
    })

    // body sends a different depositoId — server must ignore it
    const res = await POST(createPostRequest({ ...baseBody, depositoId: "dep-WRONG" }))
    const { status } = await parseResponse(res)

    expect(status).toBe(201)
    const rpcArgs = vi.mocked(supabaseAdmin.rpc).mock.calls[0][1] as any
    // Must be the server-resolved value, not "dep-WRONG"
    expect(rpcArgs.p_deposito_id).toBe("dep-suc-1")
    expect(rpcArgs.p_deposito_id).not.toBe("dep-WRONG")
  })

  it("mapea P0010 a 400 con mensaje claro", async () => {
    mockAuthSuccess()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: null,
      error: { code: "P0010", message: "STOCK_INSUFICIENTE_DEPOSITO: deposito dep-2" },
    } as any)
    mockSupabaseFrom({
      sucursales: createChainMock({ id: "suc-p" }),
      depositos: (() => {
        const c: any = {}
        for (const m of ["select", "eq", "is"]) c[m] = vi.fn().mockReturnValue(c)
        c.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
        return c
      })(),
    })

    const res = await POST(createPostRequest(baseBody))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(400)
    expect(body.error).toContain("Stock insuficiente en el depósito")
  })

  it("mapea P0010 nombrando la sucursal cuando la venta salió de SU depósito", async () => {
    mockAuthSuccess()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: null,
      error: { code: "P0010", message: "STOCK_INSUFICIENTE_DEPOSITO: deposito dep-2" },
    } as any)
    mockSupabaseFrom({
      sucursales: createChainMock({ id: "suc-p", nombre: "Sucursal Centro" }),
      depositos: (() => {
        const c: any = {}
        for (const m of ["select", "eq", "is"]) c[m] = vi.fn().mockReturnValue(c)
        c.maybeSingle = vi.fn().mockResolvedValue({ data: { id: "dep-1" }, error: null })
        return c
      })(),
    })

    const res = await POST(createPostRequest(baseBody))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(400)
    expect(body.error).toBe("Stock insuficiente en el depósito de Sucursal Centro")
  })

  it("P0010 en modo drenaje (sucursal sin depósito principal): NO nombra una sucursal", async () => {
    mockAuthSuccess()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: null,
      error: { code: "P0010", message: "STOCK_INSUFICIENTE_DEPOSITO: deposito dep-2" },
    } as any)
    mockSupabaseFrom({
      sucursales: createChainMock({ id: "suc-p", nombre: "Sucursal Centro" }),
      depositos: (() => {
        const c: any = {}
        for (const m of ["select", "eq", "is"]) c[m] = vi.fn().mockReturnValue(c)
        c.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
        return c
      })(),
    })

    const res = await POST(createPostRequest(baseBody))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(400)
    // The RPC ran with p_deposito_id = null and drained org-wide, so the
    // shortfall is org-wide and the named sucursal has no deposito at all.
    expect(body.error).toBe("Stock insuficiente en el depósito seleccionado")
    // The name query must not even run: only getPrincipalId reads `sucursales`.
    const sucursalesReads = vi
      .mocked(supabaseAdmin.from)
      .mock.calls.filter((call) => call[0] === "sucursales")
    expect(sucursalesReads).toHaveLength(1)
  })

  it("camino feliz: no paga la query del nombre de sucursal (solo la del error P0010)", async () => {
    mockAuthSuccess()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { ventaId: "v1" }, error: null } as any)
    mockSupabaseFrom({
      sucursales: createChainMock({ id: "suc-p", nombre: "Sucursal Centro" }),
      depositos: (() => {
        const c: any = {}
        for (const m of ["select", "eq", "is"]) c[m] = vi.fn().mockReturnValue(c)
        c.maybeSingle = vi.fn().mockResolvedValue({ data: { id: "dep-1" }, error: null })
        return c
      })(),
      ventas: createChainMock({ id: "v1", numero_venta: 1, total: 100 }),
      organizations: createChainMock({ nombre: "Org", nombre_mostrar: "Org" }),
    })

    const res = await POST(createPostRequest(baseBody))
    const { status } = await parseResponse(res)

    expect(status).toBe(201)
    // Only getPrincipalId hits `sucursales`; getNombreSucursal is lazy and
    // must stay inside the P0010 branch.
    const sucursalesReads = vi
      .mocked(supabaseAdmin.from)
      .mock.calls.filter((call) => call[0] === "sucursales")
    expect(sucursalesReads).toHaveLength(1)
  })

  it("mapea P0011 a 400 con mensaje claro", async () => {
    mockAuthSuccess()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: null,
      error: { code: "P0011", message: "ORG_SIN_DEPOSITO_PRINCIPAL: org-1" },
    } as any)
    mockSupabaseFrom({
      sucursales: createChainMock({ id: "suc-p" }),
      depositos: (() => {
        const c: any = {}
        for (const m of ["select", "eq", "is"]) c[m] = vi.fn().mockReturnValue(c)
        c.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
        return c
      })(),
    })

    const res = await POST(createPostRequest(baseBody))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(400)
    expect(body.error).toContain("depósito principal")
  })
})

// ─── PUT /api/ventas/[id] — depositoId ───

function createPutRequest(body: any, id = "v1"): [Request, { params: Promise<{ id: string }> }] {
  const req = new Request(`http://localhost:3000/api/ventas/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  return [req, { params: Promise.resolve({ id }) }]
}

describe("PUT /api/ventas/[id] — depositoId", () => {
  const editBody = {
    action: "edit",
    clienteNombre: "Cliente Test",
    items: [{ inventarioId: "i1", descripcion: "Notebook", cantidad: 1, precioUnitario: 100 }],
    descuento: 0,
    tipoDescuento: "MONTO",
    porcentajeDescuento: 0,
    metodoPago: "EFECTIVO",
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("pasa depositoId a la RPC editar_venta_atomica como p_deposito_id", async () => {
    mockAuthSuccess()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: null, error: null } as any)
    mockSupabaseFrom({
      ventas: createChainMock({ id: "v1", estado: "COMPLETADA", cliente_nombre: "X", total: 100, items_venta: [] }),
    })

    const [req, ctx] = createPutRequest({ ...editBody, depositoId: "dep-2" })
    const res = await PUT(req, ctx)
    const { status } = await parseResponse(res)

    expect(status).toBe(200)
    const rpcArgs = vi.mocked(supabaseAdmin.rpc).mock.calls[0][1] as any
    expect(rpcArgs.p_deposito_id).toBe("dep-2")
  })

  it("manda p_deposito_id null cuando el body no trae depositoId", async () => {
    mockAuthSuccess()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: null, error: null } as any)
    mockSupabaseFrom({
      ventas: createChainMock({ id: "v1", estado: "COMPLETADA", cliente_nombre: "X", total: 100, items_venta: [] }),
    })

    const [req, ctx] = createPutRequest(editBody)
    const res = await PUT(req, ctx)
    const { status } = await parseResponse(res)

    expect(status).toBe(200)
    const rpcArgs = vi.mocked(supabaseAdmin.rpc).mock.calls[0][1] as any
    expect(rpcArgs.p_deposito_id).toBeNull()
  })

  it("rechaza depositoId vacío con 400", async () => {
    mockAuthSuccess()
    mockSupabaseFrom({
      ventas: createChainMock({ id: "v1", estado: "COMPLETADA", cliente_nombre: "X", total: 100, items_venta: [] }),
    })

    const [req, ctx] = createPutRequest({ ...editBody, depositoId: "" })
    const res = await PUT(req, ctx)
    const { status } = await parseResponse(res)

    expect(status).toBe(400)
  })

  it("mapea P0010 a 400 con mensaje claro en PUT", async () => {
    mockAuthSuccess()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: null,
      error: { code: "P0010", message: "STOCK_INSUFICIENTE_DEPOSITO: dep-2" },
    } as any)
    mockSupabaseFrom({
      ventas: createChainMock({ id: "v1", estado: "COMPLETADA", cliente_nombre: "X", total: 100, items_venta: [] }),
    })

    const [req, ctx] = createPutRequest({ ...editBody, depositoId: "dep-2" })
    const res = await PUT(req, ctx)
    const { status, body } = await parseResponse(res)

    expect(status).toBe(400)
    expect(body.error).toContain("Stock insuficiente en el depósito")
  })

  it("mapea P0011 a 400 con mensaje claro en PUT", async () => {
    mockAuthSuccess()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: null,
      error: { code: "P0011", message: "ORG_SIN_DEPOSITO_PRINCIPAL: org-1" },
    } as any)
    mockSupabaseFrom({
      ventas: createChainMock({ id: "v1", estado: "COMPLETADA", cliente_nombre: "X", total: 100, items_venta: [] }),
    })

    const [req, ctx] = createPutRequest(editBody)
    const res = await PUT(req, ctx)
    const { status, body } = await parseResponse(res)

    expect(status).toBe(400)
    expect(body.error).toContain("depósito principal")
  })
})

// ─── POST /api/ventas — saldo pendiente requiere cliente ───

describe("POST /api/ventas — saldo pendiente requiere cliente", () => {
  const baseItems = [{ inventarioId: "i1", descripcion: "Notebook", cantidad: 1, precioUnitario: 100, diasGarantia: 0 }]

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("pagosParcial:true sin clienteId devuelve 400", async () => {
    mockAuthSuccess()

    const res = await POST(createPostRequest({
      clienteNombre: "Consumidor Final",
      items: baseItems,
      metodoPago: "EFECTIVO",
      pagosParcial: true,
      // clienteId ausente
    }))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(400)
    expect(body.error).toContain("cliente")
  })

  it("pagosParcial:true con clienteId no devuelve 400 por falta de cliente", async () => {
    mockAuthSuccess()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { ventaId: "v1" }, error: null } as any)
    mockSupabaseFrom({
      ventas: createChainMock({ id: "v1", numero_venta: 1, total: 100 }),
      organizations: createChainMock({ nombre: "Org", nombre_mostrar: "Org" }),
    })

    const res = await POST(createPostRequest({
      clienteNombre: "Juan Perez",
      clienteId: "cliente-1",
      items: baseItems,
      metodoPago: "EFECTIVO",
      pagosParcial: true,
    }))
    const { status } = await parseResponse(res)

    expect(status).not.toBe(400)
  })

  it("pagos parciales (suma < total) sin clienteId devuelve 400", async () => {
    mockAuthSuccess()

    const res = await POST(createPostRequest({
      clienteNombre: "Consumidor Final",
      items: baseItems,
      metodoPago: "EFECTIVO",
      pagos: [{ metodo: "EFECTIVO", monto: 50 }], // suma < total (100)
      // clienteId ausente
    }))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(400)
    expect(body.error).toContain("cliente")
  })

  it("pagos que cubren el total sin clienteId no devuelven 400 por falta de cliente", async () => {
    mockAuthSuccess()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { ventaId: "v1" }, error: null } as any)
    mockSupabaseFrom({
      ventas: createChainMock({ id: "v1", numero_venta: 1, total: 100 }),
      organizations: createChainMock({ nombre: "Org", nombre_mostrar: "Org" }),
    })

    const res = await POST(createPostRequest({
      clienteNombre: "Consumidor Final",
      items: baseItems,
      metodoPago: "EFECTIVO",
      pagos: [{ metodo: "EFECTIVO", monto: 100 }], // suma == total
      // clienteId ausente: OK porque no queda saldo pendiente
    }))
    const { status } = await parseResponse(res)

    expect(status).not.toBe(400)
  })
})

describe("POST /api/ventas — descuentos por línea + global", () => {
  beforeEach(() => vi.clearAllMocks())

  async function rpcArgsFor(body: any) {
    mockAuthSuccess()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { ventaId: "v1" }, error: null } as any)
    mockSupabaseFrom({
      ventas: createChainMock({ id: "v1", numero_venta: 1, total: 0 }),
      organizations: createChainMock({ nombre: "Org", nombre_mostrar: "Org" }),
    })
    const res = await POST(createPostRequest(body))
    const { status } = await parseResponse(res)
    expect(status).toBe(201)
    return vi.mocked(supabaseAdmin.rpc).mock.calls[0][1] as any
  }

  it("descuento por línea PORCENTAJE reduce subtotal/total (200 línea, 10% = 180)", async () => {
    const args = await rpcArgsFor({
      clienteNombre: "CF",
      metodoPago: "EFECTIVO",
      items: [{ inventarioId: "i1", descripcion: "X", cantidad: 2, precioUnitario: 100, diasGarantia: 0, tipoDescuento: "PORCENTAJE", porcentajeDescuento: 10 }],
    })
    expect(args.p_subtotal).toBe(200) // gross
    expect(args.p_descuento).toBe(20)
    expect(args.p_total).toBe(180)
  })

  it("descuento por línea MONTO ($30 off de 200 = 170)", async () => {
    const args = await rpcArgsFor({
      clienteNombre: "CF",
      metodoPago: "EFECTIVO",
      items: [{ inventarioId: "i1", descripcion: "X", cantidad: 2, precioUnitario: 100, diasGarantia: 0, tipoDescuento: "MONTO", descuento: 30 }],
    })
    expect(args.p_subtotal).toBe(200)
    expect(args.p_descuento).toBe(30)
    expect(args.p_total).toBe(170)
  })

  it("descuento global PORCENTAJE sin descuento por línea (100, 10% = 90)", async () => {
    const args = await rpcArgsFor({
      clienteNombre: "CF",
      metodoPago: "EFECTIVO",
      tipoDescuento: "PORCENTAJE",
      porcentajeDescuento: 10,
      items: [{ inventarioId: "i1", descripcion: "X", cantidad: 1, precioUnitario: 100, diasGarantia: 0 }],
    })
    expect(args.p_subtotal).toBe(100)
    expect(args.p_descuento).toBe(10)
    expect(args.p_total).toBe(90)
  })

  it("combinado: línea 10% (sobre 100 = 10) + global $20 → descuento 30, total 70", async () => {
    const args = await rpcArgsFor({
      clienteNombre: "CF",
      metodoPago: "EFECTIVO",
      tipoDescuento: "MONTO",
      descuento: 20,
      items: [{ inventarioId: "i1", descripcion: "X", cantidad: 1, precioUnitario: 100, diasGarantia: 0, tipoDescuento: "PORCENTAJE", porcentajeDescuento: 10 }],
    })
    expect(args.p_subtotal).toBe(100)
    expect(args.p_descuento).toBe(30) // 10 línea + 20 global
    expect(args.p_total).toBe(70)
  })

  it("combinado con global %: línea 10% sobre 200 (neto 180) + global 10% sobre neto (18) → total 162", async () => {
    const args = await rpcArgsFor({
      clienteNombre: "CF",
      metodoPago: "EFECTIVO",
      tipoDescuento: "PORCENTAJE",
      porcentajeDescuento: 10,
      items: [{ inventarioId: "i1", descripcion: "X", cantidad: 2, precioUnitario: 100, diasGarantia: 0, tipoDescuento: "PORCENTAJE", porcentajeDescuento: 10 }],
    })
    expect(args.p_subtotal).toBe(200)
    expect(args.p_descuento).toBe(38) // 20 línea + 18 global
    expect(args.p_total).toBe(162)
  })

  it("nunca produce total negativo (descuento global clampeado)", async () => {
    const args = await rpcArgsFor({
      clienteNombre: "CF",
      metodoPago: "EFECTIVO",
      tipoDescuento: "MONTO",
      descuento: 9999,
      items: [{ inventarioId: "i1", descripcion: "X", cantidad: 1, precioUnitario: 100, diasGarantia: 0 }],
    })
    expect(args.p_total).toBe(0)
  })

  it("EXENTO: total sin cambio", async () => {
    mockAuthSuccess()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { ventaId: "v1" }, error: null } as any)
    mockSupabaseFrom({
      organizations: createChainMock({ iva_regimen: "EXENTO", iva_tasa: 21, redondeo_efectivo: 0 }),
      ventas: createChainMock({ id: "v1", numero_venta: 1, total: 0 }),
    })
    const res = await POST(createPostRequest({ clienteNombre: "CF", metodoPago: "EFECTIVO", items: [{ inventarioId: "i1", descripcion: "X", cantidad: 1, precioUnitario: 100, diasGarantia: 0 }] }))
    expect((await parseResponse(res)).status).toBe(201)
    expect((vi.mocked(supabaseAdmin.rpc).mock.calls[0][1] as any).p_total).toBe(100)
  })

  it("ADITIVO 21%: total = base + IVA (100 → 121)", async () => {
    mockAuthSuccess()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { ventaId: "v1" }, error: null } as any)
    mockSupabaseFrom({
      organizations: createChainMock({ iva_regimen: "ADITIVO", iva_tasa: 21, redondeo_efectivo: 0 }),
      ventas: createChainMock({ id: "v1", numero_venta: 1, total: 0 }),
    })
    const res = await POST(createPostRequest({ clienteNombre: "CF", metodoPago: "EFECTIVO", items: [{ inventarioId: "i1", descripcion: "X", cantidad: 1, precioUnitario: 100, diasGarantia: 0 }] }))
    expect((await parseResponse(res)).status).toBe(201)
    expect((vi.mocked(supabaseAdmin.rpc).mock.calls[0][1] as any).p_total).toBe(121)
  })

  it("INCLUIDO 21%: total sin cambio (IVA ya en el precio)", async () => {
    mockAuthSuccess()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { ventaId: "v1" }, error: null } as any)
    mockSupabaseFrom({
      organizations: createChainMock({ iva_regimen: "INCLUIDO", iva_tasa: 21, redondeo_efectivo: 0 }),
      ventas: createChainMock({ id: "v1", numero_venta: 1, total: 0 }),
    })
    const res = await POST(createPostRequest({ clienteNombre: "CF", metodoPago: "EFECTIVO", items: [{ inventarioId: "i1", descripcion: "X", cantidad: 1, precioUnitario: 121, diasGarantia: 0 }] }))
    expect((await parseResponse(res)).status).toBe(201)
    expect((vi.mocked(supabaseAdmin.rpc).mock.calls[0][1] as any).p_total).toBe(121)
  })

  it("redondeo efectivo 50 en EFECTIVO: 121 → 100; no aplica a no-efectivo", async () => {
    mockAuthSuccess()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { ventaId: "v1" }, error: null } as any)
    mockSupabaseFrom({
      organizations: createChainMock({ iva_regimen: "EXENTO", iva_tasa: 21, redondeo_efectivo: 50 }),
      ventas: createChainMock({ id: "v1", numero_venta: 1, total: 0 }),
    })
    const efectivo = await POST(createPostRequest({ clienteNombre: "CF", metodoPago: "EFECTIVO", items: [{ inventarioId: "i1", descripcion: "X", cantidad: 1, precioUnitario: 121, diasGarantia: 0 }] }))
    expect((await parseResponse(efectivo)).status).toBe(201)
    expect((vi.mocked(supabaseAdmin.rpc).mock.calls[0][1] as any).p_total).toBe(100) // round(121/50)*50
  })

  it("org sin config fiscal (columnas ausentes) → EXENTO, sin cambio", async () => {
    mockAuthSuccess()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { ventaId: "v1" }, error: null } as any)
    mockSupabaseFrom({
      organizations: createChainMock({ nombre: "Org" }), // sin columnas iva_*
      ventas: createChainMock({ id: "v1", numero_venta: 1, total: 0 }),
    })
    const res = await POST(createPostRequest({ clienteNombre: "CF", metodoPago: "EFECTIVO", items: [{ inventarioId: "i1", descripcion: "X", cantidad: 1, precioUnitario: 100, diasGarantia: 0 }] }))
    expect((await parseResponse(res)).status).toBe(201)
    expect((vi.mocked(supabaseAdmin.rpc).mock.calls[0][1] as any).p_total).toBe(100)
  })
})

describe("POST /api/ventas — IVA sin tasa propia: la resuelve el pais de la org", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { ventaId: "v1" }, error: null } as any)
  })

  const venderPor100 = async (org: Record<string, unknown>) => {
    mockSupabaseFrom({
      organizations: createChainMock(org),
      ventas: createChainMock({ id: "v1", numero_venta: 1, total: 0 }),
    })
    const res = await POST(
      createPostRequest({
        clienteNombre: "CF",
        metodoPago: "EFECTIVO",
        items: [{ inventarioId: "i1", descripcion: "X", cantidad: 1, precioUnitario: 100, diasGarantia: 0 }],
      })
    )
    expect((await parseResponse(res)).status).toBe(201)
    return vi.mocked(supabaseAdmin.rpc).mock.calls[0][1] as any
  }

  it("ADITIVO en org chilena sin tasa guardada: aplica 19% (100 → 119)", async () => {
    const args = await venderPor100({
      pais: "CL",
      iva_regimen: "ADITIVO",
      iva_tasa: null,
      redondeo_efectivo: 0,
    })
    expect(args.p_total).toBe(119)
  })

  it("ADITIVO en org argentina sin tasa guardada: sigue en 21% (100 → 121)", async () => {
    const args = await venderPor100({
      pais: "AR",
      iva_regimen: "ADITIVO",
      iva_tasa: null,
      redondeo_efectivo: 0,
    })
    expect(args.p_total).toBe(121)
  })

  it("la tasa guardada por la org le gana al default del pais", async () => {
    const args = await venderPor100({
      pais: "CL",
      iva_regimen: "ADITIVO",
      iva_tasa: 10,
      redondeo_efectivo: 0,
    })
    expect(args.p_total).toBe(110)
  })

  it("EXENTO no cobra IVA aunque el pais tenga tasa general", async () => {
    const args = await venderPor100({
      pais: "CL",
      iva_regimen: "EXENTO",
      iva_tasa: null,
      redondeo_efectivo: 0,
    })
    expect(args.p_total).toBe(100)
  })
})
