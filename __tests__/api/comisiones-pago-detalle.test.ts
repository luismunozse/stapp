// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest"
import { mockAuthSuccess, parseResponse } from "./helpers"
import { montarSupabaseEnMemoria } from "../helpers/supabase-memoria"
import { GET } from "@/app/api/comisiones/pagos/[id]/route"

const pago = (o: Partial<Record<string, unknown>> = {}) => ({
  id: "p1",
  organization_id: "org-1",
  beneficiario_id: "t1",
  fecha_pago: "2026-10-20T12:00:00Z",
  total: 150,
  anulado: false,
  origen: "BACKFILL",
  ...o,
})
let seq = 0
const item = (o: Partial<Record<string, unknown>>) => ({ id: `i${++seq}`, pago_id: "p1", organization_id: "org-1", monto: 50, ...o })

const pedir = (id: string) =>
  GET(new Request(`http://localhost:3000/api/comisiones/pagos/${id}`), { params: Promise.resolve({ id }) })

describe("GET /api/comisiones/pagos/[id]", () => {
  beforeEach(() => vi.clearAllMocks())

  it("non-admins get 403 and read nothing", async () => {
    mockAuthSuccess({ role: "TECNICO" })
    const mem = montarSupabaseEnMemoria({ comisiones_pagos: [pago()], comisiones_pagos_items: [item({})], users: [] })
    const { status } = await parseResponse(await pedir("p1"))
    expect(status).toBe(403)
    expect(mem.lecturas).toEqual([])
  })

  it("another organization's payout is a 404", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    montarSupabaseEnMemoria({
      comisiones_pagos: [pago({ id: "p2", organization_id: "org-2" })],
      comisiones_pagos_items: [item({ pago_id: "p2", organization_id: "org-2" })],
      users: [],
    })
    const { status, body } = await parseResponse(await pedir("p2"))
    expect(status).toBe(404)
    expect(body).toEqual({ error: "Pago no encontrado." })
  })

  it("an unknown id is a 404", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    montarSupabaseEnMemoria({ comisiones_pagos: [pago()], comisiones_pagos_items: [], users: [] })
    const { status, body } = await parseResponse(await pedir("nope"))
    expect(status).toBe(404)
    expect(body).toEqual({ error: "Pago no encontrado." })
  })

  it("returns the payout summary with the item count and the beneficiary name of the same org", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    montarSupabaseEnMemoria({
      comisiones_pagos: [pago()],
      comisiones_pagos_items: [item({}), item({}), item({}), item({ pago_id: "other" }), item({ organization_id: "org-2" })],
      users: [
        { id: "t1", nombre: "Ana", organization_id: "org-1" },
        { id: "t1", nombre: "Otra Org", organization_id: "org-2" },
      ],
    })
    const { status, body } = await parseResponse(await pedir("p1"))
    expect(status).toBe(200)
    expect(body).toEqual({
      pagoId: "p1",
      fechaPago: "2026-10-20T12:00:00Z",
      origen: "BACKFILL",
      total: 150,
      anulado: false,
      filas: 3,
      beneficiarioNombre: "Ana",
    })
  })

  it("falls back to a dash when the beneficiary has no user in the org", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    montarSupabaseEnMemoria({ comisiones_pagos: [pago()], comisiones_pagos_items: [item({})], users: [] })
    const { body } = await parseResponse(await pedir("p1"))
    expect(body.beneficiarioNombre).toBe("—")
  })
})
