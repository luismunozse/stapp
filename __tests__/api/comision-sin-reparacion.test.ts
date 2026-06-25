/**
 * Tests: comision_aplica_sin_reparacion flag
 *
 * Suite 1 — /api/comisiones: estado filter controlled by flag
 * Suite 2 — /api/reportes/estado-resultados: commission deduction guarded by flag
 * Suite 3 — /api/configuracion PUT: accepts comisionAplicaSinReparacion field
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  createChainMock,
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

vi.mock("@/lib/subscriptions", () => ({
  hasPlanFeature: vi.fn().mockResolvedValue(true),
}))

vi.mock("@/lib/sucursal", () => ({
  sucursalParaLectura: vi.fn().mockResolvedValue({ verTodas: true, sucursalId: null }),
}))

vi.mock("@/lib/storage", () => ({
  uploadLogo: vi.fn().mockResolvedValue({ url: "http://example.com/logo.jpg", path: "logos/1.jpg" }),
  deleteLogo: vi.fn().mockResolvedValue(undefined),
  dataUrlToBuffer: vi.fn().mockReturnValue({ buffer: Buffer.from("fake"), mime: "image/jpeg" }),
  uploadOrderPhoto: vi.fn().mockResolvedValue({ url: "http://example.com/photo.jpg", path: "photos/1.jpg" }),
  base64ToBuffer: vi.fn().mockReturnValue(Buffer.from("fake")),
}))

vi.mock("@/lib/countries", () => ({
  COUNTRIES: { AR: "Argentina", US: "United States" },
}))

vi.mock("@/lib/audit", () => ({
  createAuditLogger: vi.fn(() => ({
    create: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
  })),
  diffObjects: vi.fn().mockReturnValue({ before: {}, after: {} }),
}))

// ─── Route imports (after mocks) ─────────────────────────────────────────────

import { GET as comisionesGet } from "@/app/api/comisiones/route"
import { GET as estadoResultadosGet } from "@/app/api/reportes/estado-resultados/route"
import { PUT as configuracionPut } from "@/app/api/configuracion/route"

// ─── Auth helper ─────────────────────────────────────────────────────────────

function mockAdminAuth() {
  vi.mocked(auth).mockResolvedValue({
    user: {
      id: "admin-1",
      organizationId: "org-1",
      role: "ADMIN",
      sucursalId: null,
      email: "admin@test.com",
    },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } as any)
}

function createGetRequest(url: string): Request {
  return new Request(url, { method: "GET" })
}

function createPutRequest(body: any, url = "http://localhost:3000/api/configuracion"): Request {
  return new Request(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

// ─── Suite 1: /api/comisiones estado filter ───────────────────────────────────

describe("Flag comision_aplica_sin_reparacion — /api/comisiones estado filter", () => {
  beforeEach(() => vi.clearAllMocks())

  it("flag=false → estado filter is ['REPARADO','ENTREGADO'] only", async () => {
    mockAdminAuth()

    const inCalls: Array<[string, any[]]> = []
    const vComisionesChain = createChainMock([])
    const originalIn = vComisionesChain.in as ReturnType<typeof vi.fn>
    originalIn.mockImplementation((col: string, vals: any[]) => {
      inCalls.push([col, vals])
      return vComisionesChain
    })

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "organizations") {
        return createChainMock({ comision_aplica_sin_reparacion: false }) as any
      }
      if (table === "v_comisiones_ordenes") {
        return vComisionesChain as any
      }
      if (table === "users") {
        return createChainMock([]) as any
      }
      return createChainMock(null, { message: `No mock for table: ${table}` }) as any
    })

    const res = await comisionesGet(createGetRequest("http://localhost:3000/api/comisiones"))
    expect(res.status).toBe(200)

    const estadoCall = inCalls.find(([col]) => col === "estado")
    expect(estadoCall).toBeDefined()
    expect(estadoCall![1]).not.toContain("ENTREGADO_SIN_REPARACION")
    expect(estadoCall![1]).toContain("REPARADO")
    expect(estadoCall![1]).toContain("ENTREGADO")
  })

  it("flag=true → estado filter includes 'ENTREGADO_SIN_REPARACION'", async () => {
    mockAdminAuth()

    const inCalls: Array<[string, any[]]> = []
    const vComisionesChain = createChainMock([])
    const originalIn = vComisionesChain.in as ReturnType<typeof vi.fn>
    originalIn.mockImplementation((col: string, vals: any[]) => {
      inCalls.push([col, vals])
      return vComisionesChain
    })

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "organizations") {
        return createChainMock({ comision_aplica_sin_reparacion: true }) as any
      }
      if (table === "v_comisiones_ordenes") {
        return vComisionesChain as any
      }
      if (table === "users") {
        return createChainMock([]) as any
      }
      return createChainMock(null, { message: `No mock for table: ${table}` }) as any
    })

    const res = await comisionesGet(createGetRequest("http://localhost:3000/api/comisiones"))
    expect(res.status).toBe(200)

    const estadoCall = inCalls.find(([col]) => col === "estado")
    expect(estadoCall).toBeDefined()
    expect(estadoCall![1]).toContain("ENTREGADO_SIN_REPARACION")
    expect(estadoCall![1]).toContain("REPARADO")
    expect(estadoCall![1]).toContain("ENTREGADO")
  })
})

// ─── Suite 2: /api/reportes/estado-resultados commission deduction ─────────────

describe("Flag comision_aplica_sin_reparacion — estado-resultados commission deduction", () => {
  beforeEach(() => vi.clearAllMocks())

  const mockOrdenSinReparacion = {
    id: "o1",
    costo_final: "1000",
    estado: "ENTREGADO_SIN_REPARACION",
    tecnico_id: "tec-1",
    porcentaje_comision: "10",
    repuestos_orden: [],
    cotizaciones: [],
    fecha_completado: "2024-01-15T10:00:00Z",
  }

  function buildFromMock(flag: boolean) {
    const tableMap = new Map<string, any>()
    tableMap.set("organizations", createChainMock({ comision_aplica_sin_reparacion: flag }))
    tableMap.set("ordenes_servicio", createChainMock([mockOrdenSinReparacion]))
    tableMap.set("ventas", createChainMock([]))
    tableMap.set("cobros_orden", createChainMock([]))
    tableMap.set("movimientos_caja", createChainMock([]))
    tableMap.set("pagos_venta", createChainMock([]))
    tableMap.set("pagos_parciales", createChainMock([]))
    tableMap.set("facturas", createChainMock([]))
    tableMap.set("ajustes_inventario", createChainMock([]))
    tableMap.set("notas_credito", createChainMock([]))

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      return (tableMap.get(table) || createChainMock(null, { message: `No mock for table: ${table}` })) as any
    })
  }

  it("ENTREGADO_SIN_REPARACION order with flag=false → comision deducted = 0", async () => {
    mockAdminAuth()
    buildFromMock(false)

    const res = await estadoResultadosGet(
      createGetRequest("http://localhost:3000/api/reportes/estado-resultados?desde=2024-01-01&hasta=2024-01-31")
    )
    const { status, body } = await parseResponse(res)
    expect(status).toBe(200)
    expect(body.comisiones.tecnicos).toBe(0)
  })

  it("ENTREGADO_SIN_REPARACION order with flag=true → comision deducted > 0", async () => {
    mockAdminAuth()
    buildFromMock(true)

    const res = await estadoResultadosGet(
      createGetRequest("http://localhost:3000/api/reportes/estado-resultados?desde=2024-01-01&hasta=2024-01-31")
    )
    const { status, body } = await parseResponse(res)
    expect(status).toBe(200)
    expect(body.comisiones.tecnicos).toBeGreaterThan(0)
  })
})

// ─── Suite 3: PUT /api/configuracion — comision_aplica_sin_reparacion field ───

describe("PUT /api/configuracion — comision_aplica_sin_reparacion field", () => {
  beforeEach(() => vi.clearAllMocks())

  it("PUT with comisionAplicaSinReparacion=true saves comision_aplica_sin_reparacion=true to DB", async () => {
    mockAdminAuth()

    const updatedOrg = {
      id: "org-1",
      logo_url: null,
      logo_path: null,
      nombre_mostrar: "Mi Taller",
      telefono: null,
      direccion: null,
      ciudad: null,
      provincia: null,
      codigo_postal: null,
      moneda: "ARS",
      zona_horaria: "America/Argentina/Buenos_Aires",
      umbral_stock_bajo: 5,
      iva_porcentaje: 0,
      cotizacion_validez_dias: 30,
      cotizacion_terminos: null,
      recepcion_terminos: null,
      comprobante_terminos: null,
      garantia_dias_default: 30,
      politica_abandono_dias_default: 60,
      anticipo_porcentaje_default: 50,
      pais: "AR",
      modulo_agenda: false,
      iva_regimen: "EXENTO",
      iva_tasa: 21,
      redondeo_efectivo: 0,
      comision_aplica_sin_reparacion: true,
    }

    const updateSpy = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: updatedOrg, error: null }),
        }),
      }),
    })

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "organizations") {
        return {
          update: updateSpy,
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: updatedOrg, error: null }),
            }),
          }),
        } as any
      }
      return createChainMock(null, { message: `No mock for table: ${table}` }) as any
    })

    const res = await configuracionPut(
      createPutRequest({ comisionAplicaSinReparacion: true })
    )

    expect(res.status).toBe(200)
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ comision_aplica_sin_reparacion: true })
    )
  })
})
