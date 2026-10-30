/**
 * Tests: Commission integrity guards — C1, C2, C3, C4, C5, C6
 *
 * C1: POST /api/comisiones/pagar — pays only through the pagar_comisiones RPC; bad bodies are 400
 * C2: DELETE /api/comisiones/pagar AND /api/comisiones/vendedores/pagar — annul through anular_pago_comisiones
 * C3: POST /api/ordenes with tecnicoId — commission snapshot included in insert
 * C4: POST /api/tecnicos/[id]/reasignar — costo_hora_snapshot updated alongside porcentaje_comision
 * C5: POST /api/vendedores/[id]/comisiones/liquidar — pays the URL's seller, 404 for a non-VENDEDOR
 * C6: non-admins get 403 on every pay, unpay and liquidar route, and nothing is written
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  mockSupabaseFrom,
  createChainMock,
  createPostRequest,
  parseResponse,
} from "./helpers"
import { montarSupabaseEnMemoria } from "../helpers/supabase-memoria"
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
import { POST as pagarVendedorPost, DELETE as pagarVendedorDelete } from "@/app/api/comisiones/vendedores/pagar/route"
import { POST as liquidarPost } from "@/app/api/vendedores/[id]/comisiones/liquidar/route"
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

// ─── C1: pay goes through the RPC ─────────────────────────────────────────────

const PAGO_OK = () => ({ pagoId: "p1", total: 10, filas: 1 })
const FILAS = [{ clave: "k", monto: 10 }]

describe("C1 — POST /api/comisiones/pagar — pays through the RPC", () => {
  beforeEach(() => vi.clearAllMocks())

  it("C1.1 — pay goes through pagar_comisiones and never updates a table", async () => {
    mockAdminAuth()
    const mem = montarSupabaseEnMemoria({}, { resultadoRpc: PAGO_OK })
    const res = await pagarTecnicoPost(createPostRequest({ beneficiarioId: "t1", filas: FILAS }))
    expect(res.status).toBe(200)
    expect(mem.escrituras.map((e) => [e.tabla, e.operacion])).toEqual([["pagar_comisiones", "rpc"]])
    expect(mem.escrituras[0].carga).toMatchObject({ p_organization_id: "org-1", p_usuario_id: "admin-1", p_beneficiario_id: "t1" })
  })

  it("C1.2 — the legacy body { ordenIds } is a 400 and calls nothing", async () => {
    mockAdminAuth()
    const mem = montarSupabaseEnMemoria({})
    const res = await pagarTecnicoPost(createPostRequest({ ordenIds: ["o1"] }))
    expect(res.status).toBe(400)
    expect(mem.escrituras).toEqual([])
  })

  it("C1.3 — a stale amount is a 409 with the reload message", async () => {
    mockAdminAuth()
    const mem = montarSupabaseEnMemoria(
      {},
      { errorRpc: () => ({ message: "COMISION_ERROR:MONTO_DISTINTO:k" }) },
    )
    const res = await pagarTecnicoPost(createPostRequest({ beneficiarioId: "t1", filas: FILAS }))
    const { status, body } = await parseResponse(res)
    expect(status).toBe(409)
    expect(body.error).toMatch(/Actualizá/)
    expect(mem.escrituras).toHaveLength(1)
  })

  it("C1.4 — a body that is not valid JSON is a 400", async () => {
    mockAdminAuth()
    const mem = montarSupabaseEnMemoria({})
    const res = await pagarTecnicoPost(
      new Request("http://localhost:3000/api/test", { method: "POST", body: "{nope" }),
    )
    expect(res.status).toBe(400)
    expect(mem.escrituras).toEqual([])
  })
})

// ─── C2: unpay annuls the payout ──────────────────────────────────────────────

describe("C2a — DELETE /api/comisiones/pagar — annuls the payout", () => {
  beforeEach(() => vi.clearAllMocks())

  it("C2a.1 — unpay annuls the payout with its reason", async () => {
    mockAdminAuth()
    const mem = montarSupabaseEnMemoria({}, { resultadoRpc: () => ({ pagoId: "p1", filas: 1 }) })
    const res = await pagarTecnicoDelete(createDeleteRequest({ pagoId: "p1", motivo: "error de carga" }))
    expect(res.status).toBe(200)
    expect(mem.escrituras.map((e) => [e.tabla, e.operacion])).toEqual([["anular_pago_comisiones", "rpc"]])
    expect(mem.escrituras[0].carga).toMatchObject({ p_pago_id: "p1", p_motivo: "error de carga" })
  })

  it("C2a.2 — unpay without a reason is a 400", async () => {
    mockAdminAuth()
    const mem = montarSupabaseEnMemoria({})
    const res = await pagarTecnicoDelete(createDeleteRequest({ pagoId: "p1" }))
    expect(res.status).toBe(400)
    expect(mem.escrituras).toEqual([])
  })
})

describe("C2b — vendedores/pagar — same wrappers", () => {
  beforeEach(() => vi.clearAllMocks())

  it("C2b.1 — the seller unpay route is the same wrapper", async () => {
    mockAdminAuth()
    const mem = montarSupabaseEnMemoria({}, { resultadoRpc: () => ({ pagoId: "p1", filas: 1 }) })
    const res = await pagarVendedorDelete(createDeleteRequest({ pagoId: "p1", motivo: "error de carga" }))
    expect(res.status).toBe(200)
    expect(mem.escrituras.map((e) => [e.tabla, e.operacion])).toEqual([["anular_pago_comisiones", "rpc"]])
    expect(mem.escrituras[0].carga).toMatchObject({ p_pago_id: "p1", p_motivo: "error de carga" })
  })

  it("C2b.2 — the seller pay route goes through pagar_comisiones", async () => {
    mockAdminAuth()
    const mem = montarSupabaseEnMemoria({}, { resultadoRpc: PAGO_OK })
    const res = await pagarVendedorPost(createPostRequest({ beneficiarioId: "v1", filas: FILAS }))
    expect(res.status).toBe(200)
    expect(mem.escrituras.map((e) => [e.tabla, e.operacion])).toEqual([["pagar_comisiones", "rpc"]])
  })
})

// ─── C5: liquidar pays the URL's seller ───────────────────────────────────────

describe("C5 — POST /api/vendedores/[id]/comisiones/liquidar", () => {
  beforeEach(() => vi.clearAllMocks())

  const ctx = { params: Promise.resolve({ id: "v1" }) }

  it("C5 — liquidar pays the URL's seller, 404 when the id is not a VENDEDOR", async () => {
    mockAdminAuth()
    const sinVendedor = montarSupabaseEnMemoria({ users: [] })
    const res404 = await liquidarPost(createPostRequest({ filas: FILAS }), ctx)
    expect(res404.status).toBe(404)
    expect(sinVendedor.escrituras).toEqual([])

    const mem = montarSupabaseEnMemoria(
      { users: [{ id: "v1", rol: "VENDEDOR", organization_id: "org-1" }] },
      { resultadoRpc: PAGO_OK },
    )
    const res = await liquidarPost(createPostRequest({ filas: FILAS }), ctx)
    const { status, body } = await parseResponse(res)
    expect(status).toBe(200)
    expect(body).toEqual({ pagoId: "p1", total: 10, liquidadas: 1, solicitadas: 1 })
    expect(mem.escrituras.map((e) => [e.tabla, e.operacion])).toEqual([["pagar_comisiones", "rpc"]])
    expect((mem.escrituras[0].carga as any).p_beneficiario_id).toBe("v1")
  })

  it("C5.2 — a vendedor of another org is a 404", async () => {
    mockAdminAuth()
    const mem = montarSupabaseEnMemoria({ users: [{ id: "v1", rol: "VENDEDOR", organization_id: "org-2" }] })
    const res = await liquidarPost(createPostRequest({ filas: FILAS }), ctx)
    expect(res.status).toBe(404)
    expect(mem.escrituras).toEqual([])
  })

  it("C5.3 — a handler error is returned unchanged", async () => {
    mockAdminAuth()
    montarSupabaseEnMemoria(
      { users: [{ id: "v1", rol: "VENDEDOR", organization_id: "org-1" }] },
      { errorRpc: () => ({ message: "COMISION_ERROR:MONTO_DISTINTO:k" }) },
    )
    const res = await liquidarPost(createPostRequest({ filas: FILAS }), ctx)
    expect(res.status).toBe(409)
  })
})

// ─── C7: an unexpected throw is a logged 500, never an unhandled rejection ─────

describe("C7 — pay/annul handlers answer 500 on an unexpected throw", () => {
  beforeEach(() => vi.clearAllMocks())

  const MSG = { error: "No se pudo procesar la operación." }
  const romper = (users: Array<Record<string, unknown>> = []) => {
    montarSupabaseEnMemoria({ users })
    vi.mocked(supabaseAdmin.rpc).mockImplementation((() => {
      throw new Error("network down")
    }) as any)
    vi.spyOn(console, "error").mockImplementation(() => {})
  }
  const ctx = { params: Promise.resolve({ id: "v1" }) }

  it.each([
    ["tecnico POST", () => pagarTecnicoPost(createPostRequest({ beneficiarioId: "t1", filas: FILAS }))],
    ["tecnico DELETE", () => pagarTecnicoDelete(createDeleteRequest({ pagoId: "p1", motivo: "x" }))],
    ["vendedor POST", () => pagarVendedorPost(createPostRequest({ beneficiarioId: "v1", filas: FILAS }))],
    ["vendedor DELETE", () => pagarVendedorDelete(createDeleteRequest({ pagoId: "p1", motivo: "x" }))],
    ["liquidar POST", () => liquidarPost(createPostRequest({ filas: FILAS }), ctx)],
  ])("%s", async (_nombre, llamar) => {
    mockAdminAuth()
    romper([{ id: "v1", rol: "VENDEDOR", organization_id: "org-1" }])
    const { status, body } = await parseResponse(await llamar())
    expect(status).toBe(500)
    expect(body).toEqual(MSG)
    expect(console.error).toHaveBeenCalled()
  })
})

// ─── C6: non-admins ───────────────────────────────────────────────────────────

describe("C6 — non-admins cannot pay nor unpay", () => {
  beforeEach(() => vi.clearAllMocks())

  it("C6 — non-admins cannot pay nor unpay", async () => {
    mockAuthSuccess({ role: "TECNICO" })
    const mem = montarSupabaseEnMemoria({})
    const post = await pagarTecnicoPost(createPostRequest({ beneficiarioId: "t1", filas: FILAS }))
    const del = await pagarTecnicoDelete(createDeleteRequest({ pagoId: "p1", motivo: "x" }))
    const postV = await pagarVendedorPost(createPostRequest({ beneficiarioId: "v1", filas: FILAS }))
    const delV = await pagarVendedorDelete(createDeleteRequest({ pagoId: "p1", motivo: "x" }))
    const liq = await liquidarPost(createPostRequest({ filas: FILAS }), { params: Promise.resolve({ id: "v1" }) })
    expect([post.status, del.status, postV.status, delV.status, liq.status]).toEqual([403, 403, 403, 403, 403])
    expect(mem.escrituras).toEqual([])
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
          rol: "TECNICO",
          sucursal_id: "suc-1",
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
