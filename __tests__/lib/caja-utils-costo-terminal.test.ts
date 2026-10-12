// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import { fetchMovimientosDia } from "@/lib/caja-utils"

function chain(data: any[]) {
  const c: any = {}
  for (const m of ["select", "eq", "neq", "gte", "lte", "order"]) c[m] = vi.fn().mockReturnValue(c)
  c.then = (resolve: any) => resolve({ data, error: null })
  return c
}

describe("fetchMovimientosDia: costo de terminal de los cobros de orden", () => {
  beforeEach(() => vi.clearAllMocks())

  it("el movimiento de un cobro de orden trae porcentaje y monto del costo (para precargar el diálogo)", async () => {
    const cobros = chain([
      {
        id: "c-1",
        monto: "1000",
        metodo_pago: "TARJETA_DEBITO",
        created_at: "2026-10-03T15:00:00Z",
        orden_id: "o-1",
        observaciones: null,
        costo_financiero_porcentaje: "2.5",
        costo_financiero_monto: "25",
        ordenes_servicio: { numero_orden: 7, sucursal_id: null },
      },
    ])
    vi.mocked(supabaseAdmin.from).mockImplementation(((table: string) =>
      table === "cobros_orden" ? cobros : chain([])) as any)

    const movimientos = await fetchMovimientosDia("org-1", "2026-10-03T00:00:00Z", "2026-10-03T23:59:59Z")
    const mov = movimientos.find((m: any) => m.fuente === "cobros_orden")
    expect(mov).toMatchObject({ costoFinancieroPorcentaje: 2.5, costoFinancieroMonto: 25 })
    expect(String(cobros.select.mock.calls[0][0])).toContain("costo_financiero_porcentaje")
  })
})
