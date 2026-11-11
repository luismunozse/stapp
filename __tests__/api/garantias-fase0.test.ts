/**
 * Garantías, Fase 0 (docs/garantias-flujo-2026-11-11.md §2, bugs 1-4):
 *  - GET /api/garantias respeta ?ordenId= y devuelve los reclamos en camelCase.
 *  - Convertir un presupuesto no crea la garantía: guarda sus condiciones en la orden.
 *  - La entrega crea la garantía con los días pedidos, la tz de la org y el
 *    alcance del presupuesto; si el insert falla lo avisa, si anda notifica.
 *  (Aceptar un reclamo con su re-ingreso vinculado pasó a la fase 2:
 *  __tests__/api/garantias-reclamos-flujo.test.ts.)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createGetRequest,
  createPostRequest,
  parseResponse,
} from "./helpers"

vi.mock("@/lib/audit", () => ({
  createAuditLogger: vi.fn(() => ({
    update: vi.fn().mockResolvedValue(undefined),
    create: vi.fn().mockResolvedValue(undefined),
  })),
  diffObjects: vi.fn().mockReturnValue({ before: {}, after: {} }),
}))

vi.mock("@/lib/notifications/queue", () => ({
  queueNotification: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/counters", () => ({
  getNextOrderNumber: vi.fn().mockResolvedValue(8),
  getNextOrderNumberByType: vi.fn().mockResolvedValue({ codigo: "CEL-001", numero: 1 }),
}))

vi.mock("@/lib/sucursal", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sucursal")>()),
  sucursalParaEscritura: vi.fn().mockResolvedValue("suc-A"),
}))

import { supabaseAdmin } from "@/lib/supabase"
import { queueNotification } from "@/lib/notifications/queue"
import { GET as listGarantias } from "@/app/api/garantias/route"
import { POST as entregar } from "@/app/api/ordenes/[id]/entregar/route"
import { POST as convertir } from "@/app/api/cotizaciones/[id]/convertir-orden/route"

const reclamoRow = {
  id: "r1",
  garantia_id: "g1",
  descripcion: "Volvió a fallar",
  estado: "ACEPTADO",
  orden_reparacion_id: "ord-r",
  resolucion: null,
  fecha_reclamo: "2026-11-01T10:00:00Z",
  fecha_resolucion: null,
}

describe("GET /api/garantias", () => {
  beforeEach(() => vi.clearAllMocks())

  it("filtra por ordenId y devuelve los reclamos en camelCase, del más nuevo al más viejo", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const garantias = createChainMock([
      {
        id: "g1",
        orden_id: "o1",
        dias_validez: 90,
        fecha_inicio: "2026-10-01T12:00:00Z",
        fecha_vencimiento: "2099-01-01T12:00:00Z",
        estado: "RECLAMADA",
        notas: null,
        created_at: "2026-10-01T12:00:00Z",
        ordenes_servicio: { id: "o1", numero_orden: 7, dispositivo: "iPhone", clientes: null },
        reclamos_garantia: [
          { ...reclamoRow, id: "r0", fecha_reclamo: "2026-10-15T10:00:00Z", estado: "RECHAZADO", orden_reparacion_id: null, resolucion: "No cubre", fecha_resolucion: "2026-10-16T10:00:00Z" },
          reclamoRow,
        ],
      },
    ])
    mockSupabaseFrom({ garantias })

    const { status, body } = await parseResponse(
      await listGarantias(createGetRequest("http://localhost/api/garantias?ordenId=o1"))
    )

    expect(status).toBe(200)
    expect(garantias.eq).toHaveBeenCalledWith("orden_id", "o1")
    expect(garantias.eq).toHaveBeenCalledWith("ordenes_servicio.organization_id", "org-1")
    expect(body[0].reclamos).toEqual([
      {
        id: "r1",
        origen: "REPARACION",
        garantiaId: "g1",
        descripcion: "Volvió a fallar",
        estado: "ACEPTADO",
        fase: "ACEPTADO",
        ordenReparacionId: "ord-r",
        ordenReingreso: { id: "ord-r", numero: null },
        resolucion: null,
        motivoRechazo: null,
        vigenciaForzadaMotivo: null,
        registradoPor: null,
        decididoPor: null,
        fechaReclamo: "2026-11-01T10:00:00Z",
        fechaDecision: null,
        fechaResolucion: null,
      },
      expect.objectContaining({ id: "r0", fechaResolucion: "2026-10-16T10:00:00Z", resolucion: "No cubre" }),
    ])
    expect(body[0].reclamos[0]).not.toHaveProperty("fecha_reclamo")
  })

  it("sin ordenId no filtra por orden", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const garantias = createChainMock([])
    mockSupabaseFrom({ garantias })
    await listGarantias(createGetRequest("http://localhost/api/garantias"))
    expect(garantias.eq).not.toHaveBeenCalledWith("orden_id", expect.anything())
  })

  it("el filtro por orden convive con el alcance de sucursal", async () => {
    mockAuthSuccess({ role: "VENDEDOR", userId: "u1", sucursalId: "s1" })
    const garantias = createChainMock([])
    mockSupabaseFrom({ garantias })
    await listGarantias(createGetRequest("http://localhost/api/garantias?ordenId=o1"))
    expect(garantias.eq).toHaveBeenCalledWith("ordenes_servicio.sucursal_id", "s1")
    expect(garantias.eq).toHaveBeenCalledWith("orden_id", "o1")
  })
})

describe("POST /api/cotizaciones/[id]/convertir-orden — condiciones de garantía", () => {
  beforeEach(() => vi.clearAllMocks())

  function mockConversion(condiciones: Record<string, unknown>) {
    const cotizacion = {
      id: "cot-1",
      numero_cotizacion: "PRES-001",
      tipo: "PRESUPUESTO",
      convertida_a_orden_id: null,
      cliente_id: "c1",
      total: 15000,
      sector_id: null,
      equipo_snapshot: {
        dispositivo: "iPhone 12",
        problemaReportado: "Pantalla rota",
        tipoDispositivo: "CELULAR",
        condiciones,
      },
      checklist_snapshot: null,
    }
    let insertado: any = null
    const garantias = createChainMock(null)
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "cotizaciones") return createChainMock(cotizacion) as any
      if (table === "ordenes_servicio") {
        const chain: any = createChainMock(cotizacion)
        chain.insert = vi.fn().mockImplementation((payload: any) => {
          insertado = payload
          return createChainMock({ id: "ord-1", numero_orden: 1, codigo_orden: "CEL-001" })
        })
        return chain
      }
      if (table === "garantias") return garantias as any
      return createChainMock(null) as any
    })
    return { garantias, insertado: () => insertado }
  }

  it("no crea la garantía y guarda días y alcance en la orden", async () => {
    mockAuthSuccess()
    const { garantias, insertado } = mockConversion({ garantiaDias: 90, garantiaAlcance: "AMBOS" })

    const { status } = await parseResponse(await convertir(createPostRequest({}), { params: Promise.resolve({ id: "cot-1" }) }))

    expect(status).toBe(201)
    expect(garantias.insert).not.toHaveBeenCalled()
    expect(supabaseAdmin.from).not.toHaveBeenCalledWith("garantias")
    expect(insertado()).toMatchObject({ garantia_presupuesto_dias: 90, garantia_presupuesto_alcance: "AMBOS" })
  })

  it("un presupuesto sin garantía guarda NINGUNA con 0 días", async () => {
    mockAuthSuccess()
    const { insertado } = mockConversion({ garantiaDias: 30, garantiaAlcance: "NINGUNA" })
    await convertir(createPostRequest({}), { params: Promise.resolve({ id: "cot-1" }) })
    expect(insertado()).toMatchObject({ garantia_presupuesto_dias: 0, garantia_presupuesto_alcance: "NINGUNA" })
  })

  it("sin condiciones de garantía deja las columnas en NULL", async () => {
    mockAuthSuccess()
    const { insertado } = mockConversion({})
    await convertir(createPostRequest({}), { params: Promise.resolve({ id: "cot-1" }) })
    expect(insertado()).toMatchObject({ garantia_presupuesto_dias: null, garantia_presupuesto_alcance: null })
  })
})

describe("POST /api/ordenes/[id]/entregar — garantía", () => {
  const ordenBase = {
    id: "o1",
    estado: "REPARADO",
    organization_id: "org-1",
    sucursal_id: "suc-1",
    cliente_id: "c1",
    numero_orden: 7,
    dispositivo: "iPhone 12",
    public_token: "tok",
    tecnico_id: null,
    costo_final: "0",
    descuento_cobro: "0",
    total_cobrado: "0",
    fecha_completado: null,
    garantia_presupuesto_dias: 90,
    garantia_presupuesto_alcance: "REPUESTO",
    clientes: { id: "c1", nombre: "Ana", email: "ana@x.com", telefono: "123" },
  }

  function mockEntrega(garantias: ReturnType<typeof createChainMock>) {
    const ordenes = createChainMock({ ...ordenBase, estado: "ENTREGADO", users: null })
    mockSupabaseFrom({
      ordenes_servicio: ordenes,
      repuestos_orden: createChainMock([]),
      organizations: createChainMock({ nombre: "Taller", slug: "taller", zona_horaria: "America/Argentina/Buenos_Aires" }),
      garantias,
      orden_eventos: createChainMock(null),
    })
    ;(ordenes as any).single.mockResolvedValueOnce({ data: ordenBase, error: null })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { success: true }, error: null } as any)
    // 23:00 del 9/3 en Buenos Aires = 02:00 UTC del 10/3: el día calendario
    // del taller es el 9, no el 10 del servidor.
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-03-10T02:00:00Z"))
  })
  afterEach(() => vi.useRealTimers())

  it("vence en la tz de la org y lleva el alcance del presupuesto en las notas", async () => {
    mockAuthSuccess()
    const garantias = createChainMock({ id: "g1", dias_validez: 90, fecha_vencimiento: "2026-06-07T12:00:00.000Z" })
    mockEntrega(garantias)

    const { status, body } = await parseResponse(
      await entregar(createPostRequest({ diasGarantia: 90, notasGarantia: "No cubre golpes" }), { params: Promise.resolve({ id: "o1" }) })
    )

    expect(status).toBe(200)
    expect(body.garantiaWarning).toBeUndefined()
    expect(garantias.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        orden_id: "o1",
        dias_validez: 90,
        fecha_vencimiento: "2026-06-07T12:00:00.000Z",
        notas: "Alcance: Solo repuesto. No cubre golpes",
      })
    )
  })

  it("encola GARANTIA_CREADA como el alta manual", async () => {
    mockAuthSuccess()
    mockEntrega(createChainMock({ id: "g1", dias_validez: 90, fecha_vencimiento: "2026-06-07T12:00:00.000Z" }))

    await entregar(createPostRequest({ diasGarantia: 90 }), { params: Promise.resolve({ id: "o1" }) })

    expect(queueNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        tipo: "GARANTIA_CREADA",
        garantiaId: "g1",
        ordenId: "o1",
        sucursalId: "suc-1",
        context: expect.objectContaining({
          garantia: { id: "g1", diasValidez: 90, fechaVencimiento: "2026-06-07T12:00:00.000Z" },
          orden: expect.objectContaining({ numeroOrden: 7, estado: "ENTREGADO", publicToken: "tok" }),
        }),
      })
    )
  })

  it("si el insert falla, la entrega sigue y devuelve garantiaWarning sin notificar la garantía", async () => {
    mockAuthSuccess()
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    mockEntrega(createChainMock(null, { code: "23505", message: "duplicate key garantias_orden_id_key" }))

    const { status, body } = await parseResponse(
      await entregar(createPostRequest({ diasGarantia: 90 }), { params: Promise.resolve({ id: "o1" }) })
    )

    expect(status).toBe(200)
    expect(body.garantiaWarning).toContain("no se pudo registrar la garantía")
    expect(queueNotification).not.toHaveBeenCalledWith(expect.objectContaining({ tipo: "GARANTIA_CREADA" }))
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it("sin diasGarantia no crea garantía", async () => {
    mockAuthSuccess()
    const garantias = createChainMock(null)
    mockEntrega(garantias)
    await entregar(createPostRequest({}), { params: Promise.resolve({ id: "o1" }) })
    expect(garantias.insert).not.toHaveBeenCalled()
  })
})
