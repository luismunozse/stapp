import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import { createChainMock } from "../api/helpers"
import { listarGarantias, resumenGarantiasPorVencer } from "@/lib/garantias/listado"
import { consultarDatosDashboard } from "@/lib/dashboard/datos"
import { buildAdminActions } from "@/components/dashboard/action-strip"
import type { AlcanceOrdenes } from "@/lib/ordenes/alcance-lectura"

type Chain = ReturnType<typeof createChainMock>

/** Graba cada consulta a v_garantias; todas responden `total` filas contadas. */
function grabar(total: number) {
  const vistas: Chain[] = []
  vi.mocked(supabaseAdmin.from).mockImplementation((t: string) => {
    if (t === "v_garantias") {
      const c = createChainMock([], null, total)
      vistas.push(c)
      return c as any
    }
    if (t === "organizations") return createChainMock({ zona_horaria: "America/Argentina/Buenos_Aires" }) as any
    return createChainMock([], null, 0) as any
  })
  return vistas
}

/** Todas las llamadas de filtro de una consulta, para comparar dos consultas. */
const filtros = (c: Chain) =>
  ["eq", "or", "gte", "lte", "gt", "lt"].flatMap((m) => c[m].mock.calls.map((args) => [m, ...args]))

const ALCANCES: [string, AlcanceOrdenes][] = [
  ["ADMIN (toda la org)", { tipo: "todas" }],
  ["VENDEDOR (sucursal)", { tipo: "sucursal", sucursalId: "suc-1" }],
  ["TECNICO", { tipo: "sucursal_o_asignadas", sucursalId: "suc-1", userId: "tec-1" }],
]

describe("el conteo del dashboard es la pestaña Por vencer de /garantias", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-11-12T02:30:00Z"))
  })
  afterEach(() => vi.useRealTimers())

  it.each(ALCANCES)("%s: mismos filtros, misma ventana, mismo alcance", async (_n, alcance) => {
    const dash = grabar(5)
    const resumen = await resumenGarantiasPorVencer("org-1", alcance)
    const pagina = grabar(5)
    const lista = await listarGarantias({
      organizationId: "org-1",
      alcance,
      filtros: { tab: "por-vencer", origen: null, q: null, page: 1, limit: 20, ventana: 7 },
      actor: null,
      conConteos: true,
    })
    expect(filtros(dash[0])).toEqual(filtros(pagina[0]))
    expect(resumen.total).toBe(lista.total)
    expect(lista.conteos?.["por-vencer"]).toBe(resumen.total)
  })

  it("consultarDatosDashboard expone el total de esa consulta", async () => {
    grabar(4)
    const datos = await consultarDatosDashboard("org-1", { tipo: "todas" })
    expect(datos.garantiasPorVencer.total).toBe(4)
  })

  it("si la vista falla, el dashboard no se cae: cuenta 0", async () => {
    vi.mocked(supabaseAdmin.from).mockImplementation((t: string) =>
      (t === "v_garantias" ? createChainMock(null, { code: "42P01", message: "no existe" }) : createChainMock([], null, 0)) as any
    )
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    const datos = await consultarDatosDashboard("org-1", { tipo: "todas" })
    expect(datos.garantiasPorVencer).toEqual({ total: 0, primeras: [] })
    spy.mockRestore()
  })

  it("la tarjeta del ADMIN abre /garantias en la pestaña Por vencer y para toda la org", () => {
    const items = buildAdminActions({
      moneda: "ARS",
      cobrosCount: 0,
      deudaTotal: 0,
      slaVencidasCount: 0,
      garantiasCount: 2,
      stockBajoCount: 0,
    })
    expect(items.find((i) => i.id === "garantias")?.href).toBe("/garantias?tab=por-vencer&sucursal=todas")
  })
})
