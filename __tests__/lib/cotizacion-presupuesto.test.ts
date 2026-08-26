import { describe, it, expect, vi, beforeEach } from "vitest"
import { createChainMock, mockSupabaseFrom } from "../api/helpers"
import { cotizacionesVigentesDeOrden, totalPresupuestoDeOrden } from "@/lib/cotizacion-presupuesto"

describe("cotizacion-presupuesto — cotizaciones vigentes de una orden", () => {
  beforeEach(() => vi.clearAllMocks())

  it("suma los totales de las cotizaciones devueltas", async () => {
    mockSupabaseFrom({
      cotizaciones: createChainMock([{ total: 100 }, { total: 50 }]),
    })
    expect(await totalPresupuestoDeOrden("orden-1")).toEqual({ total: 150, cantidad: 2 })
  })

  it("una orden sin cotizaciones vigentes da total 0 y cantidad 0", async () => {
    mockSupabaseFrom({ cotizaciones: createChainMock([]) })
    expect(await totalPresupuestoDeOrden("orden-1")).toEqual({ total: 0, cantidad: 0 })
  })

  it("trata la respuesta nula como orden sin cotizaciones, no como error", async () => {
    mockSupabaseFrom({ cotizaciones: createChainMock(null) })
    expect(await totalPresupuestoDeOrden("orden-1")).toEqual({ total: 0, cantidad: 0 })
  })

  it("suma totales que llegan como string desde Postgres", async () => {
    mockSupabaseFrom({
      cotizaciones: createChainMock([{ total: "100.50" }, { total: "0.50" }]),
    })
    expect((await totalPresupuestoDeOrden("orden-1")).total).toBe(101)
  })

  it("expone las filas crudas para quien solo necesita contarlas", async () => {
    mockSupabaseFrom({ cotizaciones: createChainMock([{ total: 10 }]) })
    expect(await cotizacionesVigentesDeOrden("orden-1")).toHaveLength(1)
  })

  it("un error de la consulta explota: NO se hace pasar por 'esta orden no tiene cotizaciones'", async () => {
    // 42703 = undefined_column. Es lo que devuelve Postgres cuando esta rama
    // corre contra una base sin la migracion 311: `reemplazada_por` no existe.
    // Si el error se tragara, el helper devolveria [] y los seis llamadores
    // concluirian que la orden no tiene cotizaciones: la orden vuelve a
    // EN_DIAGNOSTICO y su presupuesto/costo_final quedan en NULL. En cada
    // recalculo, de toda orden tocada, en silencio.
    mockSupabaseFrom({
      cotizaciones: createChainMock(null, {
        code: "42703",
        message: 'column cotizaciones.reemplazada_por does not exist',
      }),
    })

    await expect(totalPresupuestoDeOrden("orden-1")).rejects.toThrow(/reemplazada_por/)
  })

  it("el error se propaga tambien por la puerta que solo cuenta filas", async () => {
    mockSupabaseFrom({
      cotizaciones: createChainMock(null, { code: "42703", message: "boom" }),
    })

    await expect(cotizacionesVigentesDeOrden("orden-1", "cot-1")).rejects.toThrow(/orden-1/)
  })

  it("no cuenta las cotizaciones que ya fueron reemplazadas por una revision", async () => {
    const chain = createChainMock([{ total: 150 }])
    mockSupabaseFrom({ cotizaciones: chain })

    await totalPresupuestoDeOrden("orden-1")

    // La aceptada reemplazada y su revision conviven en la orden. Si el filtro
    // no esta, el presupuesto suma las dos y la orden cobra de mas.
    expect(chain.is).toHaveBeenCalledWith("reemplazada_por", null)
  })
})
