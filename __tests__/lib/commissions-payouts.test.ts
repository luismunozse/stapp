import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import { parseResponse } from "../api/helpers"
import { montarSupabaseEnMemoria } from "../helpers/supabase-memoria"
import {
  annulBodySchema,
  annulCommissionPayout,
  commissionRpcError,
  liquidarBodySchema,
  payBodySchema,
  payCommissions,
} from "@/lib/commissions/payouts"

describe("payout body row cap", () => {
  const filas = (n: number) => Array.from({ length: n }, (_, i) => ({ clave: "k" + i, monto: 1 }))
  const MSG = "Elegí hasta 500 comisiones por pago."

  it("500 rows pass, 501 fail with the cap message", () => {
    expect(payBodySchema.safeParse({ beneficiarioId: "t1", filas: filas(500) }).success).toBe(true)
    const r = payBodySchema.safeParse({ beneficiarioId: "t1", filas: filas(501) })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0].message).toBe(MSG)
  })

  it("liquidar inherits the cap", () => {
    expect(liquidarBodySchema.safeParse({ filas: filas(500) }).success).toBe(true)
    expect(liquidarBodySchema.safeParse({ filas: filas(501) }).success).toBe(false)
  })
})

describe("commission payouts", () => {
  beforeEach(() => {
    vi.mocked(supabaseAdmin.rpc).mockReset()
  })

  it.each([
    ["COMISION_ERROR:MONTO_DISTINTO:VENTA:v1:VENDEDOR:ORIGINAL:-", 409],
    ["COMISION_ERROR:OTRO_BENEFICIARIO:x", 409],
    ["COMISION_ERROR:AJUSTES_PAGADOS:p2", 409],
    ["COMISION_ERROR:NO_AUTORIZADO", 403],
    ["COMISION_ERROR:SIN_FILAS", 400],
    ["COMISION_ERROR:PAGO_NO_ENCONTRADO", 404],
    ["prefix noise COMISION_ERROR:PAGO_YA_ANULADO", 409],
  ])("maps %s to %i", (message, status) =>
    expect(commissionRpcError({ code: "P0001", message })?.status).toBe(status))

  it("a concurrent duplicate (23505) is a 409, not a 500", () =>
    expect(commissionRpcError({ code: "23505", message: "duplicate key" })?.status).toBe(409))
  it("unknown errors are not mapped", () =>
    expect(commissionRpcError({ code: "XX000", message: "boom" })).toBeNull())
  it("null error is null", () => expect(commissionRpcError(null)).toBeNull())
  it("AJUSTES_PAGADOS keeps the id of the blocking payout", () =>
    expect(commissionRpcError({ code: "P0001", message: "COMISION_ERROR:AJUSTES_PAGADOS:p2" })).toMatchObject({ status: 409, pagoBloqueanteId: "p2" }))

  it("payCommissions sends the rows and amounts as given and returns the payout", async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { pagoId: "p1", total: 70, filas: 2 }, error: null } as any)
    const res = await payCommissions({ organizationId: "org-1", userId: "a1", beneficiarioId: "t1", filas: [{ clave: "k1", monto: 100 }, { clave: "k2", monto: -30 }], notas: " semana " })
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("pagar_comisiones", { p_organization_id: "org-1", p_usuario_id: "a1", p_beneficiario_id: "t1", p_filas: [{ clave: "k1", monto: 100 }, { clave: "k2", monto: -30 }], p_notas: "semana" })
    expect((await parseResponse(res)).body).toEqual({ pagoId: "p1", total: 70, filas: 2 })
  })

  it("annulBodySchema rejects a blank reason", () =>
    expect(annulBodySchema.safeParse({ pagoId: "p1", motivo: "  " }).success).toBe(false))

  it("annulCommissionPayout sends its params and answers 500 on an unmapped error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: null, error: { code: "XX000", message: "boom" } } as any)
    const res = await annulCommissionPayout({ organizationId: "org-1", userId: "a1", pagoId: "p1", motivo: "error" })
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith("anular_pago_comisiones", { p_organization_id: "org-1", p_usuario_id: "a1", p_pago_id: "p1", p_motivo: "error" })
    const parsed = await parseResponse(res)
    expect(parsed.status).toBe(500)
    expect(parsed.body).toEqual({ error: "Error al anular el pago" })
  })

  describe("AJUSTES_PAGADOS names the blocking payout", () => {
    const bloqueado = { code: "P0001", message: "COMISION_ERROR:AJUSTES_PAGADOS:p2" }
    const anular = () => annulCommissionPayout({ organizationId: "org-1", userId: "a1", pagoId: "p1", motivo: "error" })

    it("says the date of that payout (looked up in the same org)", async () => {
      montarSupabaseEnMemoria(
        { comisiones_pagos: [{ id: "p2", organization_id: "org-1", fecha_pago: "2026-10-20T15:00:00Z" }, { id: "p2", organization_id: "org-2", fecha_pago: "2026-01-01T15:00:00Z" }] },
        { errorRpc: () => bloqueado },
      )
      const parsed = await parseResponse(await anular())
      expect(parsed.status).toBe(409)
      expect(parsed.body).toEqual({ error: "Primero anulá el pago del 20/10/2026, que tiene ajustes de este." })
    })

    it("falls back to the generic text when the payout cannot be found", async () => {
      montarSupabaseEnMemoria({ comisiones_pagos: [] }, { errorRpc: () => bloqueado })
      const parsed = await parseResponse(await anular())
      expect(parsed.status).toBe(409)
      expect(parsed.body.error).toMatch(/^Un pago posterior ya liquidó ajustes/)
    })

    it("falls back to the generic text when the lookup fails", async () => {
      montarSupabaseEnMemoria({ comisiones_pagos: [{ id: "p2", organization_id: "org-1", fecha_pago: "2026-10-20T15:00:00Z" }] }, {
        errorRpc: () => bloqueado,
        errorDeLectura: { comisiones_pagos: { message: "boom" } },
      })
      const parsed = await parseResponse(await anular())
      expect(parsed.status).toBe(409)
      expect(parsed.body.error).toMatch(/^Un pago posterior ya liquidó ajustes/)
    })
  })
})
