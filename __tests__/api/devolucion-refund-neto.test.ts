import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, createPostRequest, parseResponse } from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

vi.mock("@/lib/counters", () => ({
  getNextReturnNumber: vi.fn().mockResolvedValue("DEV-000001"),
}))
vi.mock("@/lib/audit", () => ({
  createAuditLogger: vi.fn(() => ({ create: vi.fn().mockResolvedValue(undefined) })),
}))

import { POST } from "@/app/api/ventas/[id]/devolucion/route"

// Venta: 10 × $100 con 10% de descuento de línea → cliente pagó $900.
// El bug reembolsaba el bruto ($1000); el fix reembolsa el neto ($900).
const VENTA = {
  id: "v1",
  estado: "COMPLETADA",
  cliente_id: "c1",
  organization_id: "org-1",
  sucursal_id: "suc-1",
  total: 900,
  subtotal: 1000,
  descuento: 100,
  items_venta: [
    {
      id: "iv1",
      cantidad: 10,
      descripcion: "Item con descuento",
      inventario_id: null,
      precio_unitario: 100,
      descuento: 0,
      tipo_descuento: "PORCENTAJE",
      porcentaje_descuento: 10,
    },
  ],
}

function buildDevChain() {
  const insertResult = { id: "d1", items_devolucion: [] }
  let n = 0
  const chain: any = {}
  const methods = ["select","insert","update","upsert","delete","eq","neq","not","gte","lte","gt","lt","or","in","is","textSearch","order","limit","range","maybeSingle"]
  for (const m of methods) chain[m] = vi.fn().mockReturnValue(chain)
  chain.single = vi.fn().mockResolvedValue({ data: insertResult, error: null })
  chain.then = (resolve: any, reject?: any) => {
    n++
    const result = n === 1 ? { data: [], error: null } : { data: insertResult, error: null }
    return Promise.resolve(result).then(resolve, reject)
  }
  chain.catch = (reject: any) => Promise.resolve({ data: [], error: null }).catch(reject)
  return chain
}

describe("devolución (fallback JS) — reembolso neto de descuentos (bug #2)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Forzar el fallback JS: la RPC reporta "no existe".
    vi.mocked(supabaseAdmin.rpc).mockImplementation(((fn: string) => {
      if (fn === "registrar_devolucion_atomica") {
        return Promise.resolve({ data: null, error: { code: "42883", message: "does not exist" } })
      }
      return Promise.resolve({ data: {}, error: null })
    }) as any)
  })

  it("reembolsa a CC el neto ($900) y NO el bruto ($1000) en devolución total", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const devChain = buildDevChain()
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "ventas") return createChainMock(VENTA) as any
      if (table === "devoluciones_venta") return devChain
      if (table === "items_devolucion") return createChainMock({ id: "id1" }) as any
      return createChainMock(null, { message: `No mock: ${table}` }) as any
    })

    const res = await POST(
      createPostRequest({
        motivo: "Defectuoso",
        metodoReembolso: "CUENTA_CORRIENTE",
        items: [{ itemVentaId: "iv1", cantidad: 10, precioUnitario: 100, restaurarStock: false }],
      }, "http://localhost/api/ventas/v1/devolucion"),
      { params: Promise.resolve({ id: "v1" }) } as any
    )
    const { status } = await parseResponse(res)
    expect(status).toBe(201)

    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "devolver_cuenta_corriente",
      expect.objectContaining({ p_cliente_id: "c1", p_monto: 900 })
    )
    // La devolución guardada refleja el neto, no el bruto.
    expect(devChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ monto_devolucion: 900 })
    )
  })

  it("devolución parcial (5 de 10 uds) reembolsa $450", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const devChain = buildDevChain()
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "ventas") return createChainMock(VENTA) as any
      if (table === "devoluciones_venta") return devChain
      if (table === "items_devolucion") return createChainMock({ id: "id1" }) as any
      return createChainMock(null, { message: `No mock: ${table}` }) as any
    })

    await POST(
      createPostRequest({
        motivo: "Defectuoso",
        metodoReembolso: "CUENTA_CORRIENTE",
        items: [{ itemVentaId: "iv1", cantidad: 5, precioUnitario: 100, restaurarStock: false }],
      }, "http://localhost/api/ventas/v1/devolucion"),
      { params: Promise.resolve({ id: "v1" }) } as any
    )

    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      "devolver_cuenta_corriente",
      expect.objectContaining({ p_monto: 450 })
    )
  })
})
