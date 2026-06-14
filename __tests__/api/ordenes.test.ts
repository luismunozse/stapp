import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextResponse } from "next/server"
import {
  mockAuthSuccess,
  mockAuthError,
  createChainMock,
  mockSupabaseFrom,
  createGetRequest,
  createPostRequest,
  parseResponse,
} from "./helpers"

vi.mock("@/lib/plan-limits", () => ({
  enforcePlanLimit: vi.fn().mockResolvedValue(null),
}))

vi.mock("@/lib/counters", () => ({
  getNextOrderNumberByType: vi.fn().mockResolvedValue({ codigo: "CEL-001", numero: 1 }),
}))

vi.mock("@/lib/audit", () => ({
  createAuditLogger: vi.fn(() => ({
    create: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
  })),
}))

vi.mock("@/lib/storage", () => ({
  uploadOrderPhoto: vi.fn().mockResolvedValue({ url: "http://example.com/photo.jpg", path: "photos/1.jpg" }),
  base64ToBuffer: vi.fn().mockReturnValue(Buffer.from("fake")),
}))

vi.mock("@/lib/push/send", () => ({
  sendPushToUsers: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/notifications/queue", () => ({
  queueNotification: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/tipos-dispositivo-config", () => ({
  tipoValidaImei: vi.fn(),
}))

import { enforcePlanLimit } from "@/lib/plan-limits"
import { auth } from "@/lib/auth"
import { GET, POST } from "@/app/api/ordenes/route"
import { queueNotification } from "@/lib/notifications/queue"
import { tipoValidaImei } from "@/lib/tipos-dispositivo-config"

describe("GET /api/ordenes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns 401 when not authenticated", async () => {
    mockAuthError()

    const response = await GET(createGetRequest("http://localhost:3000/api/ordenes"))
    const { status, body } = await parseResponse(response)

    expect(status).toBe(401)
    expect(body.error).toBe("No autorizado")
  })

  it("returns paginated orders with formatted data", async () => {
    mockAuthSuccess()

    const mockOrdenes = [
      {
        id: "o1",
        numero_orden: 1,
        codigo_orden: "CEL-001",
        cliente_id: "c1",
        tecnico_id: "t1",
        organization_id: "org-1",
        tipo_dispositivo: "CELULAR",
        dispositivo: "iPhone 13",
        problema_reportado: "Pantalla rota",
        costo_final: 5000,
        fecha_ingreso: "2024-01-01",
        fecha_prometida: null,
        fecha_completado: null,
        estado: "RECIBIDO",
        password_dispositivo: null,
        marca: "Apple",
        clientes: { id: "c1", nombre: "Juan" },
        users: { id: "t1", nombre: "Pedro" },
      },
    ]

    const chain = createChainMock(mockOrdenes, null, 1)
    chain.range = vi.fn().mockReturnValue(chain)
    chain.then = (resolve: any) => resolve({ data: mockOrdenes, error: null, count: 1 })
    mockSupabaseFrom({ clientes: createChainMock([]), ordenes_servicio: chain })

    const response = await GET(createGetRequest("http://localhost:3000/api/ordenes"))
    const { status, body } = await parseResponse(response)

    expect(status).toBe(200)
    expect(body.data).toHaveLength(1)
    expect(body.data[0].numeroOrden).toBe(1)
    expect(body.data[0].codigoOrden).toBe("CEL-001")
    expect(body.data[0].cliente).toMatchObject({ id: "c1", nombre: "Juan" })
    expect(body.total).toBe(1)
    expect(body.page).toBe(1)
  })

  it("filters by estado when provided", async () => {
    mockAuthSuccess()

    const chain = createChainMock([], null, 0)
    chain.range = vi.fn().mockReturnValue(chain)
    chain.then = (resolve: any) => resolve({ data: [], error: null, count: 0 })
    mockSupabaseFrom({ clientes: createChainMock([]), ordenes_servicio: chain })

    await GET(createGetRequest("http://localhost:3000/api/ordenes?estado=RECIBIDO"))

    expect(chain.eq).toHaveBeenCalledTimes(2)
  })

  it("restricts TECNICO to only their assigned orders", async () => {
    mockAuthSuccess({ role: "TECNICO", userId: "tecnico-1" })

    const chain = createChainMock([], null, 0)
    chain.range = vi.fn().mockReturnValue(chain)
    chain.then = (resolve: any) => resolve({ data: [], error: null, count: 0 })
    mockSupabaseFrom({ clientes: createChainMock([]), ordenes_servicio: chain })

    await GET(createGetRequest("http://localhost:3000/api/ordenes"))

    const eqCalls = chain.eq.mock.calls
    const tecnicoFilter = eqCalls.find((call: any) => call[0] === "tecnico_id")
    expect(tecnicoFilter).toBeDefined()
    expect(tecnicoFilter![1]).toBe("tecnico-1")
  })

  it("sets no-cache headers", async () => {
    mockAuthSuccess()
    const chain = createChainMock([], null, 0)
    chain.range = vi.fn().mockReturnValue(chain)
    chain.then = (resolve: any) => resolve({ data: [], error: null, count: 0 })
    mockSupabaseFrom({ clientes: createChainMock([]), ordenes_servicio: chain })

    const response = await GET(createGetRequest("http://localhost:3000/api/ordenes"))

    expect(response.headers.get("Cache-Control")).toBe("no-store, no-cache, must-revalidate")
  })
})

