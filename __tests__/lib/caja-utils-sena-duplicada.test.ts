// @vitest-environment node
/**
 * La seña entra una sola vez al arqueo. Al crear la orden se guarda como
 * cobro_orden, y al generar el remito se copia a pagos_parciales: esa copia no
 * es plata nueva y no se cuenta cuando la orden tiene el cobro de la seña.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import { fetchMovimientosDia, OBS_COBRO_SENA, OBS_ESPEJO_SENA } from "@/lib/caja-utils"

function chain(data: any[] | null, error: any = null) {
  const c: any = {}
  for (const m of ["select", "eq", "neq", "gte", "lte", "order", "in", "not", "is"]) c[m] = vi.fn().mockReturnValue(c)
  c.then = (resolve: any, reject?: any) => Promise.resolve({ data, error }).then(resolve, reject)
  return c
}

const factura = (ordenId: string) => ({
  id: `fac-${ordenId}`,
  orden_id: ordenId,
  numero_factura: "R-0001",
  estado_pago: "PAGADO",
  ordenes_servicio: { organization_id: "org-1", numero_orden: 7, sucursal_id: null },
})

const espejo = (id: string, ordenId: string) => ({
  id,
  monto: "5000",
  metodo_pago: "EFECTIVO",
  fecha: "2026-11-11T15:00:00Z",
  factura_id: `fac-${ordenId}`,
  observaciones: OBS_ESPEJO_SENA,
  facturas: factura(ordenId),
})

const pagoNormal = {
  id: "pp-normal",
  monto: "20000",
  metodo_pago: "EFECTIVO",
  fecha: "2026-11-11T15:00:00Z",
  factura_id: "fac-orden-1",
  observaciones: null,
  facturas: factura("orden-1"),
}

function montar(pagosParciales: any[], cobrosSena: any[] | null, cobrosSenaError: any = null) {
  let cobrosLlamadas = 0
  const cobrosSenaChain = chain(cobrosSena, cobrosSenaError)
  vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
    if (table === "pagos_parciales") return chain(pagosParciales) as any
    if (table === "cobros_orden") {
      cobrosLlamadas++
      // 1ra: cobros del día (vacío). 2da: búsqueda del cobro de la seña.
      return (cobrosLlamadas === 1 ? chain([]) : cobrosSenaChain) as any
    }
    return chain([]) as any
  })
  return cobrosSenaChain
}

const ids = async () =>
  (await fetchMovimientosDia("org-1", "2026-11-11T00:00:00Z", "2026-11-11T23:59:59Z")).map(
    (m: any) => m.id,
  )

describe("fetchMovimientosDia — seña copiada al remito", () => {
  beforeEach(() => vi.clearAllMocks())

  it("no cuenta la copia si la orden tiene el cobro de la seña", async () => {
    const q = montar([espejo("pp-sena", "orden-1"), pagoNormal], [{ orden_id: "orden-1" }])
    const r = await ids()
    expect(r).toContain("pp-normal")
    expect(r).not.toContain("pp-sena")
    expect(q.in).toHaveBeenCalledWith("orden_id", ["orden-1"])
    expect(q.eq).toHaveBeenCalledWith("observaciones", OBS_COBRO_SENA)
  })

  it("mantiene la copia si la orden no tiene cobro de seña (es el único registro)", async () => {
    montar([espejo("pp-sena", "orden-2")], [])
    expect(await ids()).toContain("pp-sena")
  })

  it("si no se puede consultar el cobro, no descarta nada", async () => {
    montar([espejo("pp-sena", "orden-1")], null, { message: "timeout" })
    expect(await ids()).toContain("pp-sena")
  })

  it("sin copias de seña no hace la consulta extra", async () => {
    const q = montar([pagoNormal], [])
    expect(await ids()).toContain("pp-normal")
    expect(q.in).not.toHaveBeenCalled()
  })
})
