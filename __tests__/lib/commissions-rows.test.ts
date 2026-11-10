// @vitest-environment node
import { describe, it, expect, vi } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import { montarSupabaseEnMemoria } from "../helpers/supabase-memoria"
import {
  readCommissionRows,
  readDocumentCommissionRows,
  summarizeByBeneficiary,
  toCommissionRow as toRow,
} from "@/lib/commissions/rows"

const fila = (o: Partial<Record<string, unknown>>) => ({ clave: "ORDEN:o1:TECNICO:ORIGINAL:-", organization_id: "org-1", sucursal_id: null, documento_tipo: "ORDEN", documento_id: "o1", beneficiario_id: "t1", rol: "TECNICO", tipo: "ORIGINAL", ajuste_ref: null, base: 1000, porcentaje: 10, monto: 100, fecha_devengo: "2026-10-01T10:00:00Z", devengada: true, pago_id: null, fecha_pago: null, pagado: false, pendiente: 100, documento_codigo: "CEL-1", documento_numero: 1, documento_detalle: "iPhone", documento_estado: "ENTREGADO", documento_total: 1200, documento_costo_repuestos: 200, ...o })

describe("commission rows reader", () => {
  it("reads only the caller's org and roles, and keeps zero rows (slice 1 parity)", async () => {
    montarSupabaseEnMemoria({ v_comisiones_devengadas: [fila({}), fila({ clave: "x2", organization_id: "org-2" }), fila({ clave: "x3", monto: 0, pendiente: 0 }), fila({ clave: "x4", monto: 0, pendiente: 0, pagado: true, pago_id: "p1" }), fila({ clave: "x5", rol: "VENDEDOR" })] })
    const rows = await readCommissionRows({ organizationId: "org-1", roles: ["TECNICO"] })
    expect(rows.map((r) => r.clave).sort()).toEqual(["ORDEN:o1:TECNICO:ORIGINAL:-", "x3", "x4"])
    expect(rows[0]).toMatchObject({ monto: 100, base: 1000, porcentaje: 10, pagado: false })
  })
  it("reads past the 1000-row PostgREST cap", async () => {
    const pagina = (n: number) => Array.from({ length: n }, (_, i) => fila({ clave: `k${n}-${i}` }))
    const range = vi.fn((a: number) => Promise.resolve({ data: a === 0 ? pagina(1000) : pagina(3), error: null }))
    const chain: any = new Proxy({}, { get: (_t, p) => (p === "range" ? range : () => chain) })
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain)
    const rows = await readCommissionRows({ organizationId: "org-1", roles: ["TECNICO"] })
    expect(rows).toHaveLength(1003)
    expect(range).toHaveBeenNthCalledWith(2, 1000, 1999)
    expect(summarizeByBeneficiary(rows)[0].monto).toBe(100300)
  })
  it("throws instead of returning an empty list on a query error", async () => {
    montarSupabaseEnMemoria({ v_comisiones_devengadas: [fila({})] }, { errorDeLectura: { v_comisiones_devengadas: { message: "boom" } } })
    await expect(readCommissionRows({ organizationId: "org-1", roles: ["TECNICO"] })).rejects.toThrow()
  })
  it("summaries count ORIGINAL rows but net every row", () => {
    const rows = [toRow(fila({})), toRow(fila({ clave: "a", tipo: "AJUSTE_DEVOLUCION", monto: -30.1, pendiente: -30.1, base: 301 }))]
    expect(summarizeByBeneficiary(rows)).toEqual([{ beneficiarioId: "t1", originales: 1, base: 1000, documentoTotal: 1200, monto: 69.9, pendiente: 69.9 }])
  })
  it("document rows come from v_comisiones_filas and keep zero and non-accrued rows", async () => {
    montarSupabaseEnMemoria({ v_comisiones_filas: [fila({ monto: 0, pendiente: 0, devengada: false }), fila({ clave: "o2", documento_id: "o2" })] })
    expect(await readDocumentCommissionRows("org-1", "ORDEN", "o1")).toHaveLength(1)
  })
  it("maps the order-only columns and keeps NULL as null", () => {
    expect(toRow(fila({ base_tipo: "MANO_DE_OBRA", documento_monto: "850.00", motivo_sin_devengo: "SIN_REPARACION" }))).toMatchObject({ baseTipo: "MANO_DE_OBRA", documentoMonto: 850, motivoSinDevengo: "SIN_REPARACION" })
    expect(toRow(fila({}))).toMatchObject({ baseTipo: null, documentoMonto: null, motivoSinDevengo: null })
  })
})
