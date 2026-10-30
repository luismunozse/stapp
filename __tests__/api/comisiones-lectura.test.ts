// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest"
import { mockAuthSuccess, parseResponse } from "./helpers"
import { montarSupabaseEnMemoria } from "../helpers/supabase-memoria"
import { GET } from "@/app/api/comisiones/route"

const fila = (o: Partial<Record<string, unknown>>) => ({ clave: "ORDEN:o1:TECNICO:ORIGINAL:-", organization_id: "org-1", sucursal_id: null, documento_tipo: "ORDEN", documento_id: "o1", beneficiario_id: "t1", rol: "TECNICO", tipo: "ORIGINAL", ajuste_ref: null, base: 1000, porcentaje: 10, monto: 100, fecha_devengo: "2026-10-01T10:00:00Z", devengada: true, pago_id: null, fecha_pago: null, pagado: false, pendiente: 100, documento_codigo: "CEL-1", documento_numero: 1, documento_detalle: "iPhone", documento_estado: "ENTREGADO", documento_total: 1200, documento_costo_repuestos: 200, ...o })

const usuarios = [
  { id: "t1", nombre: "Ana", organization_id: "org-1" },
  { id: "t2", nombre: "Beto", organization_id: "org-1" },
]

const pedir = (query = "") => GET(new Request(`http://localhost:3000/api/comisiones${query}`))

