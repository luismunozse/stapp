import { describe, it, expect, vi } from "vitest"
import { traerTodas } from "@/lib/supabase-paginar"

function consultaPaginada(total: number) {
  const range = vi.fn((desde: number, hasta: number) =>
    Promise.resolve({
      data: Array.from({ length: Math.max(Math.min(hasta, total - 1) - desde + 1, 0) }, (_, i) => ({ id: desde + i })),
      error: null,
    })
  )
  return { armar: () => ({ range }), range }
}

describe("traerTodas", () => {
  it("sigue pidiendo páginas hasta traer todo (antes se cortaba en 1000)", async () => {
    const { armar, range } = consultaPaginada(2500)
    const { data, error } = await traerTodas(armar)
    expect(error).toBeNull()
    expect(data).toHaveLength(2500)
    expect(range).toHaveBeenCalledTimes(3)
    expect(range).toHaveBeenNthCalledWith(2, 1000, 1999)
  })

  it("con una página incompleta no vuelve a pedir", async () => {
    const { armar, range } = consultaPaginada(10)
    expect((await traerTodas(armar)).data).toHaveLength(10)
    expect(range).toHaveBeenCalledTimes(1)
  })

  it("si una página falla devuelve el error", async () => {
    const range = vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } })
    const r = await traerTodas(() => ({ range }))
    expect(r.error).toEqual({ message: "boom" })
  })
})
