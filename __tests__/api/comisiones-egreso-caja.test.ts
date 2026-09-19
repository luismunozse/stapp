import { describe, it, expect, beforeEach, vi } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import {
  mockAuthSuccess,
  mockSupabaseFrom,
  createChainMock,
  createPostRequest,
  parseResponse,
} from "./helpers"

vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
  createAuditLogger: vi.fn(() => ({ create: vi.fn(), update: vi.fn() })),
  diffObjects: vi.fn().mockReturnValue({ before: {}, after: {} }),
}))

vi.mock("@/lib/sucursal", () => ({
  sucursalParaEscritura: vi.fn().mockResolvedValue("suc-1"),
  sucursalParaLectura: vi.fn().mockResolvedValue({ verTodas: true, sucursalId: null }),
}))

import { POST as pagarTecnicos, DELETE as revertirTecnicos } from "@/app/api/comisiones/pagar/route"

function createDeleteRequest(body: any): Request {
  return new Request("http://localhost:3000/api/comisiones/pagar", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

/**
 * Auditoría contable, punto 1.3.
 *
 * Antes "pagar comisión" sólo prendía una tilde: la plata salía del cajón y
 * el sistema no se enteraba. El dueño quedaba entre un arqueo con faltante
 * todos los meses, o cargar el gasto a mano y que el P&L le restara la
 * comisión dos veces (ya la restaba devengada).
 */
describe("pago de comisiones a técnicos → egreso de caja", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN" })
  })

  function armarMocks(opts: {
    pagadas?: Array<{ id: string }>
    comisiones?: Array<{ orden_id: string; tecnico_id: string | null; monto_comision: string }>
    usuarios?: Array<{ id: string; nombre: string }>
  } = {}) {
    const movimientos = createChainMock({ id: "mov-1" })
    const ordenes = createChainMock(opts.pagadas ?? [{ id: "o1" }])
    mockSupabaseFrom({
      ordenes_servicio: ordenes,
      v_comisiones_ordenes: createChainMock(opts.comisiones ?? []),
      users: createChainMock(opts.usuarios ?? []),
      sesiones_caja: createChainMock([{ id: "ses-1" }]),
      movimientos_caja: movimientos,
    })
    return { movimientos, ordenes }
  }

  it("genera el egreso por el monto de la comisión, agrupado por técnico", async () => {
    const { movimientos } = armarMocks({
      pagadas: [{ id: "o1" }, { id: "o2" }],
      comisiones: [
        { orden_id: "o1", tecnico_id: "tec-1", monto_comision: "70" },
        { orden_id: "o2", tecnico_id: "tec-1", monto_comision: "30" },
      ],
      usuarios: [{ id: "tec-1", nombre: "Juan Pérez" }],
    })

    const res = await pagarTecnicos(createPostRequest({ ordenIds: ["o1", "o2"] }))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.updated).toBe(2)
    expect(body.egresoCaja).toEqual({ total: 100, movimientos: 1 })

    expect(movimientos.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        tipo: "EGRESO",
        monto: 100,
        concepto: "Pago de comisiones a Juan Pérez",
        metodo_pago: "EFECTIVO",
        origen_tipo: "COMISION_TECNICO",
        origen_id: "tec-1",
      })
    )
  })

  it("el egreso NO cuenta como gasto operativo, para no restar la comisión dos veces", async () => {
    // La comisión ya se resta devengada en el Estado de Resultados. Si este
    // movimiento tuviera afecta_rentabilidad = true, se restaría de nuevo.
    const { movimientos } = armarMocks({
      comisiones: [{ orden_id: "o1", tecnico_id: "tec-1", monto_comision: "70" }],
    })

    await pagarTecnicos(createPostRequest({ ordenIds: ["o1"] }))

    expect(movimientos.insert).toHaveBeenCalledWith(
      expect.objectContaining({ afecta_rentabilidad: false })
    )
  })

  it("un pago que cubre a dos técnicos genera un movimiento por cada uno", async () => {
    // En la caja se lee "Comisiones a Juan" y "Comisiones a Ana", no un monto
    // anónimo que junta a los dos.
    const { movimientos } = armarMocks({
      pagadas: [{ id: "o1" }, { id: "o2" }],
      comisiones: [
        { orden_id: "o1", tecnico_id: "tec-1", monto_comision: "70" },
        { orden_id: "o2", tecnico_id: "tec-2", monto_comision: "50" },
      ],
      usuarios: [
        { id: "tec-1", nombre: "Juan" },
        { id: "tec-2", nombre: "Ana" },
      ],
    })

    const { body } = await parseResponse(
      await pagarTecnicos(createPostRequest({ ordenIds: ["o1", "o2"] }))
    )

    expect(body.egresoCaja).toEqual({ total: 120, movimientos: 2 })
    expect(movimientos.insert).toHaveBeenCalledTimes(2)
  })

  it("respeta el método de pago elegido", async () => {
    // Una transferencia también es plata que sale; lo que cambia es de dónde.
    const { movimientos } = armarMocks({
      comisiones: [{ orden_id: "o1", tecnico_id: "tec-1", monto_comision: "70" }],
    })

    await pagarTecnicos(
      createPostRequest({ ordenIds: ["o1"], metodoPago: "TRANSFERENCIA" })
    )

    expect(movimientos.insert).toHaveBeenCalledWith(
      expect.objectContaining({ metodo_pago: "TRANSFERENCIA" })
    )
  })

  it("registrarEnCaja: false mantiene el comportamiento viejo", async () => {
    // Para el que ya venía cargando el egreso a mano y no quiere duplicarlo
    // mientras ordena su operatoria.
    const { movimientos } = armarMocks({
      comisiones: [{ orden_id: "o1", tecnico_id: "tec-1", monto_comision: "70" }],
    })

    const { body } = await parseResponse(
      await pagarTecnicos(createPostRequest({ ordenIds: ["o1"], registrarEnCaja: false }))
    )

    expect(body.updated).toBe(1)
    expect(body.egresoCaja).toBeNull()
    expect(movimientos.insert).not.toHaveBeenCalled()
  })

  it("si no quedaba nada por pagar no se genera ningún egreso", async () => {
    // Doble click, o comisiones ya pagadas: el UPDATE afecta 0 filas.
    const { movimientos } = armarMocks({ pagadas: [] })

    const { body } = await parseResponse(
      await pagarTecnicos(createPostRequest({ ordenIds: ["o1"] }))
    )

    expect(body.updated).toBe(0)
    expect(body.egresoCaja).toBeNull()
    expect(movimientos.insert).not.toHaveBeenCalled()
  })

  it("una comisión en cero no genera un movimiento de $0", async () => {
    const { movimientos } = armarMocks({
      comisiones: [{ orden_id: "o1", tecnico_id: "tec-1", monto_comision: "0" }],
    })

    const { body } = await parseResponse(
      await pagarTecnicos(createPostRequest({ ordenIds: ["o1"] }))
    )

    expect(body.egresoCaja).toEqual({ total: 0, movimientos: 0 })
    expect(movimientos.insert).not.toHaveBeenCalled()
  })

  it("si el egreso falla, el pago igual queda marcado", async () => {
    // Best-effort por diseño: el pago ya ocurrió en el mundo real. Tirar abajo
    // la operación dejaría al técnico cobrado y al sistema diciendo que no.
    mockSupabaseFrom({
      ordenes_servicio: createChainMock([{ id: "o1" }]),
      v_comisiones_ordenes: createChainMock([
        { orden_id: "o1", tecnico_id: "tec-1", monto_comision: "70" },
      ]),
      users: createChainMock([]),
      sesiones_caja: createChainMock([]),
      movimientos_caja: createChainMock(null, { message: "insert failed" }),
    })

    const { status, body } = await parseResponse(
      await pagarTecnicos(createPostRequest({ ordenIds: ["o1"] }))
    )

    expect(status).toBe(200)
    expect(body.updated).toBe(1)
    expect(body.egresoCaja).toEqual({ total: 0, movimientos: 0 })
  })
})

