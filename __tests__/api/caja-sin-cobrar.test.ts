/**
 * GET /api/caja: tarjeta "Ordenes reparadas sin cobrar".
 *
 * - ordenes_servicio NO tiene created_at: ordenar por esa columna hacia fallar la
 *   consulta (supabase-js no lanza, devuelve { data: null, error }) y la tarjeta
 *   mostraba 0 en todos los talleres.
 * - Una orden cuya deuda ya vive en cuenta_corriente (CARGO referencia_tipo=ORDEN,
 *   revertido o no, igual que get_deuda_cliente_sucursal) o cuya factura esta
 *   PAGADO no es "sin cobrar": se excluye y el conteo es exacto.
 *
 * Mini fake de PostgREST local a este archivo: valida columnas de
 * ordenes_servicio (42703), aplica filtros y trunca a 1000 filas como la base real.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { auth } from "@/lib/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { cookies } from "next/headers"
import { createGetRequest } from "./helpers"

vi.mock("@/lib/caja-utils", () => ({
  fetchMovimientosDia: vi.fn().mockResolvedValue([]),
  computeTotales: vi.fn().mockReturnValue({
    totalIngresos: 0,
    totalEgresos: 0,
    totalIngresosEfectivo: 0,
    totalEgresosEfectivo: 0,
    totalCostosFinancieros: 0,
    totalDia: 0,
    porMetodo: {},
    porTipo: {},
    ingresoReal: 0,
  }),
}))

import { GET } from "@/app/api/caja/route"

// Columnas reales de ordenes_servicio que usa (o podria usar) esta consulta.
// Notar: no existen created_at ni updated_at.
const COLUMNAS_ORDENES = new Set([
  "id", "numero_orden", "costo_final", "total_cobrado", "descuento_cobro", "estado_cobro", "estado",
  "organization_id", "sucursal_id", "fecha_ingreso", "fecha_entrega", "fecha_completado",
])

type Fila = Record<string, any>
const MAX_ROWS = 1000

type Orden = { column: string; ascending?: boolean; nullsFirst?: boolean }
type Consulta = { tabla: string; ordenes: Orden[]; ins: Array<{ col: string; n: number }> }

function crearFake(tablas: Record<string, Fila[]>, fallan: string[] = []) {
  const consultas: Consulta[] = []
  const vuelo = { actual: 0, max: 0 }

  function from(tabla: string) {
    const usadas: string[] = []
    const filtros: Array<(r: Fila) => boolean> = []
    const orders: Orden[] = []
    const ins: Array<{ col: string; n: number }> = []
    let rango: [number, number] | null = null
    let max: number | null = null
    let conConteo = false
    consultas.push({ tabla, ordenes: orders, ins })
    const chain: any = {}
    const reg = (c: unknown) => {
      if (typeof c === "string") usadas.push(c)
    }
    chain.select = vi.fn((cols: string, opts?: { count?: string }) => {
      cols.split(",").map((c) => c.trim()).forEach(reg)
      conConteo = !!opts?.count
      return chain
    })
    chain.eq = vi.fn((c: string, v: unknown) => {
      reg(c)
      filtros.push((r) => r[c] === v)
      return chain
    })
    chain.in = vi.fn((c: string, vs: unknown[]) => {
      reg(c)
      ins.push({ col: c, n: vs.length })
      filtros.push((r) => vs.includes(r[c]))
      return chain
    })
    chain.not = vi.fn((c: string) => {
      reg(c)
      filtros.push((r) => r[c] != null)
      return chain
    })
    chain.gt = vi.fn((c: string, v: number) => {
      reg(c)
      filtros.push((r) => Number(r[c]) > v)
      return chain
    })
    chain.order = vi.fn((c: string, o?: { ascending?: boolean; nullsFirst?: boolean }) => {
      reg(c)
      orders.push({ column: c, ascending: o?.ascending, nullsFirst: o?.nullsFirst })
      return chain
    })
    chain.limit = vi.fn((n: number) => {
      max = n
      return chain
    })
    chain.range = vi.fn((a: number, b: number) => {
      rango = [a, b]
      return chain
    })
    chain.maybeSingle = vi.fn(async () => ({ data: null, error: null }))
    chain.single = vi.fn(async () => ({ data: tablas[tabla]?.[0] ?? null, error: null }))
    chain.then = (resolve: any, reject?: any) => {
      vuelo.actual++
      vuelo.max = Math.max(vuelo.max, vuelo.actual)
      return new Promise((r) => setTimeout(r, 0))
        .then(() => resolver())
        .finally(() => {
          vuelo.actual--
        })
        .then(resolve, reject)
    }
    const resolver = (): Promise<Fila> => {
      if (fallan.includes(tabla)) {
        return Promise.resolve({ data: null, error: { code: "XX000", message: "boom" }, count: null })
      }
      if (tabla === "ordenes_servicio") {
        const mala = usadas.find((c) => !COLUMNAS_ORDENES.has(c))
        if (mala) {
          return Promise.resolve({
            data: null,
            count: null,
            error: { code: "42703", message: `column ordenes_servicio.${mala} does not exist` },
          })
        }
      }
      let rows = (tablas[tabla] ?? []).filter((r) => filtros.every((f) => f(r)))
      if (orders.length) {
        rows = [...rows].sort((a, b) => {
          for (const { column, ascending } of orders) {
            const c = String(a[column] ?? "").localeCompare(String(b[column] ?? ""))
            if (c !== 0) return ascending === false ? -c : c
          }
          return 0
        })
      }
      const total = rows.length
      if (rango) rows = rows.slice(rango[0], rango[1] + 1)
      if (max !== null) rows = rows.slice(0, max)
      rows = rows.slice(0, MAX_ROWS)
      return Promise.resolve({ data: rows, error: null, count: conConteo ? total : null })
    }
    return chain
  }
  return { from, consultas, vuelo }
}

function montar(tablas: Record<string, Fila[]>, fallan: string[] = []) {
  vi.mocked(auth).mockResolvedValue({
    user: { id: "user-1", organizationId: "org-1", role: "ADMIN", sucursalId: null, email: "a@a.com" },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } as any)
  vi.mocked(cookies).mockResolvedValue({ get: vi.fn(() => undefined), set: vi.fn() } as any)
  const fake = crearFake(
    {
      organizations: [{ id: "org-1", zona_horaria: "America/Argentina/Buenos_Aires" }],
      users: [{ id: "user-1", nombre: "Test" }],
      sesiones_caja: [],
      cuenta_corriente: [],
      facturas: [],
      ...tablas,
    },
    fallan
  )
  vi.mocked(supabaseAdmin.from).mockImplementation(((t: string) => fake.from(t)) as any)
  return fake
}

// Orden candidata: ENTREGADO, PENDIENTE, con costo_final. n mayor = mas nueva.
const orden = (n: number, extra: Fila = {}): Fila => ({
  id: `o${String(n).padStart(5, "0")}`,
  organization_id: "org-1",
  numero_orden: n,
  estado: "ENTREGADO",
  estado_cobro: "PENDIENTE",
  costo_final: "1000",
  total_cobrado: "0",
  fecha_ingreso: new Date(Date.UTC(2026, 0, 1) + n * 60_000).toISOString(),
  ...extra,
})
const cargo = (ordenId: string, extra: Fila = {}): Fila => ({
  id: `cc-${ordenId}`,
  organization_id: "org-1",
  tipo: "CARGO",
  referencia_tipo: "ORDEN",
  referencia_id: ordenId,
  revertido_at: null,
  ...extra,
})
const factura = (ordenId: string, estado: string): Fila => ({ id: `f-${ordenId}`, orden_id: ordenId, estado_pago: estado })

const pedir = async () => {
  const res = await GET(createGetRequest("http://localhost:3000/api/caja"))
  return { res, body: await res.json() }
}

describe("GET /api/caja: sinCobrar", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("ordena por fecha_ingreso (las mas nuevas primero) y lista las ordenes sin cobrar", async () => {
    const fake = montar({
      ordenes_servicio: [orden(6, { costo_final: "500" }), orden(7, { costo_final: "1000", total_cobrado: "250" })],
    })

    const { res, body } = await pedir()

    expect(res.status).toBe(200)
    const q = fake.consultas.find((c) => c.tabla === "ordenes_servicio")!
    expect(q.ordenes[0]).toMatchObject({ column: "fecha_ingreso", ascending: false })
    expect(body.sinCobrar.count).toBe(2)
    expect(body.sinCobrar.ordenes[0]).toMatchObject({ numeroOrden: 7, pendiente: 750, totalCobrado: 250 })
  })

  it("excluye una orden fiada (CARGO a cuenta corriente) y las demas siguen", async () => {
    montar({ ordenes_servicio: [orden(1), orden(2)], cuenta_corriente: [cargo("o00001")] })

    const { body } = await pedir()

    expect(body.sinCobrar.count).toBe(1)
    expect(body.sinCobrar.ordenes.map((o: any) => o.numeroOrden)).toEqual([2])
  })

  it("una orden con cargo REVERTIDO tambien se excluye (igual que get_deuda_cliente_sucursal)", async () => {
    montar({
      ordenes_servicio: [orden(1), orden(2)],
      cuenta_corriente: [cargo("o00001", { revertido_at: "2026-09-01T00:00:00Z" })],
    })

    const { body } = await pedir()

    expect(body.sinCobrar.ordenes.map((o: any) => o.numeroOrden)).toEqual([2])
  })

  it("un PAGO de cuenta corriente sobre la orden no la excluye (solo el CARGO)", async () => {
    montar({ ordenes_servicio: [orden(1)], cuenta_corriente: [cargo("o00001", { tipo: "PAGO" })] })

    const { body } = await pedir()

    expect(body.sinCobrar.count).toBe(1)
  })

  it("excluye una orden con factura PAGADO", async () => {
    montar({ ordenes_servicio: [orden(1), orden(2)], facturas: [factura("o00001", "PAGADO")] })

    const { body } = await pedir()

    expect(body.sinCobrar.ordenes.map((o: any) => o.numeroOrden)).toEqual([2])
  })

  it.each(["PENDIENTE", "PAGADO_PARCIAL", "ANULADA"])("una factura %s no excluye la orden", async (estado) => {
    montar({ ordenes_servicio: [orden(1)], facturas: [factura("o00001", estado)] })

    const { body } = await pedir()

    expect(body.sinCobrar.count).toBe(1)
  })

  it("con mas de 1000 candidatas el conteo es exacto y las consultas por orden van en lotes", async () => {
    // 1250 candidatas: 1 de cada 5 fiada, 1 de cada 7 con factura PAGADO.
    const ordenes = Array.from({ length: 1250 }, (_, i) => orden(i + 1))
    const fiadas = ordenes.filter((_, i) => (i + 1) % 5 === 0).map((o) => cargo(o.id))
    const pagadas = ordenes.filter((_, i) => (i + 1) % 7 === 0).map((o) => factura(o.id, "PAGADO"))
    const excluidas = new Set([...fiadas.map((c) => c.referencia_id), ...pagadas.map((f) => f.orden_id)])
    const fake = montar({ ordenes_servicio: ordenes, cuenta_corriente: fiadas, facturas: pagadas })

    const { body } = await pedir()

    expect(body.sinCobrar.count).toBe(1250 - excluidas.size)
    expect(body.sinCobrar.ordenes).toHaveLength(10)
    const esperadas = ordenes
      .filter((o) => !excluidas.has(o.id))
      .reverse()
      .slice(0, 10)
      .map((o) => o.numero_orden)
    expect(body.sinCobrar.ordenes.map((o: any) => o.numeroOrden)).toEqual(esperadas)
    const lotes = fake.consultas.filter((c) => c.tabla !== "ordenes_servicio").flatMap((c) => c.ins)
    expect(lotes.length).toBeGreaterThan(2)
    expect(Math.max(...lotes.map((l) => l.n))).toBeLessThanOrEqual(100)
  })

  it("ordena fecha_ingreso desc con nullsFirst false (una orden sin fecha no ocupa un lugar del top)", async () => {
    const fake = montar({ ordenes_servicio: [orden(1)] })

    await pedir()

    const q = fake.consultas.find((c) => c.tabla === "ordenes_servicio")!
    expect(q.ordenes[0]).toEqual({ column: "fecha_ingreso", ascending: false, nullsFirst: false })
  })

  it("descuento_cobro: una orden con descuento igual al costo no aparece ni cuenta", async () => {
    montar({
      ordenes_servicio: [orden(1, { costo_final: "1000", descuento_cobro: "1000" }), orden(2)],
    })

    const { body } = await pedir()

    expect(body.sinCobrar.count).toBe(1)
    expect(body.sinCobrar.ordenes.map((o: any) => o.numeroOrden)).toEqual([2])
  })

  it("descuento_cobro: el pendiente descuenta el descuento, con piso en 0 (igual que mig 318)", async () => {
    montar({
      ordenes_servicio: [
        orden(1, { costo_final: "1000", descuento_cobro: "200", total_cobrado: "300" }),
        orden(2, { costo_final: "500", descuento_cobro: "100", total_cobrado: "600" }), // sobrepagada: pendiente 0
        orden(3, { costo_final: "800", descuento_cobro: null, total_cobrado: "0" }), // null = sin descuento
      ],
    })

    const { body } = await pedir()

    expect(body.sinCobrar.count).toBe(2)
    const porNumero = Object.fromEntries(body.sinCobrar.ordenes.map((o: any) => [o.numeroOrden, o.pendiente]))
    expect(porNumero).toEqual({ 1: 500, 3: 800 })
  })

  it("los lotes de consulta corren en paralelo con concurrencia acotada", async () => {
    const ordenes = Array.from({ length: 2000 }, (_, i) => orden(i + 1)) // 20 lotes
    const fake = montar({ ordenes_servicio: ordenes })

    const { body } = await pedir()

    expect(body.sinCobrar.count).toBe(2000)
    // cargos + facturas por lote, hasta 5 lotes a la vez
    expect(fake.vuelo.max).toBeGreaterThan(2)
    expect(fake.vuelo.max).toBeLessThanOrEqual(10)
  })

  it("no consulta columnas inexistentes de ordenes_servicio", async () => {
    montar({ ordenes_servicio: [orden(1)] })

    const { body } = await pedir()

    expect(body.sinCobrar).not.toBeNull()
    expect(body.sinCobrar.count).toBe(1)
  })

  it.each(["ordenes_servicio", "cuenta_corriente", "facturas"])(
    "si falla la consulta de %s devuelve sinCobrar null (no 0), loguea y no tumba la caja",
    async (tabla) => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {})
      montar({ ordenes_servicio: [orden(1)] }, [tabla])

      const { res, body } = await pedir()

      expect(res.status).toBe(200)
      expect(body.sinCobrar).toBeNull()
      expect(body).toHaveProperty("sesionActual")
      expect(spy).toHaveBeenCalled()
      spy.mockRestore()
    }
  )
})
