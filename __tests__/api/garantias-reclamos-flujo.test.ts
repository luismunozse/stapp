// @vitest-environment node
/**
 * Fase 2 de garantías (docs/garantias-flujo-2026-11-11.md, migración 401):
 * reclamos unificados de reparación y venta, decisión del ADMIN y el camino
 * único al re-ingreso (aceptar un reclamo = atajo del menú).
 *
 * Corre sobre una base en memoria con la vista v_garantias calculada: un
 * reclamo insertado cambia la vista, como en la base real.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, parseResponse } from "./helpers"
import { montarTaller, ORG, S1, S2, TEC_ORIGINAL } from "./garantias-reclamos-fixture"

vi.mock("@/lib/counters", () => ({
  getNextOrderNumberByType: vi.fn(async () => ({ codigo: "CEL099", numero: 99 })),
}))
vi.mock("@/lib/audit", () => ({
  createAuditLogger: vi.fn(() => ({ create: vi.fn(async () => undefined) })),
}))
vi.mock("@/lib/notifications/queue", () => ({
  queueNotification: vi.fn(async () => undefined),
}))

import { POST as registrar, GET as leer } from "@/app/api/garantias/reclamos/route"
import { PUT as decidir } from "@/app/api/garantias/reclamos/[id]/route"
import { POST as reingresoMenu } from "@/app/api/ordenes/[id]/reingreso/route"
import { queueNotification } from "@/lib/notifications/queue"
import { deletePracticeData } from "@/lib/onboarding/practica"
import { getNextOrderNumberByType } from "@/lib/counters"

const json = (method: string, body: unknown, url = "http://localhost/api/x") =>
  new Request(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

const ADMIN = { role: "ADMIN", userId: "admin-1", sucursalId: S1 }
const VENDEDOR = { role: "VENDEDOR", userId: "vend-1", sucursalId: S1 }

async function registrarComo(auth: typeof ADMIN, body: Record<string, unknown>) {
  mockAuthSuccess({ ...auth, organizationId: ORG })
  return parseResponse(await registrar(json("POST", body)))
}

async function decidirComo(auth: typeof ADMIN, id: string, body: Record<string, unknown>) {
  mockAuthSuccess({ ...auth, organizationId: ORG })
  return parseResponse(await decidir(json("PUT", body), ctx(id)))
}

/** Espera a que el aviso fire-and-forget llegue a la cola. */
async function avisoEncolado() {
  await vi.waitFor(() => expect(queueNotification).toHaveBeenCalled())
  return vi.mocked(queueNotification).mock.calls.at(-1)![0]
}