describe("revertir el pago de comisiones", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN" })
  })

  it("anula el egreso cuando ya no queda ninguna orden pagada apuntándole", async () => {
    const movimientos = createChainMock([{ id: "mov-1" }])
    // Primera lectura: las órdenes a revertir y su movimiento.
    // Segunda lectura (post-update): ninguna orden pagada lo referencia.
    const ordenes = createChainMock([{ id: "o1", comision_pago_movimiento_id: "mov-1" }])
    let lecturas = 0
    ordenes.then = (resolve: any) => {
      lecturas++
      return Promise.resolve(
        lecturas === 1
          ? { data: [{ id: "o1", comision_pago_movimiento_id: "mov-1" }], error: null }
          : { data: [], error: null }
      ).then(resolve)
    }

    mockSupabaseFrom({ ordenes_servicio: ordenes, movimientos_caja: movimientos })

    const { status, body } = await parseResponse(
      await revertirTecnicos(createDeleteRequest({ ordenIds: ["o1"] }))
    )

    expect(status).toBe(200)
    expect(body.egresosAnulados).toBe(1)
    expect(movimientos.update).toHaveBeenCalledWith(
      expect.objectContaining({ anulado: true, anulado_motivo: "Se revirtió el pago de comisiones" })
    )
  })

  it("NO anula el egreso si todavía quedan órdenes pagadas en el mismo lote", async () => {
    // Revertir 1 de 10 órdenes no puede borrar el pago de las otras 9.
    const movimientos = createChainMock([])
    const ordenes = createChainMock([{ id: "o1", comision_pago_movimiento_id: "mov-1" }])

    mockSupabaseFrom({ ordenes_servicio: ordenes, movimientos_caja: movimientos })

    await revertirTecnicos(createDeleteRequest({ ordenIds: ["o1"] }))

    expect(movimientos.update).not.toHaveBeenCalled()
  })

  it("limpia el enlace al movimiento en las órdenes revertidas", async () => {
    const ordenes = createChainMock([{ id: "o1", comision_pago_movimiento_id: "mov-1" }])
    mockSupabaseFrom({ ordenes_servicio: ordenes, movimientos_caja: createChainMock([]) })

    await revertirTecnicos(createDeleteRequest({ ordenIds: ["o1"] }))

    expect(ordenes.update).toHaveBeenCalledWith(
      expect.objectContaining({
        comision_pagada: false,
        comision_pago_movimiento_id: null,
      })
    )
  })
})

describe("supabaseAdmin sigue siendo el cliente usado", () => {
  it("smoke: el mock de from() está enganchado", () => {
    expect(vi.isMockFunction(supabaseAdmin.from)).toBe(true)
  })
})
