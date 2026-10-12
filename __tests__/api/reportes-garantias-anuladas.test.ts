/**
 * ANULADA (migración 316) is a fourth warranty state: a return retired it.
 *
 * The report counted only ACTIVA / VENCIDA / RECLAMADA against a `totalGarantias`
 * that counted every row, so annulled warranties fell into a silent gap — the
 * three buckets stopped summing to the total with no line saying where the rest
 * went. And `tasaReclamo` kept them in the denominator, diluting the claim rate
 * of a product with warranties nobody could claim any more.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { mockAuthSuccess, createChainMock, parseResponse } from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

const garantia = (id: string, estado: string, descripcion = "Cargador") => ({
  id,
  estado,
  numero_garantia: `GAR-${id}`,
  fecha_inicio: "2026-01-01",
  created_at: "2026-01-01T00:00:00Z",
  dias_validez: 30,
  items_venta: { descripcion },
  ventas: { numero_venta: 1, cliente_nombre: "Ana", organization_id: "org-1", sucursal_id: null },
})

/**
 * garantias_venta se consulta dos veces: primero las por vencer y después
 * todas (paginada), de la que salen el resumen, la tasa y la distribución.
 */
function mockReport(rows: any[]) {
  const porVencerChain = createChainMock([])
  const todasChain = createChainMock(rows)

  let callCount = 0
  vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
    if (table === "garantias_venta") {
      callCount++
      return (callCount === 1 ? porVencerChain : todasChain) as any
    }
    return createChainMock([]) as any
  })
}

async function get() {
  const { GET } = await import("@/app/api/reportes/garantias-ventas/route")
  return parseResponse(await GET())
}

describe("GET /api/reportes/garantias-ventas — ANULADA", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mockAuthSuccess()
  })

  it("counts annulled warranties in their own bucket", async () => {
    mockReport([
      garantia("g1", "ACTIVA"),
      garantia("g2", "ANULADA"),
      garantia("g3", "ANULADA"),
    ])

    const { status, body } = await get()

    expect(status).toBe(200)
    expect(body.resumen.totalAnuladas).toBe(2)
    expect(body.resumen.totalActivas).toBe(1)
  })

  it("keeps the state buckets summing to totalGarantias", async () => {
    mockReport([
      garantia("g1", "ACTIVA"),
      garantia("g2", "VENCIDA"),
      garantia("g3", "RECLAMADA"),
      garantia("g4", "ANULADA"),
    ])

    const { body } = await get()
    const { totalActivas, totalVencidas, totalReclamadas, totalAnuladas, totalGarantias } = body.resumen

    expect(totalActivas + totalVencidas + totalReclamadas + totalAnuladas).toBe(totalGarantias)
  })

  it("drops annulled warranties from the tasaReclamo denominator", async () => {
    // 1 claimed out of 2 claimable (the other 2 were returned) = 50%, not 25%.
    mockReport([
      garantia("g1", "RECLAMADA", "Cargador"),
      garantia("g2", "ACTIVA", "Cargador"),
      garantia("g3", "ANULADA", "Cargador"),
      garantia("g4", "ANULADA", "Cargador"),
    ])

    const { body } = await get()
    const cargador = body.tasaReclamo.find((p: any) => p.producto === "Cargador")

    expect(cargador).toBeDefined()
    expect(cargador.totalGarantias).toBe(2)
    expect(cargador.tasaReclamo).toBe(50)
  })

  it("una garantía ACTIVA con la fecha cumplida cuenta como vencida (nadie le cambia el estado)", async () => {
    mockReport([
      { ...garantia("g1", "ACTIVA"), fecha_vencimiento: "2020-01-31T00:00:00Z" },
      { ...garantia("g2", "ACTIVA"), fecha_vencimiento: "2999-01-31T00:00:00Z" },
    ])

    const { body } = await get()

    expect(body.resumen.totalVencidas).toBe(1)
    expect(body.resumen.totalActivas).toBe(1)
  })
})
