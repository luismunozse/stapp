import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, mockSupabaseFrom, parseResponse } from "./helpers"

vi.mock("@/lib/notifications/queue", () => ({
  queueNotification: vi.fn().mockResolvedValue(undefined),
}))

import { supabaseAdmin } from "@/lib/supabase"
import { queueNotification } from "@/lib/notifications/queue"
import { PATCH } from "@/app/api/onboarding/practica/route"

const org = {
  nombre: "Taller",
  nombre_mostrar: "Taller Luis",
  slug: "taller",
  moneda: "ARS",
  zona_horaria: "America/Argentina/Buenos_Aires",
}
const base = {
  id: "ord-p",
  public_token: "a".repeat(32),
  tipo_dispositivo: "CELULAR",
  dispositivo: "Moto G",
  problema_reportado: "No enciende",
  sucursal_id: "suc-1",
  cliente_id: "cli-p",
  clientes: { id: "cli-p", nombre: "Luis", email: "luis@taller.com" },
}
const recibida = { ...base, estado: "RECIBIDO", costo_final: null, fecha_completado: null }
const enReparacion = { ...recibida, estado: "EN_REPARACION" }
const reparada = { ...base, estado: "REPARADO", costo_final: "15000.00", fecha_completado: "2026-10-11T15:00:00.000Z" }
const entregada = { ...reparada, estado: "ENTREGADO_SIN_COBRO" }