describe("registrar un reclamo (cualquier rol)", () => {
  beforeEach(() => vi.clearAllMocks())

  it("VENDEDOR registra sobre una garantía de reparación de su sucursal: PENDIENTE, con quién lo registró", async () => {
    const db = montarTaller()
    const { status, body } = await registrarComo(VENDEDOR, { origen: "REPARACION", garantiaId: "gar-1", descripcion: "No carga" })
    expect(status).toBe(201)
    expect(body).toMatchObject({ origen: "REPARACION", garantiaId: "gar-1", fase: "ABIERTO", estado: "PENDIENTE" })
    const r = db.tablas.reclamos_garantia[0]
    expect(r).toMatchObject({ garantia_id: "gar-1", garantia_venta_id: null, registrado_por: "vend-1", organization_id: ORG })
  })

  it("TECNICO registra sobre una reparación asignada a él aunque sea de otra sucursal", async () => {
    const db = montarTaller()
    const { status } = await registrarComo(
      { role: "TECNICO", userId: TEC_ORIGINAL, sucursalId: S2 },
      { origen: "REPARACION", garantiaId: "gar-1", descripcion: "No carga" }
    )
    expect(status).toBe(201)
    expect(db.tablas.reclamos_garantia).toHaveLength(1)
  })

  it("TECNICO sin la orden asignada y de otra sucursal: 404", async () => {
    const db = montarTaller()
    const r = await registrarComo(
      { role: "TECNICO", userId: "otro-tec", sucursalId: S2 },
      { origen: "REPARACION", garantiaId: "gar-1", descripcion: "x" }
    )
    expect(r.status).toBe(404)
    expect(db.tablas.reclamos_garantia).toHaveLength(0)
  })

  it("fuera del alcance (VENDEDOR de otra sucursal, TECNICO sobre una venta): 404 y nada escrito", async () => {
    const db = montarTaller()
    const otro = await registrarComo({ ...VENDEDOR, sucursalId: S2 }, { origen: "REPARACION", garantiaId: "gar-1", descripcion: "x" })
    expect(otro.status).toBe(404)
    const tec = await registrarComo(
      { role: "TECNICO", userId: TEC_ORIGINAL, sucursalId: S1 },
      { origen: "VENTA", garantiaId: "gv-1", descripcion: "x" }
    )
    expect(tec.status).toBe(404)
    expect(db.tablas.reclamos_garantia).toHaveLength(0)
  })

  it("un segundo reclamo abierto sobre la misma garantía: 409", async () => {
    montarTaller()
    expect((await registrarComo(VENDEDOR, { origen: "VENTA", garantiaId: "gv-1", descripcion: "Uno" })).status).toBe(201)
    const dup = await registrarComo(VENDEDOR, { origen: "VENTA", garantiaId: "gv-1", descripcion: "Otro" })
    expect(dup.status).toBe(409)
    expect(dup.body.code).toBe("RECLAMO_DUPLICADO")
  })

  it("si el índice único gana la carrera (23505), también 409", async () => {
    montarTaller({ carrera: true })
    const r = await registrarComo(VENDEDOR, { origen: "VENTA", garantiaId: "gv-1", descripcion: "Uno" })
    expect(r.status).toBe(409)
    expect(r.body.code).toBe("RECLAMO_DUPLICADO")
  })

  it("garantía vencida: VENDEDOR no puede; ADMIN sin motivo recibe requiereMotivo; con motivo queda registrado", async () => {
    const db = montarTaller({ vencimientoReparacion: -3 })
    const v = await registrarComo(VENDEDOR, { origen: "REPARACION", garantiaId: "gar-1", descripcion: "x" })
    expect(v.status).toBe(400)
    expect(v.body).toMatchObject({ code: "GARANTIA_VENCIDA", requiereMotivo: false })

    const a = await registrarComo(ADMIN, { origen: "REPARACION", garantiaId: "gar-1", descripcion: "x" })
    expect(a.status).toBe(400)
    expect(a.body).toMatchObject({ code: "GARANTIA_VENCIDA", requiereMotivo: true })
    expect(db.tablas.reclamos_garantia).toHaveLength(0)

    const f = await registrarComo(ADMIN, {
      origen: "REPARACION",
      garantiaId: "gar-1",
      descripcion: "x",
      motivoFueraDeVigencia: "Cliente habitual, venció hace 3 días",
    })
    expect(f.status).toBe(201)
    expect(db.tablas.reclamos_garantia[0].vigencia_forzada_motivo).toBe("Cliente habitual, venció hace 3 días")
  })

  it("una garantía que vence hoy sigue vigente", async () => {
    montarTaller({ vencimientoReparacion: 0 })
    expect((await registrarComo(VENDEDOR, { origen: "REPARACION", garantiaId: "gar-1", descripcion: "x" })).status).toBe(201)
  })

  it("garantía de una venta anulada: 409", async () => {
    montarTaller({ ventaAnulada: true })
    const r = await registrarComo(ADMIN, { origen: "VENTA", garantiaId: "gv-1", descripcion: "x" })
    expect(r.status).toBe(409)
    expect(r.body.code).toBe("GARANTIA_ANULADA")
  })
})

