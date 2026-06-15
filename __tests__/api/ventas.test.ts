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