describe("GET /api/comisiones reads the single commission definition", () => {
  beforeEach(() => vi.clearAllMocks())

  it("TECNICO gets only own rows; another id is 403", async () => {
    mockAuthSuccess({ role: "TECNICO", userId: "t1" })
    montarSupabaseEnMemoria({
      v_comisiones_devengadas: [fila({}), fila({ clave: "k2", documento_id: "o2", beneficiario_id: "t2" })],
      users: usuarios,
    })

    const denied = await parseResponse(await pedir("?tecnicoId=t2"))
    expect(denied.status).toBe(403)
    expect(denied.body).toEqual({ error: "Acceso denegado" })

    const own = await parseResponse(await pedir())
    expect(own.status).toBe(200)
    expect(own.body.items).toHaveLength(1)
    expect(own.body.items[0]).toMatchObject({ tecnicoId: "t1", ordenId: "o1" })
  })

  it("maps a paid row from its payout and sums resumen from every row", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    montarSupabaseEnMemoria({
      v_comisiones_devengadas: [
        fila({}),
        fila({ clave: "k2", documento_id: "o2", monto: 50, pendiente: 0, base: 500, pagado: true, pago_id: "p1", fecha_pago: "2026-10-05T10:00:00Z" }),
      ],
      users: usuarios,
    })

    const res = await pedir()
    expect(res.headers.get("Cache-Control")).toBe("no-store")
    const { status, body } = await parseResponse(res)
    expect(status).toBe(200)
    expect(body.items.find((i: any) => i.pagoId === "p1")).toMatchObject({
      clave: "k2",
      ordenId: "o2",
      tecnicoNombre: "Ana",
      rol: "TECNICO",
      tipo: "ORIGINAL",
      comisionPagada: true,
      montoComision: 50,
      pendiente: 0,
      fechaPagoComision: "2026-10-05T10:00:00Z",
      ganancia: 500,
      porcentajeComision: 10,
      costoFinal: 1200,
      costoRepuestos: 200,
      codigoOrden: "CEL-1",
      numeroOrden: 1,
      dispositivo: "iPhone",
      estado: "ENTREGADO",
      fechaCompletado: "2026-10-01T10:00:00Z",
    })
    expect(body.resumen).toHaveLength(1)
    expect(body.resumen[0]).toMatchObject({ tecnicoId: "t1", tecnicoNombre: "Ana", totalOrdenes: 2, totalGanancia: 1500, totalComision: 150, totalPendiente: 100 })
  })

  it("forwards period and soloPendientes to the definition", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    montarSupabaseEnMemoria({
      v_comisiones_devengadas: [
        fila({ clave: "in-unpaid", fecha_devengo: "2026-10-03T10:00:00Z" }),
        fila({ clave: "in-paid", fecha_devengo: "2026-10-04T10:00:00Z", pagado: true, pago_id: "p1", pendiente: 0 }),
        fila({ clave: "out-unpaid", fecha_devengo: "2026-10-09T10:00:00Z" }),
        fila({ clave: "before-unpaid", fecha_devengo: "2026-09-30T10:00:00Z" }),
      ],
      users: usuarios,
    })

    const { status, body } = await parseResponse(await pedir("?desde=2026-10-01&hasta=2026-10-07T23:59:59&soloPendientes=true"))
    expect(status).toBe(200)
    expect(body.items.map((i: any) => i.clave)).toEqual(["in-unpaid"])
  })

  it("looks up names inside the org only", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const mem = montarSupabaseEnMemoria({
      v_comisiones_devengadas: [fila({})],
      users: [{ id: "t1", nombre: "Otra Org", organization_id: "org-2" }],
    })

    const { body } = await parseResponse(await pedir())
    expect(mem.lecturas).toContain("users")
    expect(body.items[0].tecnicoNombre).toBe("Sin nombre")
    expect(body.resumen[0].tecnicoNombre).toBe("Sin nombre")
  })

  it.each([
    ["", ["TECNICO"]],
    ["?rol=RECEPCION", ["RECEPCION"]],
    ["?rol=todos", ["TECNICO", "RECEPCION"]],
  ])("rol%s reads %j", async (q, roles) => {
    mockAuthSuccess({ role: "ADMIN" })
    montarSupabaseEnMemoria({
      v_comisiones_devengadas: [fila({}), fila({ clave: "r", rol: "RECEPCION", beneficiario_id: "t2" })],
      users: usuarios,
    })
    const { status, body } = await parseResponse(await pedir(q))
    expect(status).toBe(200)
    expect(new Set(body.items.map((i: any) => i.rol))).toEqual(new Set(roles))
  })

  it("an unknown rol is a 400", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    montarSupabaseEnMemoria({ v_comisiones_devengadas: [fila({})], users: usuarios })
    const { status, body } = await parseResponse(await pedir("?rol=VENDEDOR"))
    expect(status).toBe(400)
    expect(body).toEqual({ error: "Rol inválido" })
  })

  it("a non-admin with rol=todos gets only own rows of both roles", async () => {
    mockAuthSuccess({ role: "TECNICO", userId: "t1" })
    montarSupabaseEnMemoria({
      v_comisiones_devengadas: [
        fila({}),
        fila({ clave: "r1", rol: "RECEPCION", beneficiario_id: "t1" }),
        fila({ clave: "r2", rol: "RECEPCION", beneficiario_id: "t2" }),
      ],
      users: usuarios,
    })
    const { status, body } = await parseResponse(await pedir("?rol=todos"))
    expect(status).toBe(200)
    expect(body.items).toHaveLength(2)
    expect(body.items.every((i: any) => i.tecnicoId === "t1")).toBe(true)
  })

  it("a removed receiver keeps their name and pending rows", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    montarSupabaseEnMemoria({
      v_comisiones_devengadas: [fila({ clave: "r9", rol: "RECEPCION", beneficiario_id: "v9", monto: 42.5, pendiente: 42.5 })],
      users: [{ id: "v9", nombre: "Vera", organization_id: "org-1", activo: false, deleted_at: "2026-10-01" }],
    })
    const { body } = await parseResponse(await pedir("?rol=RECEPCION"))
    expect(body.items[0]).toMatchObject({ tecnicoNombre: "Vera" })
    expect(body.resumen[0]).toMatchObject({ tecnicoNombre: "Vera", totalPendiente: 42.5 })
  })

  it("500 when the definition read fails", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    montarSupabaseEnMemoria({ v_comisiones_devengadas: [fila({})], users: usuarios }, { errorDeLectura: { v_comisiones_devengadas: { message: "boom" } } })

    const { status, body } = await parseResponse(await pedir())
    expect(status).toBe(500)
    expect(body).toEqual({ error: "Error al obtener comisiones" })
  })
})