describe("POST /api/ordenes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns 401 when not authenticated", async () => {
    mockAuthError()

    const response = await POST(createPostRequest({}))
    const { status } = await parseResponse(response)

    expect(status).toBe(401)
  })

  it("validates required fields", async () => {
    mockAuthSuccess()

    const response = await POST(
      createPostRequest({ clienteId: "c1" })
    )
    const { status } = await parseResponse(response)

    expect(status).toBe(400)
  })

  it("creates an order successfully", async () => {
    mockAuthSuccess()

    const mockOrden = {
      id: "o-new",
      numero_orden: 1,
      codigo_orden: "CEL-001",
      cliente_id: "c1",
      organization_id: "org-1",
      tipo_dispositivo: "CELULAR",
      dispositivo: "iPhone 14",
      problema_reportado: "No enciende",
      estado: "RECIBIDO",
      fecha_ingreso: "2024-01-01",
      fecha_prometida: null,
      public_token: "abc123",
      clientes: { id: "c1", nombre: "Juan" },
    }

    const ordenChain = createChainMock(mockOrden)
    const orgChain = createChainMock({ nombre: "Mi Taller", nombre_mostrar: "Mi Taller Pro" })
    mockSupabaseFrom({
      ordenes_servicio: ordenChain,
      organizations: orgChain,
    })

    const response = await POST(
      createPostRequest({
        clienteId: "c1",
        dispositivo: "iPhone 14",
        tipoDispositivo: "CELULAR",
        problemaReportado: "No enciende",
      })
    )
    const { status, body } = await parseResponse(response)

    expect(status).toBe(201)
    expect(body.codigoOrden).toBe("CEL-001")
    expect(body.dispositivo).toBe("iPhone 14")
    expect(body.organizationName).toBe("Mi Taller Pro")
  })

  it("la orden nace con sucursal_id del contexto", async () => {
    vi.mocked(auth).mockResolvedValue({
      user: { id: "u-1", organizationId: "org-1", role: "TECNICO", sucursalId: "suc-1", email: "t@t.com" },
      expires: new Date(Date.now() + 86400000).toISOString(),
    } as any)

    const insertSpy = vi.fn().mockReturnValue(createChainMock({ id: "ord-1", clientes: { id: "c1" } }, null))
    mockSupabaseFrom({
      sucursales: createChainMock({ id: "suc-p" }, null), // getPrincipalId
      ordenes_servicio: { ...createChainMock({ id: "ord-1", clientes: { id: "c1" } }, null), insert: insertSpy } as any,
      organizations: createChainMock({ nombre: "Mi Taller", nombre_mostrar: "Mi Taller Pro" }, null),
    })

    await POST(
      createPostRequest({
        clienteId: "c1",
        dispositivo: "iPhone 14",
        tipoDispositivo: "CELULAR",
        problemaReportado: "No enciende",
      })
    )

    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ sucursal_id: "suc-1" }))
  })

  it("enforces plan limits", async () => {
    mockAuthSuccess()

    vi.mocked(enforcePlanLimit).mockResolvedValueOnce(
      NextResponse.json({ error: "LÃ­mite de Ã³rdenes alcanzado" }, { status: 403 }) as any
    )

    const response = await POST(
      createPostRequest({
        clienteId: "c1",
        dispositivo: "iPhone 14",
        tipoDispositivo: "CELULAR",
        problemaReportado: "No enciende",
      })
    )
    const { status } = await parseResponse(response)

    expect(status).toBe(403)
  })

  it("queues CAMBIO_ESTADO notification with initial estado when order is created", async () => {
    mockAuthSuccess()

    const mockOrden = {
      id: "o-new",
      numero_orden: 2,
      codigo_orden: "CEL-002",
      cliente_id: "c1",
      organization_id: "org-1",
      tipo_dispositivo: "CELULAR",
      dispositivo: "Samsung S24",
      problema_reportado: "Pantalla rota",
      estado: "RECIBIDO",
      fecha_ingreso: "2024-01-01",
      fecha_prometida: null,
      public_token: "tok-abc123",
      clientes: {
        id: "c1",
        nombre: "Maria Lopez",
        email: "maria@test.com",
        telefono: "+541112345678",
      },
    }

    const ordenChain = createChainMock(mockOrden)
    const orgChain = createChainMock({
      nombre: "Mi Taller",
      nombre_mostrar: "Mi Taller Pro",
      slug: "mi-taller",
      moneda: "ARS",
      zona_horaria: "America/Argentina/Buenos_Aires",
      logo_url: null,
      telefono: null,
      direccion: null,
      comprobante_terminos: null,
    })
    mockSupabaseFrom({
      ordenes_servicio: ordenChain,
      organizations: orgChain,
    })

        const response = await POST(
      createPostRequest({
        clienteId: "c1",
        dispositivo: "Samsung S24",
        tipoDispositivo: "CELULAR",
        problemaReportado: "Pantalla rota",
      })
    )
    const { status } = await parseResponse(response)

    expect(status).toBe(201)

    const calls = vi.mocked(queueNotification).mock.calls
    expect(calls.length).toBeGreaterThan(0)
    const arg = calls[0][0]
    expect(arg.tipo).toBe("CAMBIO_ESTADO")
    expect(arg.context.orden?.estado).toBe("RECIBIDO")
    expect(arg.context.orden?.publicToken).toBeTruthy()
  })

  it("rejects invalid IMEI (not 15 digits) when tipo validates IMEI — returns 400", async () => {
    mockAuthSuccess()
    vi.mocked(tipoValidaImei).mockResolvedValue(true)

    const response = await POST(
      createPostRequest({
        clienteId: "c1",
        dispositivo: "Samsung A54",
        tipoDispositivo: "CELULAR",
        problemaReportado: "No enciende",
        imei: "123",
      })
    )
    const { status, body } = await parseResponse(response)

    expect(status).toBe(400)
    expect(body.error).toMatch(/IMEI/)
  })

  it("accepts valid 15-digit IMEI when tipo validates IMEI — returns 201", async () => {
    mockAuthSuccess()
    vi.mocked(tipoValidaImei).mockResolvedValue(true)

    const mockOrden = {
      id: "o-imei",
      numero_orden: 3,
      codigo_orden: "CEL-003",
      cliente_id: "c1",
      organization_id: "org-1",
      tipo_dispositivo: "CELULAR",
      dispositivo: "Samsung A54",
      problema_reportado: "No enciende",
      estado: "RECIBIDO",
      fecha_ingreso: "2024-01-01",
      fecha_prometida: null,
      public_token: "tok-imei",
      clientes: { id: "c1", nombre: "Juan" },
    }

    const ordenChain = createChainMock(mockOrden)
    const orgChain = createChainMock({ nombre: "Mi Taller", nombre_mostrar: "Mi Taller Pro" })
    mockSupabaseFrom({
      ordenes_servicio: ordenChain,
      organizations: orgChain,
    })

    const response = await POST(
      createPostRequest({
        clienteId: "c1",
        dispositivo: "Samsung A54",
        tipoDispositivo: "CELULAR",
        problemaReportado: "No enciende",
        imei: "123456789012345",
      })
    )
    const { status } = await parseResponse(response)

    expect(status).toBe(201)
  })

  it("does not validate IMEI when tipo does not mark it — returns 201 even with short imei", async () => {
    mockAuthSuccess()
    vi.mocked(tipoValidaImei).mockResolvedValue(false)

    const mockOrden = {
      id: "o-serial",
      numero_orden: 4,
      codigo_orden: "CONS-004",
      cliente_id: "c1",
      organization_id: "org-1",
      tipo_dispositivo: "CONSOLA",
      dispositivo: "PS5",
      problema_reportado: "No enciende",
      estado: "RECIBIDO",
      fecha_ingreso: "2024-01-01",
      fecha_prometida: null,
      public_token: "tok-serial",
      clientes: { id: "c1", nombre: "Juan" },
    }

    const ordenChain = createChainMock(mockOrden)
    const orgChain = createChainMock({ nombre: "Mi Taller", nombre_mostrar: "Mi Taller Pro" })
    mockSupabaseFrom({
      ordenes_servicio: ordenChain,
      organizations: orgChain,
    })

    const response = await POST(
      createPostRequest({
        clienteId: "c1",
        dispositivo: "PS5",
        tipoDispositivo: "CONSOLA",
        problemaReportado: "No enciende",
        imei: "123",
      })
    )
    const { status } = await parseResponse(response)

    expect(status).toBe(201)
  })
})