describe("decidir un reclamo (solo ADMIN)", () => {
  beforeEach(() => vi.clearAllMocks())

  it("VENDEDOR no decide: 403 y nada escrito", async () => {
    const db = montarTaller({ reclamos: [{ id: "r1", garantia_id: "gar-1", descripcion: "x", estado: "PENDIENTE" }] })
    const r = await decidirComo(VENDEDOR, "r1", { accion: "aceptar" })
    expect(r.status).toBe(403)
    expect(db.escrituras).toHaveLength(0)
  })

  it("rechazar exige el motivo y lo guarda", async () => {
    const db = montarTaller({ reclamos: [{ id: "r1", garantia_id: "gar-1", descripcion: "x", estado: "PENDIENTE" }] })
    const sin = await decidirComo(ADMIN, "r1", { accion: "rechazar" })
    expect(sin.status).toBe(400)
    expect(sin.body.code).toBe("MOTIVO_REQUERIDO")

    const con = await decidirComo(ADMIN, "r1", { accion: "rechazar", motivo: "Daño por humedad" })
    expect(con.status).toBe(200)
    expect(con.body.reclamo).toMatchObject({ fase: "RECHAZADO", motivoRechazo: "Daño por humedad" })
    expect(db.tablas.reclamos_garantia[0]).toMatchObject({ estado: "RECHAZADO", decidido_por: "admin-1" })
    expect(db.tablas.ordenes_servicio).toHaveLength(1)
  })

  it("un reclamo ya decidido no se vuelve a decidir: 409", async () => {
    montarTaller({ reclamos: [{ id: "r1", garantia_id: "gar-1", descripcion: "x", estado: "RECHAZADO" }] })
    const r = await decidirComo(ADMIN, "r1", { accion: "aceptar" })
    expect(r.status).toBe(409)
    expect(r.body.code).toBe("RECLAMO_YA_DECIDIDO")
  })

  it("un reclamo de otra organización: 404", async () => {
    montarTaller({ reclamos: [{ id: "r1", garantia_id: "gar-1", descripcion: "x", estado: "PENDIENTE", organization_id: "org-otra" }] })
    expect((await decidirComo(ADMIN, "r1", { accion: "aceptar" })).status).toBe(404)
  })

  it("aceptar (reparación): crea el re-ingreso con todos los vínculos, lo enlaza y avisa al cliente", async () => {
    const db = montarTaller({ reclamos: [{ id: "r1", garantia_id: "gar-1", descripcion: "Volvió a fallar la carga", estado: "PENDIENTE" }] })
    const r = await decidirComo(ADMIN, "r1", { accion: "aceptar" })
    expect(r.status).toBe(200)
    expect(r.body.orden).toMatchObject({ numeroOrden: 99, codigoOrden: "CEL099" })

    const nueva = db.tablas.ordenes_servicio.find((o) => o.id === r.body.orden.id)!
    expect(nueva).toMatchObject({
      es_reingreso: true,
      orden_origen_id: "ord-1",
      garantia_origen_id: "gar-1",
      sucursal_id: S1,
      cliente_id: "cli-1",
      dispositivo: "iPhone 13",
      tipo_dispositivo: "CELULAR",
      codigo_orden: "CEL099",
      numero_orden: 99,
      estado: "RECIBIDO",
      problema_reportado: "Volvió a fallar la carga",
    })
    expect(nueva.public_token).toMatch(/^[0-9a-f]{32}$/)
    expect(nueva).not.toHaveProperty("recibido_por")
    expect(getNextOrderNumberByType).toHaveBeenCalledWith(ORG, "CELULAR")

    expect(db.tablas.reclamos_garantia[0]).toMatchObject({
      estado: "ACEPTADO",
      orden_reingreso_id: nueva.id,
      decidido_por: "admin-1",
    })
    // Historial en las dos órdenes.
    expect(db.tablas.orden_eventos.map((e) => e.orden_id).sort()).toEqual([nueva.id, "ord-1"].sort())

    const aviso = await avisoEncolado()
    expect(aviso).toMatchObject({
      tipo: "REINGRESO_GARANTIA",
      ordenId: nueva.id,
      garantiaId: "gar-1",
      clienteId: "cli-1",
      sucursalId: S1,
    })
  })

  it("aceptar borra la práctica del onboarding (es la primera orden real)", async () => {
    montarTaller({ reclamos: [{ id: "r1", garantia_id: "gar-1", descripcion: "x", estado: "PENDIENTE" }] })
    expect((await decidirComo(ADMIN, "r1", { accion: "aceptar" })).status).toBe(200)
    expect(deletePracticeData).toHaveBeenCalledWith(ORG)
  })

  it("orden original sin sucursal: el re-ingreso va a la sucursal principal", async () => {
    const db = montarTaller({
      ordenSinSucursal: true,
      reclamos: [{ id: "r1", garantia_id: "gar-1", descripcion: "x", estado: "PENDIENTE" }],
    })
    const r = await decidirComo(ADMIN, "r1", { accion: "aceptar" })
    expect(r.status).toBe(200)
    expect(db.tablas.ordenes_servicio.find((o) => o.id === r.body.orden.id)!.sucursal_id).toBe(S1)
  })

  it("sin sucursal posible: 500 y el reclamo vuelve a estar por decidir", async () => {
    const db = montarTaller({
      ordenSinSucursal: true,
      reclamos: [{ id: "r1", garantia_id: "gar-1", descripcion: "x", estado: "PENDIENTE" }],
    })
    db.tablas.sucursales.forEach((s) => (s.principal = false))
    const r = await decidirComo(ADMIN, "r1", { accion: "aceptar" })
    expect(r.status).toBe(500)
    expect(db.tablas.reclamos_garantia[0].estado).toBe("PENDIENTE")
    expect(db.tablas.ordenes_servicio).toHaveLength(1)
  })

  it("aceptar (venta): la orden es del cliente de la venta, con el producto como equipo y sin orden original", async () => {
    const db = montarTaller({ reclamos: [{ id: "r1", garantia_venta_id: "gv-1", descripcion: "No enciende", estado: "PENDIENTE" }] })
    const r = await decidirComo(ADMIN, "r1", { accion: "aceptar" })
    expect(r.status).toBe(200)
    const nueva = db.tablas.ordenes_servicio.find((o) => o.id === r.body.orden.id)!
    expect(nueva).toMatchObject({
      es_reingreso: true,
      orden_origen_id: null,
      garantia_origen_id: "gv-1",
      cliente_id: "cli-2",
      dispositivo: "Auriculares BT",
      tipo_dispositivo: "AUDIO",
      sucursal_id: S1,
    })
    expect(db.tablas.reclamos_garantia[0]).toMatchObject({ estado: "ACEPTADO", orden_reingreso_id: nueva.id })
    const aviso = await avisoEncolado()
    // notification_logs.garantia_id apunta a garantias: la de venta no va.
    expect(aviso).toMatchObject({ tipo: "REINGRESO_GARANTIA", clienteId: "cli-2", garantiaId: undefined })
  })

  it("aceptar una venta sin cliente: 409 y el reclamo vuelve a estar por decidir", async () => {
    const db = montarTaller({
      ventaConCliente: false,
      reclamos: [{ id: "r1", garantia_venta_id: "gv-1", descripcion: "x", estado: "PENDIENTE" }],
    })
    const r = await decidirComo(ADMIN, "r1", { accion: "aceptar" })
    expect(r.status).toBe(409)
    expect(r.body.code).toBe("VENTA_SIN_CLIENTE")
    expect(db.tablas.reclamos_garantia[0]).toMatchObject({ estado: "PENDIENTE", decidido_por: null })
    expect(db.tablas.ordenes_servicio).toHaveLength(1)
  })

  it("GET devuelve la línea de tiempo con la fase y el número del re-ingreso", async () => {
    montarTaller({ reclamos: [{ id: "r1", garantia_id: "gar-1", descripcion: "x", estado: "PENDIENTE" }] })
    await decidirComo(ADMIN, "r1", { accion: "aceptar" })
    mockAuthSuccess({ ...VENDEDOR, organizationId: ORG })
    const { status, body } = await parseResponse(await leer(new Request("http://localhost/api/garantias/reclamos?ordenId=ord-1")))
    expect(status).toBe(200)
    expect(body.garantias).toHaveLength(1)
    expect(body.garantias[0]).toMatchObject({ estado: "RECLAMADA" })
    expect(body.garantias[0].reclamos[0]).toMatchObject({ fase: "ACEPTADO", ordenReingreso: { numero: "CEL099" } })
  })
})

