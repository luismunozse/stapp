import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import { fetchMovimientosDia, computeTotales } from "@/lib/caja-utils"

// Anular una venta o un cobro no reescribe el arqueo del día en que entró la
// plata: ese día sigue mostrando el ingreso, y el día de la anulación aparece
// el egreso. El mock filtra en memoria (eq / neq / gte / lte sobre rutas con
// punto, como "ventas.fecha_anulacion"), así cada test ve lo que devolvería la
// base para el rango pedido.

type Row = Record<string, any>

function valor(row: Row, path: string) {
  return path.split(".").reduce((acc: any, k) => (acc == null ? acc : acc[k]), row)
}

function tabla(rows: Row[]) {
  return () => {
    const filtros: Array<(r: Row) => boolean> = []
    const chain: any = {
      select: () => chain,
      order: () => chain,
      in: () => chain,
      eq: (c: string, v: any) => (filtros.push((r) => valor(r, c) === v), chain),
      neq: (c: string, v: any) => (filtros.push((r) => valor(r, c) !== v), chain),
      gte: (c: string, v: any) => (filtros.push((r) => valor(r, c) != null && valor(r, c) >= v), chain),
      lte: (c: string, v: any) => (filtros.push((r) => valor(r, c) != null && valor(r, c) <= v), chain),
      then: (resolve: any) => resolve({ data: rows.filter((r) => filtros.every((f) => f(r))), error: null }),
    }
    return chain
  }
}

const ORG = "org-1"
const DIA1 = ["2026-11-10T00:00:00Z", "2026-11-10T23:59:59Z"] as const
const DIA2 = ["2026-11-11T00:00:00Z", "2026-11-11T23:59:59Z"] as const

function montar(datos: { pagosVenta?: Row[]; cobros?: Row[] }) {
  const tablas: Record<string, () => any> = {
    pagos_venta: tabla(datos.pagosVenta ?? []),
    cobros_orden: tabla(datos.cobros ?? []),
    pagos_parciales: tabla([]),
    cuenta_corriente: tabla([]),
    movimientos_caja: tabla([]),
  }
  vi.mocked(supabaseAdmin.from).mockImplementation(((t: string) => (tablas[t] ?? tabla([]))()) as any)
}

const ventaAnuladaAlOtroDia = {
  id: "pv-1", monto: "1000", metodo_pago: "EFECTIVO", fecha: "2026-11-10T15:00:00Z",
  venta_id: "v-1", observaciones: null,
  ventas: {
    organization_id: ORG, numero_venta: 7, estado: "ANULADA", sucursal_id: "suc-1",
    fecha_anulacion: "2026-11-11T10:00:00Z",
  },
}

const cobroAnuladoAlOtroDia = {
  id: "co-1", monto: "500", metodo_pago: "TRANSFERENCIA", created_at: "2026-11-10T16:00:00Z",
  orden_id: "o-1", observaciones: null, organization_id: ORG,
  anulado: true, anulado_at: "2026-11-11T11:00:00Z", anulado_motivo: "cobrado de más",
  ordenes_servicio: { numero_orden: 12, sucursal_id: "suc-1" },
}

describe("fetchMovimientosDia — anulaciones como egreso del día en que se anulan", () => {
  beforeEach(() => vi.clearAllMocks())

  it("el día de la venta conserva el ingreso aunque la venta se haya anulado después", async () => {
    montar({ pagosVenta: [ventaAnuladaAlOtroDia] })
    const movs = await fetchMovimientosDia(ORG, DIA1[0], DIA1[1])
    expect(movs.map((m) => m.tipo)).toEqual(["PAGO_VENTA"])
    const t = computeTotales(movs)
    expect(t.totalIngresosEfectivo).toBe(1000)
    expect(t.totalEgresosEfectivo).toBe(0)
  })

  it("el día de la anulación aparece el egreso, no editable y con el método original", async () => {
    montar({ pagosVenta: [ventaAnuladaAlOtroDia] })
    const movs = await fetchMovimientosDia(ORG, DIA2[0], DIA2[1])
    expect(movs).toHaveLength(1)
    expect(movs[0]).toMatchObject({
      tipo: "ANULACION_VENTA", esEgreso: true, esAnulacion: true, monto: 1000,
      metodoPago: "EFECTIVO", fecha: "2026-11-11T10:00:00Z", referenciaId: "v-1",
      referenciaNumero: "V-0007",
    })
    expect(movs[0].id).toBe("pv-1:anulacion")
    const t = computeTotales(movs)
    expect(t.totalEgresosEfectivo).toBe(1000)
    expect(t.totalDia).toBe(-1000)
  })

  it("venta cobrada y anulada el mismo día: ingreso y egreso, neto cero", async () => {
    const mismoDia = {
      ...ventaAnuladaAlOtroDia,
      ventas: { ...ventaAnuladaAlOtroDia.ventas, fecha_anulacion: "2026-11-10T18:00:00Z" },
    }
    montar({ pagosVenta: [mismoDia] })
    const movs = await fetchMovimientosDia(ORG, DIA1[0], DIA1[1])
    expect(movs.map((m) => m.tipo).sort()).toEqual(["ANULACION_VENTA", "PAGO_VENTA"])
    expect(computeTotales(movs).totalDia).toBe(0)
  })

  it("un cobro de orden anulado: ingreso el día que entró, egreso el día que se anuló", async () => {
    montar({ cobros: [cobroAnuladoAlOtroDia] })

    const dia1 = await fetchMovimientosDia(ORG, DIA1[0], DIA1[1])
    expect(dia1.map((m) => m.tipo)).toEqual(["COBRO_ORDEN"])
    expect(computeTotales(dia1).totalDia).toBe(500)

    const dia2 = await fetchMovimientosDia(ORG, DIA2[0], DIA2[1])
    expect(dia2).toHaveLength(1)
    expect(dia2[0]).toMatchObject({
      tipo: "ANULACION_COBRO", esEgreso: true, esAnulacion: true, monto: 500,
      metodoPago: "TRANSFERENCIA", observaciones: "cobrado de más", referenciaNumero: "ORD-0012",
    })
    expect(computeTotales(dia2).totalDia).toBe(-500)
  })

  it("una venta vigente no genera egreso", async () => {
    montar({
      pagosVenta: [{
        ...ventaAnuladaAlOtroDia,
        ventas: { ...ventaAnuladaAlOtroDia.ventas, estado: "COMPLETADA", fecha_anulacion: null },
      }],
    })
    const dia2 = await fetchMovimientosDia(ORG, DIA2[0], DIA2[1])
    expect(dia2).toHaveLength(0)
  })
})
