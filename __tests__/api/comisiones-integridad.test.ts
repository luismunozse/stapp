/**
 * Tests: Commission integrity guards — C1, C2, C3, C4
 *
 * C1: POST /api/comisiones/pagar — técnico double-pay idempotency guard
 * C2: DELETE /api/comisiones/pagar AND DELETE /api/comisiones/vendedores/pagar — blind revert guard
 * C3: POST /api/ordenes with tecnicoId — commission snapshot included in insert
 * C4: POST /api/tecnicos/[id]/reasignar — costo_hora_snapshot updated alongside porcentaje_comision
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  mockSupabaseFrom,
  createChainMock,
  createPostRequest,
  parseResponse,
} from "./helpers"
import { auth } from "@/lib/auth"
import { supabaseAdmin } from "@/lib/supabase"

// ─── Module mocks (must be hoisted before route imports) ─────────────────────

vi.mock("@/lib/plan-limits", () => ({
  enforcePlanLimit: vi.fn().mockResolvedValue(null),
  isPlanLimitError: vi.fn().mockReturnValue(false),
  planLimitErrorResponse: vi.fn(),
}))

vi.mock("@/lib/counters", () => ({
  getNextOrderNumberByType: vi.fn().mockResolvedValue({ codigo: "CEL-001", numero: 1 }),
}))

vi.mock("@/lib/audit", () => ({
  createAuditLogger: vi.fn(() => ({
    create: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
  })),
  diffObjects: vi.fn().mockReturnValue({ before: {}, after: {} }),
}))

vi.mock("@/lib/storage", () => ({
  uploadOrderPhoto: vi.fn().mockResolvedValue({ url: "http://example.com/photo.jpg", path: "photos/1.jpg" }),
  base64ToBuffer: vi.fn().mockReturnValue(Buffer.from("fake")),
}))

vi.mock("@/lib/notifications/queue", () => ({
  queueNotification: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/tipos-dispositivo-config", () => ({
  tipoValidaImei: vi.fn().mockResolvedValue(false),
}))

vi.mock("@/lib/webhooks/dispatcher", () => ({
  emitWebhookEvent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/orden-state-machine", () => ({
  esTransicionValida: vi.fn().mockReturnValue(true),
  getMensajeTransicionInvalida: vi.fn().mockReturnValue(""),
  validarCamposRequeridos: vi.fn().mockReturnValue(null),
}))

// ─── Route imports (after mocks) ─────────────────────────────────────────────

import { POST as pagarTecnicoPost, DELETE as pagarTecnicoDelete } from "@/app/api/comisiones/pagar/route"
import { DELETE as pagarVendedorDelete } from "@/app/api/comisiones/vendedores/pagar/route"
import { POST as ordenesPost } from "@/app/api/ordenes/route"
import { POST as reasignarPost } from "@/app/api/tecnicos/[id]/reasignar/route"

// ─── Auth helper ─────────────────────────────────────────────────────────────

function mockAdminAuth(overrides?: { userId?: string }) {
  vi.mocked(auth).mockResolvedValue({
    user: {
      id: overrides?.userId || "admin-1",
      organizationId: "org-1",
      role: "ADMIN",
      sucursalId: null,
      email: "admin@test.com",
    },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } as any)
}

function createDeleteRequest(body: any, url = "http://localhost:3000/api/test"): Request {
  return new Request(url, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

// ─── C1: técnico double-pay idempotency ──────────────────────────────────────

describe("C1 — POST /api/comisiones/pagar — idempotency guard", () => {
  beforeEach(() => vi.clearAllMocks())

  it("C1.1 — UPDATE chain includes .eq('comision_pagada', false) to prevent double-pay", async () => {
    mockAdminAuth()

    const ordenesChain = createChainMock([{ id: "o1" }])
    mockSupabaseFrom({ ordenes_servicio: ordenesChain })

    const res = await pagarTecnicoPost(
      createPostRequest({ ordenIds: ["o1", "o2"] })
    )

    expect(res.status).toBe(200)

    // The UPDATE must have been called with comision_pagada: true
    expect(ordenesChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ comision_pagada: true })
    )

    // AND the chain must include eq("comision_pagada", false) to guard against double-pay
    const eqCalls = ordenesChain.eq.mock.calls as [string, any][]
    const idempotencyGuard = eqCalls.find(([col, val]) => col === "comision_pagada" && val === false)
    expect(idempotencyGuard).toBeDefined()
  })

  it("C1.2 — returns 400 when ordenIds is empty", async () => {
    mockAdminAuth()
    const res = await pagarTecnicoPost(createPostRequest({ ordenIds: [] }))
    expect(res.status).toBe(400)
  })
})

// ─── C2: revert state guard ───────────────────────────────────────────────────

describe("C2a — DELETE /api/comisiones/pagar — revert only paid rows", () => {
  beforeEach(() => vi.clearAllMocks())

  it("C2a.1 — UPDATE chain includes .eq('comision_pagada', true) on revert", async () => {
    mockAdminAuth()

    const ordenesChain = createChainMock([{ id: "o1" }])
    mockSupabaseFrom({ ordenes_servicio: ordenesChain })

    const res = await pagarTecnicoDelete(
      createDeleteRequest({ ordenIds: ["o1"] })
    )

    expect(res.status).toBe(200)

    expect(ordenesChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ comision_pagada: false })
    )

    const eqCalls = ordenesChain.eq.mock.calls as [string, any][]
    const revertGuard = eqCalls.find(([col, val]) => col === "comision_pagada" && val === true)
    expect(revertGuard).toBeDefined()
  })
})

describe("C2b — DELETE /api/comisiones/vendedores/pagar — revert only paid rows", () => {
  beforeEach(() => vi.clearAllMocks())

  it("C2b.1 — UPDATE chain includes .eq('comision_pagada', true) on revert", async () => {
    mockAdminAuth()

    const ventasChain = createChainMock([{ id: "v1" }])
    mockSupabaseFrom({ ventas: ventasChain })

    const res = await pagarVendedorDelete(
      createDeleteRequest({ ventaIds: ["v1"] })
    )

    expect(res.status).toBe(200)

    expect(ventasChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ comision_pagada: false })
    )

    const eqCalls = ventasChain.eq.mock.calls as [string, any][]
    const revertGuard = eqCalls.find(([col, val]) => col === "comision_pagada" && val === true)
    expect(revertGuard).toBeDefined()
  })
})

// ─── C3: order created with técnico gets snapshot ────────────────────────────

describe("C3 — POST /api/ordenes — snapshot when tecnicoId is provided", () => {
  beforeEach(() => vi.clearAllMocks())

  it("C3.1 — insert payload includes porcentaje_comision and costo_hora_snapshot from técnico", async () => {
    // Simulate ADMIN creating an order with a tecnicoId
    vi.mocked(auth).mockResolvedValue({
      user: {
        id: "admin-1",
        organizationId: "org-1",
        role: "ADMIN",
        sucursalId: "suc-1",
        email: "admin@test.com",
      },
      expires: new Date(Date.now() + 86400000).toISOString(),
    } as any)

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
      clientes: { id: "c1", nombre: "Juan", email: null, telefono: null },
    }

    const insertSpy = vi.fn().mockReturnValue(createChainMock(mockOrden))

    // supabaseAdmin.from is called for multiple tables in sequence:
    // 1. "users" — técnico validation + snapshot fetch (eq "id" + "organization_id" + "rol")
    // 2. "ordenes_servicio" — insert
    // 3. "organizations" — org data for response

    let usersCallCount = 0
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "users") {
        usersCallCount++
        // Both the tecnico check AND any potential re-fetch return the same mock
        return createChainMock({
          id: "tec-1",
          porcentaje_comision: 10,
          costo_hora: 500,
        }) as any
      }
      if (table === "sucursales") {
        return createChainMock({ id: "suc-1" }) as any
      }
      if (table === "ordenes_servicio") {
        const chain = createChainMock(mockOrden)
        chain.insert = insertSpy
        return chain as any
      }
      if (table === "organizations") {
        return createChainMock({ nombre: "Mi Taller", nombre_mostrar: "Mi Taller" }) as any
      }
      return createChainMock(null, { message: `No mock for table: ${table}` }) as any
    })

    const res = await ordenesPost(
      createPostRequest({
        clienteId: "c1",
        dispositivo: "iPhone 14",
        tipoDispositivo: "CELULAR",
        problemaReportado: "No enciende",
        tecnicoId: "tec-1",
      })
    )

    expect(res.status).toBe(201)

    // The insert must include porcentaje_comision and costo_hora_snapshot
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        porcentaje_comision: 10,
        costo_hora_snapshot: 500,
        tecnico_id: "tec-1",
      })
    )
  })

  it("C3.2 — insert payload does NOT include snapshot fields when no tecnicoId", async () => {
    mockAdminAuth()

    const mockOrden = {
      id: "o-new2",
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
      public_token: "def456",
      clientes: { id: "c1", nombre: "Ana", email: null, telefono: null },
    }

    const insertSpy = vi.fn().mockReturnValue(createChainMock(mockOrden))

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "sucursales") return createChainMock({ id: "suc-1" }) as any
      if (table === "ordenes_servicio") {
        const chain = createChainMock(mockOrden)
        chain.insert = insertSpy
        return chain as any
      }
      if (table === "organizations") {
        return createChainMock({ nombre: "Mi Taller", nombre_mostrar: "Mi Taller" }) as any
      }
      return createChainMock(null, { message: `No mock for table: ${table}` }) as any
    })

    const res = await ordenesPost(
      createPostRequest({
        clienteId: "c1",
        dispositivo: "Samsung S24",
        tipoDispositivo: "CELULAR",
        problemaReportado: "Pantalla rota",
        // no tecnicoId
      })
    )

    expect(res.status).toBe(201)

    // Snapshot fields must be absent (null) when no técnico
    const insertArg = insertSpy.mock.calls[0][0]
    expect(insertArg.porcentaje_comision).toBeUndefined()
    expect(insertArg.costo_hora_snapshot).toBeUndefined()
  })
})

// ─── C4: reasignar updates costo_hora_snapshot ───────────────────────────────

describe("C4 — POST /api/tecnicos/[id]/reasignar — costo_hora_snapshot updated", () => {
  beforeEach(() => vi.clearAllMocks())

  it("C4.1 — unpaid orders update includes costo_hora_snapshot from destino técnico", async () => {
    mockAdminAuth()

    const mockOrdenes = [
      { id: "o1", estado: "EN_REPARACION", comision_pagada: false },
      { id: "o2", estado: "RECIBIDO", comision_pagada: false },
    ]

    // Spy on the two update calls to ordenes_servicio:
    // call 1 → tecnico_id update (all orders)
    // call 2 → porcentaje_comision + costo_hora_snapshot (unpaid only)
    const updateCalls: any[] = []
    const ordenesChain: any = {
      ...createChainMock(mockOrdenes),
      update: vi.fn().mockImplementation((payload: any) => {
        updateCalls.push(payload)
        return ordenesChain
      }),
    }
    // Make the chain thenable for the select query
    ordenesChain.then = (resolve: any) =>
      Promise.resolve({ data: mockOrdenes, error: null }).then(resolve)

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "users") {
        return createChainMock({
          id: "tec-destino",
          rol: "TECNICO",
          activo: true,
          porcentaje_comision: 15,
          costo_hora: 750,
        }) as any
      }
      if (table === "ordenes_servicio") {
        return ordenesChain as any
      }
      return createChainMock(null, { message: `No mock for table: ${table}` }) as any
    })

    const res = await reasignarPost(
      createPostRequest({ tecnicoDestinoId: "tec-destino" }),
      { params: Promise.resolve({ id: "tec-origen" }) }
    )

    const { status, body } = await parseResponse(res)
    expect(status).toBe(200)
    expect(body.reasignadas).toBeGreaterThan(0)

    // The commission update (second update call) must include costo_hora_snapshot
    const commissionUpdate = updateCalls.find((u) => "porcentaje_comision" in u)
    expect(commissionUpdate).toBeDefined()
    expect(commissionUpdate).toMatchObject({
      porcentaje_comision: 15,
      costo_hora_snapshot: 750,
    })
  })

  it("C4.2 — paid orders are NOT touched for commission snapshot", async () => {
    mockAdminAuth()

    const mockOrdenes = [
      { id: "o1", estado: "REPARADO", comision_pagada: true },   // paid — skip
      { id: "o2", estado: "EN_REPARACION", comision_pagada: false }, // unpaid — update
    ]

    const inCalls: any[] = []
    const updateCalls: any[] = []
    const ordenesChain: any = {
      ...createChainMock(mockOrdenes),
      update: vi.fn().mockImplementation((payload: any) => {
        updateCalls.push(payload)
        return ordenesChain
      }),
      in: vi.fn().mockImplementation((col: string, ids: string[]) => {
        inCalls.push({ col, ids })
        return ordenesChain
      }),
    }
    ordenesChain.then = (resolve: any) =>
      Promise.resolve({ data: mockOrdenes, error: null }).then(resolve)

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "users") {
        return createChainMock({
          id: "tec-destino",
          rol: "TECNICO",
          activo: true,
          porcentaje_comision: 20,
          costo_hora: 900,
        }) as any
      }
      if (table === "ordenes_servicio") return ordenesChain as any
      return createChainMock(null, { message: `No mock for table: ${table}` }) as any
    })

    const res = await reasignarPost(
      createPostRequest({ tecnicoDestinoId: "tec-destino" }),
      { params: Promise.resolve({ id: "tec-origen" }) }
    )

    expect(res.status).toBe(200)

    // The commission update must only target the unpaid order "o2"
    const commissionUpdateCall = inCalls.find(
      ({ col, ids }) => col === "id" && ids.includes("o2") && !ids.includes("o1")
    )
    // At least one .in() call targeted only unpaid ids
    expect(commissionUpdateCall).toBeDefined()
  })
})
