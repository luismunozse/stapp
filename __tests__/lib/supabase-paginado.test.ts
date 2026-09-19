import { describe, it, expect, vi } from "vitest"
import {
  traerTodo,
  traerTodoPorLotes,
  TAMANO_PAGINA,
} from "@/lib/supabase-paginado"

/** Simula una tabla de `total` filas respondiendo a range(desde, hasta). */
function tablaFalsa(total: number) {
  const filas = Array.from({ length: total }, (_, i) => ({ id: `r${i}` }))
  return vi.fn(async (desde: number, hasta: number) => ({
    data: filas.slice(desde, hasta + 1),
    error: null,
  }))
}

describe("traerTodo", () => {
  it("una tabla más chica que una página se trae en un solo pedido", async () => {
    const consulta = tablaFalsa(10)
    const { filas, truncado } = await traerTodo(consulta)

    expect(filas).toHaveLength(10)
    expect(truncado).toBe(false)
    expect(consulta).toHaveBeenCalledTimes(1)
    expect(consulta).toHaveBeenCalledWith(0, TAMANO_PAGINA - 1)
  })

  it("trae las 1200 filas que el corte por defecto de PostgREST dejaba en 1000", async () => {
    // Este es el caso exacto del bug: un taller con 40 ventas por día llega a
    // 1200 en el mes y el Estado de Resultados mostraba los ingresos de 1000.
    const consulta = tablaFalsa(1200)
    const { filas, truncado } = await traerTodo(consulta)

    expect(filas).toHaveLength(1200)
    expect(truncado).toBe(false)
    expect(consulta).toHaveBeenCalledTimes(2)
    expect(consulta).toHaveBeenNthCalledWith(1, 0, 999)
    expect(consulta).toHaveBeenNthCalledWith(2, 1000, 1999)
  })

  it("una tabla vacía no rompe y no pide una segunda página", async () => {
    const consulta = tablaFalsa(0)
    const { filas, truncado } = await traerTodo(consulta)

    expect(filas).toEqual([])
    expect(truncado).toBe(false)
    expect(consulta).toHaveBeenCalledTimes(1)
  })

  it("una tabla que es múltiplo exacto de la página pide una más para confirmar el final", async () => {
    const consulta = tablaFalsa(2000)
    const { filas, truncado } = await traerTodo(consulta)

    expect(filas).toHaveLength(2000)
    expect(truncado).toBe(false)
    // La tercera vuelve vacía: es la única forma de saber que no hay más.
    expect(consulta).toHaveBeenCalledTimes(3)
  })

  it("al llegar al tope corta y avisa, en vez de seguir hasta quedarse sin memoria", async () => {
    const consulta = tablaFalsa(10_000)
    const { filas, truncado } = await traerTodo(consulta, { maxFilas: 2500 })

    expect(filas).toHaveLength(2500)
    expect(truncado).toBe(true)
    // La última página se recorta para no pasarse del tope.
    expect(consulta).toHaveBeenLastCalledWith(2000, 2499)
  })

  it("un error de la base se propaga en vez de devolver medio resultado", async () => {
    // Un total a medias por un fallo de red se lee como un mes flojo de ventas.
    const consulta = vi.fn(async () => ({ data: null, error: { message: "connection reset" } }))

    await expect(traerTodo(consulta)).rejects.toThrow("connection reset")
  })

  it("un error en la segunda página también corta: no devuelve la primera sola", async () => {
    const consulta = vi.fn(async (desde: number) =>
      desde === 0
        ? { data: Array.from({ length: TAMANO_PAGINA }, (_, i) => ({ id: `r${i}` })), error: null }
        : { data: null, error: { message: "timeout" } }
    )

    await expect(traerTodo(consulta)).rejects.toThrow("timeout")
  })
})

describe("traerTodoPorLotes", () => {
  it("parte la lista de ids para que el filtro no arme una URL impagable", async () => {
    const ids = Array.from({ length: 450 }, (_, i) => `id${i}`)
    const consulta = vi.fn(async (lote: string[]) => ({
      data: lote.map((id) => ({ id })),
      error: null,
    }))

    const { filas, truncado } = await traerTodoPorLotes(ids, consulta, { tamanoLote: 200 })

    expect(filas).toHaveLength(450)
    expect(truncado).toBe(false)
    expect(consulta).toHaveBeenCalledTimes(3)
    expect(consulta.mock.calls[0][0]).toHaveLength(200)
    expect(consulta.mock.calls[2][0]).toHaveLength(50)
  })

  it("con la lista vacía no consulta nada", async () => {
    // `.in("col", [])` no tiene semántica confiable; "nada" es la única
    // respuesta correcta.
    const consulta = vi.fn()
    const { filas } = await traerTodoPorLotes([], consulta as any)

    expect(filas).toEqual([])
    expect(consulta).not.toHaveBeenCalled()
  })

  it("si un solo lote se trunca, el resultado entero queda marcado", async () => {
    const consulta = vi.fn(async (_lote: string[], desde: number, hasta: number) => ({
      data: Array.from({ length: hasta - desde + 1 }, (_, i) => ({ id: `r${desde + i}` })),
      error: null,
    }))

    const { truncado } = await traerTodoPorLotes(["a", "b"], consulta, { maxFilas: 1000 })
    expect(truncado).toBe(true)
  })
})
