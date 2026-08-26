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
})
