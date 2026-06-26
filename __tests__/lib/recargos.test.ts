// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import { getRecargosMetodo, factorRecargo } from "@/lib/recargos"

describe("getRecargosMetodo", () => {
  beforeEach(() => vi.clearAllMocks())

  it("devuelve mapa método→porcentaje de filas activas", async () => {
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      then: (resolve: any) =>
        resolve({
          data: [
            { metodo_pago: "CUENTA_CORRIENTE", porcentaje: "15" },
            { metodo_pago: "TARJETA_CREDITO", porcentaje: "20" },
          ],
          error: null,
        }),
    }
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain as any)

    const map = await getRecargosMetodo("org-1")
    expect(map).toEqual({ CUENTA_CORRIENTE: 15, TARJETA_CREDITO: 20 })
  })

  it("devuelve {} ante error de DB (fail-safe: sin recargos)", async () => {
    const chain: any = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      then: (resolve: any) => resolve({ data: null, error: { message: "boom" } }),
    }
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain as any)
    expect(await getRecargosMetodo("org-1")).toEqual({})
  })
})

describe("factorRecargo", () => {
  it("1 + %/100; método sin config => 1.0", () => {
    const map = { CUENTA_CORRIENTE: 15 }
    expect(factorRecargo(map, "CUENTA_CORRIENTE")).toBeCloseTo(1.15)
    expect(factorRecargo(map, "EFECTIVO")).toBe(1)
  })
})