describe("atajo del menú: Re-ingreso por garantía (registra + acepta)", () => {
  beforeEach(() => vi.clearAllMocks())

  const menu = async (auth: typeof ADMIN, body: Record<string, unknown>) => {
    mockAuthSuccess({ ...auth, organizationId: ORG })
    return parseResponse(await reingresoMenu(json("POST", body), ctx("ord-1")))
  }

  it("ADMIN: un reclamo ACEPTADO y la misma orden que al aceptar un reclamo", async () => {
    const db = montarTaller()
    const r = await menu(ADMIN, { problemaReportado: "Volvió a fallar" })
    expect(r.status).toBe(201)
    expect(db.tablas.reclamos_garantia).toHaveLength(1)
    expect(db.tablas.reclamos_garantia[0]).toMatchObject({
      garantia_id: "gar-1",
      estado: "ACEPTADO",
      orden_reingreso_id: r.body.id,
      registrado_por: "admin-1",
      decidido_por: "admin-1",
    })
    const nueva = db.tablas.ordenes_servicio.find((o) => o.id === r.body.id)!
    expect(nueva).toMatchObject({
      es_reingreso: true,
      orden_origen_id: "ord-1",
      garantia_origen_id: "gar-1",
      sucursal_id: S1,
      codigo_orden: "CEL099",
    })
    expect((await avisoEncolado()).tipo).toBe("REINGRESO_GARANTIA")
  })

  it("VENDEDOR: 403 (registra el reclamo desde la tarjeta) y nada escrito", async () => {
    const db = montarTaller()
    const r = await menu(VENDEDOR, { problemaReportado: "x" })
    expect(r.status).toBe(403)
    expect(db.escrituras).toHaveLength(0)
  })

  it("sin garantía: 409 SIN_GARANTIA", async () => {
    montarTaller({ sinGarantiaReparacion: true })
    const r = await menu(ADMIN, { problemaReportado: "x" })
    expect(r.status).toBe(409)
    expect(r.body.code).toBe("SIN_GARANTIA")
  })

  it("vencida: pide motivo; con motivo lo crea", async () => {
    const db = montarTaller({ vencimientoReparacion: -10 })
    const sin = await menu(ADMIN, { problemaReportado: "x" })
    expect(sin.status).toBe(400)
    expect(sin.body).toMatchObject({ code: "GARANTIA_VENCIDA", requiereMotivo: true })
    const con = await menu(ADMIN, { problemaReportado: "x", motivoFueraDeVigencia: "Excepción del dueño" })
    expect(con.status).toBe(201)
    expect(db.tablas.reclamos_garantia[0].vigencia_forzada_motivo).toBe("Excepción del dueño")
  })

  it("si ya había un reclamo por decidir, acepta ese (no registra otro)", async () => {
    const db = montarTaller({ reclamos: [{ id: "r1", garantia_id: "gar-1", descripcion: "Registrado antes", estado: "PENDIENTE" }] })
    const r = await menu(ADMIN, { problemaReportado: "x" })
    expect(r.status).toBe(201)
    expect(r.body.reclamoId).toBe("r1")
    expect(db.tablas.reclamos_garantia).toHaveLength(1)
    expect(db.tablas.reclamos_garantia[0]).toMatchObject({ estado: "ACEPTADO", orden_reingreso_id: r.body.id })
  })

  it("si el re-ingreso ya está en curso: 409 y ninguna orden nueva", async () => {
    const db = montarTaller({
      reclamos: [{ id: "r1", garantia_id: "gar-1", descripcion: "x", estado: "ACEPTADO", orden_reingreso_id: "ord-1" }],
    })
    const r = await menu(ADMIN, { problemaReportado: "x" })
    expect(r.status).toBe(409)
    expect(r.body.code).toBe("REINGRESO_EN_CURSO")
    expect(db.tablas.ordenes_servicio).toHaveLength(1)
  })
})
