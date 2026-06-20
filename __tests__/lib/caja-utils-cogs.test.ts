// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import { fetchMovimientosDia, computeTotales, esMovimientoCogsAutomatico } from "@/lib/caja-utils"

// Helper to build a chainable Supabase query mock returning fixed data
function makeQueryChain(finalData: any[]) {
  const chain: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
  }
  chain.then = (resolve: any) => resolve({ data: finalData, error: null })
  chain.catch = (reject: any) => Promise.resolve({ data: finalData, error: null }).catch(reject)
  return chain
}

const ORG_ID = "org-1"
const FECHA_DESDE = "2024-01-01T00:00:00Z"
const FECHA_HASTA = "2024-01-01T23:59:59Z"

describe("esMovimientoCogsAutomatico", () => {
  it("returns true for the auto-generated COGS egreso (accented concepto)", () => {
    expect(
      esMovimientoCogsAutomatico({
        tipo: "EGRESO",
        afecta_rentabilidad: false,
        concepto: "Costo de mercadería - Venta #12",
      })
    ).toBe(true)
  })

  it("returns true for the auto-generated COGS egreso (non-accented concepto)", () => {
    expect(
      esMovimientoCogsAutomatico({
        tipo: "EGRESO",
        afecta_rentabilidad: false,
        concepto: "Costo de mercaderia - Venta #12",
      })
    ).toBe(true)
  })

  it("returns false for 'Retiro de socio' (real cash egreso, afecta_rentabilidad=false)", () => {
    // Critical: a partner withdrawal IS real cash leaving the drawer and must
    // remain in the arqueo even though it does not affect profitability.
    expect(
      esMovimientoCogsAutomatico({
        tipo: "EGRESO",
        afecta_rentabilidad: false,
        concepto: "Retiro de socio",
      })
    ).toBe(false)
  })

  it("returns false for a normal manual egreso (afecta_rentabilidad=true)", () => {
    expect(
      esMovimientoCogsAutomatico({
        tipo: "EGRESO",
        afecta_rentabilidad: true,
        concepto: "Pago de proveedor",
      })
    ).toBe(false)
  })

  it("returns false for an INGRESO even if concepto matches", () => {
    expect(
      esMovimientoCogsAutomatico({
        tipo: "INGRESO",
        afecta_rentabilidad: false,
        concepto: "Costo de mercadería - Venta #12",
      })
    ).toBe(false)
  })
})

describe("fetchMovimientosDia — excludes auto-generated COGS", () => {
  beforeEach(() => vi.clearAllMocks())

  const cogsRow = {
    id: "cogs-1",
    tipo: "EGRESO",
    monto: "300",
    metodo_pago: "EFECTIVO",
    concepto: "Costo de mercaderia - Venta #5",
    observaciones: "Egreso automatico por costo de productos vendidos",
    fecha: "2024-01-01T10:00:00Z",
    afecta_rentabilidad: false,
  }
  const retiroSocio = {
    id: "mov-retiro",
    tipo: "EGRESO",
    monto: "100",
    metodo_pago: "EFECTIVO",
    concepto: "Retiro de socio",
    observaciones: null,
    fecha: "2024-01-01T11:00:00Z",
    afecta_rentabilidad: false,
  }
  const aporte = {
    id: "mov-aporte",
    tipo: "INGRESO",
    monto: "500",
    metodo_pago: "EFECTIVO",
    concepto: "Aporte de caja",
    observaciones: null,
    fecha: "2024-01-01T12:00:00Z",
    afecta_rentabilidad: true,
  }

  function mockTables(movRows: any[]) {
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === "movimientos_caja") return makeQueryChain(movRows) as any
      return makeQueryChain([]) as any
    })
  }

  it("does not return the auto-COGS row", async () => {
    mockTables([cogsRow, retiroSocio, aporte])

    const result = await fetchMovimientosDia(ORG_ID, FECHA_DESDE, FECHA_HASTA)

    const ids = result.map((m) => m.referenciaId)
    expect(ids).not.toContain("cogs-1")
    expect(ids).toContain("mov-retiro")
    expect(ids).toContain("mov-aporte")
  })

  it("keeps the auto-COGS amount out of the cash arqueo totals", async () => {
    mockTables([cogsRow, retiroSocio, aporte])

    const result = await fetchMovimientosDia(ORG_ID, FECHA_DESDE, FECHA_HASTA)
    const totales = computeTotales(result)

    // Only the real cash egreso (Retiro 100) counts, NOT the phantom COGS (300)
    expect(totales.totalEgresosEfectivo).toBe(100)
    expect(totales.totalIngresosEfectivo).toBe(500)
  })
})
