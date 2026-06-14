import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import { fetchMovimientosDia } from "@/lib/caja-utils"

// Helper to build a chainable Supabase query mock that captures eq() calls
function makeQueryChain(finalData: any[]) {
  const eqCalls: Array<[string, string]> = []
  const chain: any = {
    _eqCalls: eqCalls,
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockImplementation((col: string, val: string) => {
      eqCalls.push([col, val])
      return chain
    }),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
  }
  // Make thenable
  chain.then = (resolve: any) => resolve({ data: finalData, error: null })
  chain.catch = (reject: any) => Promise.resolve({ data: finalData, error: null }).catch(reject)
  return chain
}

const ORG_ID = "org-1"
const FECHA_DESDE = "2024-01-01T00:00:00Z"
const FECHA_HASTA = "2024-01-01T23:59:59Z"

describe("fetchMovimientosDia — sucursal filtering", () => {
  beforeEach(() => vi.clearAllMocks())

  it("without sucursalId — passes no sucursal_id eq filter and includes cuenta_corriente", async () => {
    const cobrosChain = makeQueryChain([])
    const facturaChain = makeQueryChain([])
    const ventaChain = makeQueryChain([])
    const ccChain = makeQueryChain([])
    const movChain = makeQueryChain([])

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "cobros_orden") return cobrosChain
      if (table === "pagos_parciales") return facturaChain
      if (table === "pagos_venta") return ventaChain
      if (table === "cuenta_corriente") return ccChain
      if (table === "movimientos_caja") return movChain
      return makeQueryChain([])
    })

    await fetchMovimientosDia(ORG_ID, FECHA_DESDE, FECHA_HASTA)

    // cuenta_corriente SHOULD be queried when no sucursalId
    expect(supabaseAdmin.from).toHaveBeenCalledWith("cuenta_corriente")
    // No sucursal_id eq filter on movimientos_caja
    const movEqCalls = movChain._eqCalls as [string, string][]
    const hasSucursalFilter = movEqCalls.some(([col]) => col === "sucursal_id")
    expect(hasSucursalFilter).toBe(false)
  })

  it("with sucursalId — adds sucursal_id filter to movimientos_caja and omits cuenta_corriente", async () => {
    const cobrosChain = makeQueryChain([])
    const facturaChain = makeQueryChain([])
    const ventaChain = makeQueryChain([])
    const movChain = makeQueryChain([])

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "cobros_orden") return cobrosChain
      if (table === "pagos_parciales") return facturaChain
      if (table === "pagos_venta") return ventaChain
      if (table === "movimientos_caja") return movChain
      // cuenta_corriente should NOT be called when sucursalId is provided
      if (table === "cuenta_corriente") {
        throw new Error("cuenta_corriente should not be queried when sucursalId is set")
      }
      return makeQueryChain([])
    })

    await fetchMovimientosDia(ORG_ID, FECHA_DESDE, FECHA_HASTA, undefined, "suc-A")

    // sucursal_id eq filter SHOULD be applied to movimientos_caja
    const movEqCalls = movChain._eqCalls as [string, string][]
    const sucursalFilter = movEqCalls.find(([col]) => col === "sucursal_id")
    expect(sucursalFilter).toBeDefined()
    expect(sucursalFilter![1]).toBe("suc-A")
  })

  it("with sucursalId — filters pagos_venta by ventas.sucursal_id", async () => {
    const cobrosChain = makeQueryChain([])
    const facturaChain = makeQueryChain([])
    const ventaChain = makeQueryChain([])
    const movChain = makeQueryChain([])

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "cobros_orden") return cobrosChain
      if (table === "pagos_parciales") return facturaChain
      if (table === "pagos_venta") return ventaChain
      if (table === "movimientos_caja") return movChain
      return makeQueryChain([])
    })

    await fetchMovimientosDia(ORG_ID, FECHA_DESDE, FECHA_HASTA, undefined, "suc-B")

    const ventaEqCalls = ventaChain._eqCalls as [string, string][]
    const sucursalFilter = ventaEqCalls.find(([col]) => col === "ventas.sucursal_id")
    expect(sucursalFilter).toBeDefined()
    expect(sucursalFilter![1]).toBe("suc-B")
  })

  it("with null sucursalId — behaves same as omitted (no filtering)", async () => {
    const cobrosChain = makeQueryChain([])
    const facturaChain = makeQueryChain([])
    const ventaChain = makeQueryChain([])
    const ccChain = makeQueryChain([])
    const movChain = makeQueryChain([])

    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "cobros_orden") return cobrosChain
      if (table === "pagos_parciales") return facturaChain
      if (table === "pagos_venta") return ventaChain
      if (table === "cuenta_corriente") return ccChain
      if (table === "movimientos_caja") return movChain
      return makeQueryChain([])
    })

    await fetchMovimientosDia(ORG_ID, FECHA_DESDE, FECHA_HASTA, undefined, null)

    // cuenta_corriente should be queried when sucursalId is null
    expect(supabaseAdmin.from).toHaveBeenCalledWith("cuenta_corriente")
    const movEqCalls = movChain._eqCalls as [string, string][]
    const hasSucursalFilter = movEqCalls.some(([col]) => col === "sucursal_id")
    expect(hasSucursalFilter).toBe(false)
  })
})
