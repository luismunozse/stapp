import { describe, it, expect, vi } from "vitest"
import { transicionarOrden } from "../orden-transicion"

// Mock mínimo de un cliente Supabase: la cadena es thenable y resuelve { data, error }.
function mockSupabase(finalData: any, finalError: any = null) {
  const chain: any = {}
  for (const m of ["update", "eq", "select"]) chain[m] = vi.fn().mockReturnValue(chain)
  chain.then = (resolve: any, reject?: any) =>
    Promise.resolve({ data: finalData, error: finalError }).then(resolve, reject)
  const from = vi.fn().mockReturnValue(chain)
  return { supabase: { from } as any, chain, from }
}

describe("transicionarOrden", () => {
  const base = { ordenId: "o1", organizationId: "org-1" as string }

  it("rechaza una transición inválida sin tocar la DB", async () => {
    const { supabase, from } = mockSupabase(null)
    const res = await transicionarOrden(supabase, {
      ...base, esperado: "APROBADO", nuevo: "EN_DIAGNOSTICO",
    })
    expect(res).toEqual({
      ok: false, motivo: "TRANSICION_INVALIDA", mensaje: expect.stringContaining("APROBADO"),
    })
    expect(from).not.toHaveBeenCalled()
  })

  it("aplica una transición válida cuando el UPDATE afecta 1 fila", async () => {
    const { supabase, chain } = mockSupabase([{ id: "o1" }])
    const res = await transicionarOrden(supabase, {
      ...base, esperado: "PRESUPUESTADO", nuevo: "APROBADO",
    })
    expect(res).toEqual({ ok: true, estado: "APROBADO" })
    expect(chain.eq).toHaveBeenCalledWith("estado", "PRESUPUESTADO")
    expect(chain.eq).toHaveBeenCalledWith("id", "o1")
    expect(chain.eq).toHaveBeenCalledWith("organization_id", "org-1")
  })

  it("devuelve ESTADO_CAMBIO cuando el UPDATE afecta 0 filas (race)", async () => {
    const { supabase } = mockSupabase([])
    const res = await transicionarOrden(supabase, {
      ...base, esperado: "PRESUPUESTADO", nuevo: "APROBADO",
    })
    expect(res).toEqual({ ok: false, motivo: "ESTADO_CAMBIO" })
  })

  it("pasa camposExtra al UPDATE junto con el estado", async () => {
    const { supabase, chain } = mockSupabase([{ id: "o1" }])
    await transicionarOrden(supabase, {
      ...base, esperado: "PRESUPUESTADO", nuevo: "APROBADO", camposExtra: { costo_final: 5000 },
    })
    expect(chain.update).toHaveBeenCalledWith({ estado: "APROBADO", costo_final: 5000 })
  })

  it("lanza si la DB devuelve error", async () => {
    const { supabase } = mockSupabase(null, { message: "boom" })
    await expect(
      transicionarOrden(supabase, { ...base, esperado: "PRESUPUESTADO", nuevo: "APROBADO" })
    ).rejects.toBeTruthy()
  })
})
