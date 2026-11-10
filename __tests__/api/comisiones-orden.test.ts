// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest"
import { mockAuthSuccess, parseResponse } from "./helpers"
import { montarSupabaseEnMemoria } from "../helpers/supabase-memoria"
import { GET } from "@/app/api/comisiones/orden/[id]/route"

const fila = (o: Partial<Record<string, unknown>>) => ({ clave: "ORDEN:o1:TECNICO:ORIGINAL:-", organization_id: "org-1", sucursal_id: null, documento_tipo: "ORDEN", documento_id: "o1", beneficiario_id: "t1", rol: "TECNICO", tipo: "ORIGINAL", ajuste_ref: null, base: 0, porcentaje: 10, monto: 0, fecha_devengo: null, devengada: false, pago_id: null, fecha_pago: null, pagado: false, pendiente: 0, documento_codigo: "OR-1", documento_numero: 1, documento_detalle: "Telefono", documento_estado: "EN_REPARACION", documento_total: 1000, documento_costo_repuestos: 200, ...o })

const pedir = (id: string) => GET(new Request(`http://localhost:3000/api/comisiones/orden/${id}`), { params: Promise.resolve({ id }) })

describe("GET /api/comisiones/orden/[id]", () => {
  beforeEach(() => vi.clearAllMocks())

  it("non-admins get 403", async () => {
    mockAuthSuccess({ role: "TECNICO" })
    montarSupabaseEnMemoria({ v_comisiones_filas: [fila({})], users: [] })
    const { status } = await parseResponse(await pedir("o1"))
    expect(status).toBe(403)
  })

  it("returns the order's rows in the caller's org, zero and projected rows included", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    montarSupabaseEnMemoria({
      v_comisiones_filas: [
        fila({ clave: "a" }),
        fila({ clave: "b", organization_id: "org-2" }),
        fila({ clave: "c", documento_id: "o2" }),
      ],
      users: [
        { id: "t1", nombre: "Ana", organization_id: "org-1" },
        { id: "t1", nombre: "Otra Org", organization_id: "org-2" },
      ],
    })
    const { status, body } = await parseResponse(await pedir("o1"))
    expect(status).toBe(200)
    expect(body.filas).toHaveLength(1)
    expect(body.filas[0]).toMatchObject({ clave: "a", devengada: false, monto: 0, beneficiarioNombre: "Ana" })
  })

  it("falls back to a dash when no user of the org matches", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    montarSupabaseEnMemoria({ v_comisiones_filas: [fila({})], users: [] })
    const { body } = await parseResponse(await pedir("o1"))
    expect(body.filas[0].beneficiarioNombre).toBe("—")
  })
  it("returns the reception row with its beneficiary name", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    montarSupabaseEnMemoria({
      v_comisiones_filas: [
        fila({ clave: "a" }),
        fila({ clave: "r", rol: "RECEPCION", beneficiario_id: "r1", base: 850, porcentaje: 5, monto: 42.5, base_tipo: "MONTO_ORDEN", documento_monto: 850 }),
      ],
      users: [
        { id: "t1", nombre: "Ana", organization_id: "org-1" },
        { id: "r1", nombre: "Rita", organization_id: "org-1" },
      ],
    })
    const { body } = await parseResponse(await pedir("o1"))
    expect(body.filas).toHaveLength(2)
    expect(body.filas.find((f: any) => f.rol === "RECEPCION")).toMatchObject({ clave: "r", beneficiarioId: "r1", beneficiarioNombre: "Rita", baseTipo: "MONTO_ORDEN", documentoMonto: 850 })
  })
})