function patch(body: unknown) {
  return new Request("http://localhost/api/onboarding/practica", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

// Each maybeSingle() call resolves the next value: the load, then each update.
function preparar(...respuestas: unknown[]) {
  const ordenes = createChainMock(null)
  const maybeSingle = vi.fn()
  for (const data of respuestas) maybeSingle.mockResolvedValueOnce({ data, error: null })
  ordenes.maybeSingle = maybeSingle
  const update = vi.fn().mockReturnValue(ordenes)
  ordenes.update = update

  const eventos = createChainMock(null)
  const eventoInsert = vi.fn().mockReturnValue(eventos)
  eventos.insert = eventoInsert

  const progreso = createChainMock(null)
  const progresoUpsert = vi.fn().mockReturnValue(progreso)
  progreso.upsert = progresoUpsert

  mockSupabaseFrom({
    ordenes_servicio: ordenes,
    orden_eventos: eventos,
    organizations: createChainMock(org),
    onboarding_progress: progreso,
  })
  return { ordenes, maybeSingle, update, eventoInsert, progresoUpsert }
}

// The load and the updates share one chain mock, so asserting on eq() alone would
// be satisfied by the load. This returns only the eq() filters chained after the
// n-th update(), i.e. the ones that scope the write itself.
function filtrosDelUpdate(
  ordenes: ReturnType<typeof createChainMock>,
  update: { mock: { invocationCallOrder: number[] } },
  n: number
) {
  const desde = update.mock.invocationCallOrder[n]
  const hasta = update.mock.invocationCallOrder[n + 1] ?? Infinity
  return ordenes.eq.mock.calls.filter(
    (_, i) => ordenes.eq.mock.invocationCallOrder[i] > desde && ordenes.eq.mock.invocationCallOrder[i] < hasta
  )
}

describe("PATCH /api/onboarding/practica", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess()
  })

  it("returns 403 for a non-admin", async () => {
    mockAuthSuccess({ role: "TECNICO" })
    expect((await PATCH(patch({ accion: "entregar" }))).status).toBe(403)
  })

  it("returns 404 when the org has no practice", async () => {
    preparar(null)
    expect((await PATCH(patch({ accion: "entregar" }))).status).toBe(404)
  })

  it("rejects reparar without a positive price before reading the order", async () => {
    const { maybeSingle } = preparar(recibida)
    const { status, body } = await parseResponse(await PATCH(patch({ accion: "reparar", costoFinal: 0 })))
    expect(status).toBe(400)
    expect(body.error).toBe("El precio tiene que ser mayor a cero")
    expect(maybeSingle).not.toHaveBeenCalled()
  })

  it("rejects an unknown accion", async () => {
    preparar(recibida)
    const { status, body } = await parseResponse(await PATCH(patch({ accion: "cobrar" })))
    expect(status).toBe(400)
    expect(body.error).toBe("Acción inválida")
  })

  it("reparar writes EN_REPARACION then REPARADO, one event each, scoped to the org's practice", async () => {
    const { update, ordenes, eventoInsert } = preparar(recibida, { id: "ord-p" }, reparada)
    const { status, body } = await parseResponse(await PATCH(patch({ accion: "reparar", costoFinal: 15000 })))

    expect(status).toBe(200)
    expect(body.practica).toMatchObject({ estado: "REPARADO", costoFinal: 15000 })
    expect(update).toHaveBeenCalledTimes(2)
    expect(update.mock.calls[0][0]).toEqual({ estado: "EN_REPARACION" })
    expect(update.mock.calls[1][0]).toMatchObject({ estado: "REPARADO", costo_final: 15000 })
    expect(typeof update.mock.calls[1][0].fecha_completado).toBe("string")
    expect(ordenes.eq).toHaveBeenCalledWith("organization_id", "org-1")
    expect(ordenes.eq).toHaveBeenCalledWith("es_practica", true)
    expect(ordenes.eq).toHaveBeenCalledWith("estado", "RECIBIDO")
    expect(ordenes.eq).toHaveBeenCalledWith("estado", "EN_REPARACION")
    expect(eventoInsert.mock.calls.map(([e]: any[]) => [e.estado_anterior, e.estado_nuevo])).toEqual([
      ["RECIBIDO", "EN_REPARACION"],
      ["EN_REPARACION", "REPARADO"],
    ])
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  // Review Focus #5
  it("reparar queues exactly one notification, for REPARADO", async () => {
    preparar(recibida, { id: "ord-p" }, reparada)
    await PATCH(patch({ accion: "reparar", costoFinal: 15000 }))
    expect(queueNotification).toHaveBeenCalledTimes(1)
    const arg = vi.mocked(queueNotification).mock.calls[0][0]
    expect(arg.context.orden).toMatchObject({ estado: "REPARADO", estadoAnterior: "EN_REPARACION", numeroOrden: 0 })
    expect(arg.context.cliente.telefono).toBe("")
  })

  it("reparar resumes an order left in EN_REPARACION without writing EN_REPARACION again", async () => {
    const { update, eventoInsert } = preparar(enReparacion, reparada)
    const { status } = await parseResponse(await PATCH(patch({ accion: "reparar", costoFinal: 15000 })))
    expect(status).toBe(200)
    expect(update).toHaveBeenCalledTimes(1)
    expect(update.mock.calls[0][0]).toMatchObject({ estado: "REPARADO" })
    expect(eventoInsert).toHaveBeenCalledTimes(1)
  })

  // Review Focus #5
  it("a second reparar returns 409 and sends nothing", async () => {
    const { update } = preparar(reparada)
    const { status } = await parseResponse(await PATCH(patch({ accion: "reparar", costoFinal: 15000 })))
    expect(status).toBe(409)
    expect(update).not.toHaveBeenCalled()
    expect(queueNotification).not.toHaveBeenCalled()
  })

  it("reparar returns 409 when a concurrent request moved the order first", async () => {
    const { update } = preparar(recibida, null)
    const { status } = await parseResponse(await PATCH(patch({ accion: "reparar", costoFinal: 15000 })))
    expect(status).toBe(409)
    expect(update).toHaveBeenCalledTimes(1)
    expect(queueNotification).not.toHaveBeenCalled()
  })

  it("entregar ends in ENTREGADO_SIN_COBRO as a courtesy and records the practice completion", async () => {
    const { update, eventoInsert, progresoUpsert } = preparar(reparada, entregada)
    const { status, body } = await parseResponse(await PATCH(patch({ accion: "entregar" })))

    expect(status).toBe(200)
    expect(body.practica.estado).toBe("ENTREGADO_SIN_COBRO")
    const cambios = update.mock.calls[0][0]
    expect(cambios).toMatchObject({
      estado: "ENTREGADO_SIN_COBRO",
      motivo_sin_cobro: "CORTESIA",
      entregado_por_user_id: "user-1",
    })
    expect(typeof cambios.fecha_entrega).toBe("string")
    // fecha_completado was set at REPARADO and must not move.
    expect(cambios).not.toHaveProperty("fecha_completado")
    expect(eventoInsert.mock.calls[0][0]).toMatchObject({
      estado_anterior: "REPARADO",
      estado_nuevo: "ENTREGADO_SIN_COBRO",
      metadata: { motivoSinCobro: "CORTESIA" },
    })
    expect(queueNotification).toHaveBeenCalledTimes(1)
    expect(vi.mocked(queueNotification).mock.calls[0][0].context.orden?.estado).toBe("ENTREGADO_SIN_COBRO")
    expect(progresoUpsert).toHaveBeenCalledWith(
      { organization_id: "org-1", practica_completada_at: cambios.fecha_entrega },
      { onConflict: "organization_id" }
    )
  })

  // Review Focus #1
  it("entregar never touches money, stock or warranties", async () => {
    preparar(reparada, entregada)
    await PATCH(patch({ accion: "entregar" }))
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
    const tablas = vi.mocked(supabaseAdmin.from).mock.calls.map(([t]) => t)
    for (const t of ["cobros_orden", "cuenta_corriente", "movimientos_caja", "garantias", "repuestos_orden", "facturas"]) {
      expect(tablas).not.toContain(t)
    }
  })

  it("entregar returns 409 before the repair", async () => {
    const { update } = preparar(recibida)
    expect((await PATCH(patch({ accion: "entregar" }))).status).toBe(409)
    expect(update).not.toHaveBeenCalled()
  })

  it("scopes each reparar UPDATE by org, practice flag and expected estado", async () => {
    const { ordenes, update } = preparar(recibida, { id: "ord-p" }, reparada)
    await PATCH(patch({ accion: "reparar", costoFinal: 15000 }))
    expect(filtrosDelUpdate(ordenes, update, 0)).toEqual(
      expect.arrayContaining([["organization_id", "org-1"], ["es_practica", true], ["estado", "RECIBIDO"]])
    )
    expect(filtrosDelUpdate(ordenes, update, 1)).toEqual(
      expect.arrayContaining([["organization_id", "org-1"], ["es_practica", true], ["estado", "EN_REPARACION"]])
    )
  })

  it("scopes the entregar UPDATE by org, practice flag and REPARADO", async () => {
    const { ordenes, update } = preparar(reparada, entregada)
    await PATCH(patch({ accion: "entregar" }))
    expect(filtrosDelUpdate(ordenes, update, 0)).toEqual(
      expect.arrayContaining([["organization_id", "org-1"], ["es_practica", true], ["estado", "REPARADO"]])
    )
  })

  it("entregar returns 409 when a concurrent request delivered first, with no side effects", async () => {
    const { update, eventoInsert, progresoUpsert } = preparar(reparada, null)
    const { status } = await parseResponse(await PATCH(patch({ accion: "entregar" })))
    expect(status).toBe(409)
    expect(update).toHaveBeenCalledTimes(1)
    expect(queueNotification).not.toHaveBeenCalled()
    expect(eventoInsert).not.toHaveBeenCalled()
    expect(progresoUpsert).not.toHaveBeenCalled()
  })

  it("reparar returns 409 and sends nothing when the REPARADO update loses the race", async () => {
    const { update, eventoInsert } = preparar(enReparacion, null)
    const { status } = await parseResponse(await PATCH(patch({ accion: "reparar", costoFinal: 15000 })))
    expect(status).toBe(409)
    expect(update).toHaveBeenCalledTimes(1)
    expect(eventoInsert).not.toHaveBeenCalled()
    expect(queueNotification).not.toHaveBeenCalled()
  })
})
