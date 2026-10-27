/**
 * The dashboard under branch isolation (change sucursales-aislamiento, PR4: OI-1, SC-2, SC-3, SC-4, XC-3).
 *
 * The page is driven for real over in-memory tables that honor the filters (a mock that ignores them
 * would give a false green on anything about scope), with `unstable_cache` replaced by a memo keyed
 * the way Next keys it (key parts + the serialized ARGUMENTS of the cached function). What the viewer
 * sees is read from the element tree the page returns.
 *
 * Operational widgets follow the branch that handles the order, money the branch that originated it,
 * sales the branch that made them (D9). Two widgets stay org-wide on purpose until their own PR scopes
 * them: the low-stock count (PENDIENTE_PR15) and the client counts (PENDIENTE_PR18). A test below pins
 * that, so the PR that scopes them has to update the list.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { isValidElement, type ReactElement } from "react"
import { cookies } from "next/headers"
import { auth } from "@/lib/auth"
import { sesionConSucursalVigente } from "@/lib/auth-utils"
import { SUCURSAL_COOKIE, SUCURSAL_NINGUNA } from "@/lib/sucursal"
import { formatCurrency } from "@/lib/utils"
import { StatCard } from "@/components/dashboard/stat-card"
import { HeroMetric } from "@/components/dashboard/hero-metric"
import { ActionStrip } from "@/components/dashboard/action-strip"
import { AlertItem } from "@/components/dashboard/alert-item"
import { QuickActions } from "@/components/dashboard/quick-actions"
import { OrdenesRecientes, DashboardCharts } from "@/components/dashboard"
import DashboardPage from "@/app/(dashboard)/dashboard/page"
import { montarSupabaseEnMemoria } from "../helpers/supabase-memoria"

// What Next's unstable_cache does that matters here: the entry is keyed by the key parts and the
// serialized arguments, so anything the cached function reads that is NOT an argument is shared.
const cacheNext = vi.hoisted(() => ({
  entradas: new Map<string, Promise<unknown>>(),
  ejecuciones: [] as unknown[][],
}))
vi.mock("next/cache", () => ({
  unstable_cache:
    (fn: (...args: any[]) => Promise<unknown>, claves: string[] = []) =>
    (...args: unknown[]) => {
      const clave = JSON.stringify([claves, args])
      if (!cacheNext.entradas.has(clave)) {
        cacheNext.ejecuciones.push(args)
        cacheNext.entradas.set(clave, fn(...args))
      }
      return cacheNext.entradas.get(clave)
    },
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    throw new Error(`REDIRECT:${destino}`)
  },
}))

// The page takes the viewer's FRESH branch from this.
vi.mock("@/lib/auth-utils", () => ({ sesionConSucursalVigente: vi.fn() }))

const ORG = "org-1"
// "Now" is 15:20Z and "today" 15:19Z: a minute apart, so the page's local midnight falls between them
// in no real time zone (a round hour would sit on it in one).
const AHORA = new Date("2026-10-15T15:20:00.000Z")
const HOY = "2026-10-15T15:19:00.000Z"
const ESTE_MES = "2026-10-11T14:00:00.000Z"
const MES_PASADO = "2026-09-10T14:00:00.000Z"
const VENCE_PRONTO = "2026-10-18T14:00:00.000Z"
const PROMETIDA_PASADA = "2026-10-05T14:00:00.000Z"
const dia = (n: number) => `2026-10-${String(n).padStart(2, "0")}T14:00:00.000Z`

type Fila = Record<string, any>

function orden(id: string, sucursal: string, resto: Fila): Fila {
  return {
    id,
    organization_id: ORG,
    sucursal_id: sucursal,
    numero_orden: Number(id.replace(/\D/g, "")) || 1,
    codigo_orden: null,
    dispositivo: "Celular",
    estado: "RECIBIDO",
    fecha_ingreso: ESTE_MES,
    fecha_prometida: null,
    fecha_completado: null,
    tecnico_id: null,
    costo_final: 0,
    total_cobrado: 0,
    descuento_cobro: 0,
    estado_cobro: null,
    clientes: { nombre: `Cliente ${id}` },
    users: null,
    ...resto,
  }
}

const embedOrden = (id: string, sucursal: string) => ({ organization_id: ORG, sucursal_id: sucursal, id, numero_orden: 1, clientes: { nombre: `Cliente ${id}` } })

/**
 * Branch A: 3 orders (2 pending, one late, one delivered with a debt of 500). Branch B: 2 orders
 * (1 pending and late, one repaired with a debt of 200). The pending B order is assigned to a
 * technician of A (the jed-electronics case).
 */
function mundo(unaSola = false): Record<string, Fila[]> {
  const suc = (s: string) => (unaSola ? "suc-U" : s)
  const A = suc("suc-A")
  const B = suc("suc-B")
  const tecA = { nombre: "Tec A" }
  return {
    organizations: [{ id: ORG, moneda: "ARS", zona_horaria: "America/Argentina/Buenos_Aires", onboarding_completed: true, pais: "AR" }],
    users: ["u-admin", "u-va", "u-vb", "u-ta", "u-tb", "u-sin"].map((id) => ({ id, last_seen_version: "x", nombre: `Nombre ${id}` })),
    ordenes_servicio: [
      orden("ord-A1", A, { fecha_ingreso: dia(10), fecha_prometida: PROMETIDA_PASADA }),
      orden("ord-A2", A, { estado: "EN_REPARACION", tecnico_id: "u-ta", users: tecA, fecha_ingreso: dia(12) }),
      orden("ord-A3", A, {
        estado: "ENTREGADO", tecnico_id: "u-ta", users: tecA, fecha_ingreso: dia(3), fecha_completado: dia(5),
        costo_final: 500, estado_cobro: "PENDIENTE",
      }),
      orden("ord-B1", B, { tecnico_id: "u-ta", users: tecA, fecha_ingreso: dia(11), fecha_prometida: PROMETIDA_PASADA }),
      orden("ord-B2", B, { estado: "REPARADO", fecha_ingreso: dia(5), costo_final: 300, total_cobrado: 100, estado_cobro: "PARCIAL" }),
    ],
    facturas: [
      { id: "f-A1", total: 100, fecha: HOY, estado_pago: "PAGADO", orden_id: "ord-A3", ordenes_servicio: embedOrden("ord-A3", A) },
      { id: "f-B1", total: 40, fecha: ESTE_MES, estado_pago: "PAGADO", orden_id: "ord-B2", ordenes_servicio: embedOrden("ord-B2", B) },
      { id: "f-A0", total: 300, fecha: MES_PASADO, estado_pago: "PAGADO", orden_id: "ord-A3", ordenes_servicio: embedOrden("ord-A3", A) },
      { id: "f-B0", total: 220, fecha: MES_PASADO, estado_pago: "PAGADO", orden_id: "ord-B2", ordenes_servicio: embedOrden("ord-B2", B) },
    ],
    cobros_orden: [
      { id: "c-A", organization_id: ORG, monto: 30, orden_id: "ord-A2", created_at: HOY, anulado: false, ordenes_servicio: { sucursal_id: A } },
      { id: "c-B", organization_id: ORG, monto: 20, orden_id: "ord-B1", created_at: HOY, anulado: false, ordenes_servicio: { sucursal_id: B } },
      { id: "c-X", organization_id: ORG, monto: 999, orden_id: "ord-A2", created_at: HOY, anulado: true, ordenes_servicio: { sucursal_id: A } },
    ],
    ventas: [
      { id: "v-A", organization_id: ORG, total: 200, estado: "COMPLETADA", created_at: HOY, vendedor_id: "u-va", sucursal_id: A },
      { id: "v-B", organization_id: ORG, total: 50, estado: "COMPLETADA", created_at: ESTE_MES, vendedor_id: "u-vb", sucursal_id: B },
    ],
    garantias: [
      { id: "g-A", orden_id: "ord-A3", fecha_vencimiento: VENCE_PRONTO, estado: "ACTIVA", ordenes_servicio: embedOrden("ord-A3", A) },
      { id: "g-B", orden_id: "ord-B2", fecha_vencimiento: VENCE_PRONTO, estado: "ACTIVA", ordenes_servicio: embedOrden("ord-B2", B) },
    ],
    garantias_venta: [
      {
        id: "gv-A", organization_id: ORG, numero_garantia: 1, fecha_vencimiento: VENCE_PRONTO, estado: "ACTIVA",
        items_venta: { descripcion: "Funda A" }, ventas: { numero_venta: 1, cliente_nombre: "Cliente venta A", organization_id: ORG, sucursal_id: A },
      },
      {
        id: "gv-B", organization_id: ORG, numero_garantia: 2, fecha_vencimiento: VENCE_PRONTO, estado: "ACTIVA",
        items_venta: { descripcion: "Funda B" }, ventas: { numero_venta: 2, cliente_nombre: "Cliente venta B", organization_id: ORG, sucursal_id: B },
      },
    ],
    inventario: [
      { id: "i-1", organization_id: ORG, stock: 2 },
      { id: "i-2", organization_id: ORG, stock: 3 },
      { id: "i-3", organization_id: ORG, stock: 10 },
    ],
    clientes: [
      { id: "cl-1", organization_id: ORG, created_at: MES_PASADO },
      { id: "cl-2", organization_id: ORG, created_at: MES_PASADO },
      { id: "cl-3", organization_id: ORG, created_at: ESTE_MES },
      { id: "cl-4", organization_id: ORG, created_at: ESTE_MES },
    ],
  }
}

// ---- who is looking ---------------------------------------------------------------------------

interface Espectador {
  id: string
  role: "ADMIN" | "VENDEDOR" | "TECNICO"
  /** The FRESH branch (what the database holds now). */
  sucursal: string | null
  /** The switcher cookie. */
  cookie?: string
}
const ADMIN_TODAS: Espectador = { id: "u-admin", role: "ADMIN", sucursal: null }
const ADMIN_A: Espectador = { ...ADMIN_TODAS, cookie: "suc-A" }
const ADMIN_B: Espectador = { ...ADMIN_TODAS, cookie: "suc-B" }
const VENDEDOR_A: Espectador = { id: "u-va", role: "VENDEDOR", sucursal: "suc-A" }
const VENDEDOR_B: Espectador = { id: "u-vb", role: "VENDEDOR", sucursal: "suc-B" }
const TECNICO_A: Espectador = { id: "u-ta", role: "TECNICO", sucursal: "suc-A" }
const TECNICO_B: Espectador = { id: "u-tb", role: "TECNICO", sucursal: "suc-B" }

async function cargar(espectador: Espectador): Promise<ReactElement> {
  const sesion = (sucursalId: string | null) => ({
    user: { id: espectador.id, role: espectador.role, organizationId: ORG, sucursalId, name: "Nombre" },
  })
  vi.mocked(sesionConSucursalVigente).mockResolvedValue(sesion(espectador.sucursal) as any)
  // The JWT copy a raw auth() would give: it holds the branch the user had at login, which is the
  // OTHER one here. A page that took its branch from it would show the wrong branch.
  vi.mocked(auth).mockResolvedValue(sesion(espectador.sucursal === null ? null : "suc-VIEJA") as any)
  vi.mocked(cookies).mockReturnValue({
    get: (nombre: string) => (nombre === SUCURSAL_COOKIE && espectador.cookie ? { value: espectador.cookie } : undefined),
    set: vi.fn(),
  } as any)
  return (await DashboardPage()) as ReactElement
}

// ---- reading the element tree -----------------------------------------------------------------

function elementos(nodo: unknown, salida: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(nodo)) nodo.forEach((n) => elementos(n, salida))
  else if (isValidElement(nodo)) {
    salida.push(nodo)
    elementos((nodo.props as any).children, salida)
  }
  return salida
}

function texto(nodo: unknown): string {
  if (typeof nodo === "string" || typeof nodo === "number") return String(nodo)
  if (Array.isArray(nodo)) return nodo.map(texto).join("")
  if (isValidElement(nodo)) return texto((nodo.props as any).children)
  return ""
}

function resumen(arbol: ReactElement) {
  const els = elementos(arbol)
  const props = (tipo: unknown) => els.filter((e) => e.type === tipo).map((e) => e.props as any)
  const hero = props(HeroMetric)[0]
  const graficos = props(DashboardCharts)[0]
  const recientes = props(OrdenesRecientes)[0]
  return {
    tarjetas: Object.fromEntries(props(StatCard).map((p) => [p.title, { valor: p.value, detalle: p.description }])) as Record<string, { valor: string; detalle?: string }>,
    clientesCambio: props(StatCard).find((p) => p.title === "Clientes")?.change,
    hero: hero && { valor: hero.value, hoy: hero.secondaryValue, cambio: hero.change },
    estados: graficos?.ordenesPorEstado as Record<string, number> | undefined,
    ingresos7: graficos?.totalIngresos7Dias as number | undefined,
    porTecnico: graficos?.ordenesPorTecnico as Array<{ nombre: string; ordenes: number; completadas: number }> | undefined,
    recientes: ((recientes?.ordenes ?? []) as Array<{ id: string }>).map((o) => o.id),
    acciones: Object.fromEntries(
      props(ActionStrip).flatMap((p) => (p.items as Array<{ id: string; value: string }>).map((i) => [i.id, i.value])),
    ) as Record<string, string>,
    cobrosPendientes: props(QuickActions)[0]?.cobrosPendientesCount as number | undefined,
    alertas: props(AlertItem).map((p) => p.title as string),
    texto: texto(arbol),
  }
}
type Vista = ReturnType<typeof resumen>

const pesos = (n: number) => formatCurrency(n, "ARS")

// ---- what each scope must show ----------------------------------------------------------------

const ESTADOS_VACIOS = {
  RECIBIDO: 0, EN_DIAGNOSTICO: 0, PRESUPUESTADO: 0, APROBADO: 0, EN_REPARACION: 0, ESPERANDO_REPUESTO: 0,
  REPARADO: 0, ENTREGADO: 0, ENTREGADO_SIN_REPARACION: 0, ENTREGADO_SIN_COBRO: 0, CANCELADO: 0, SIN_REPARACION: 0,
}

const ESPERADO = {
  A: {
    pendientes: "2", totales: "3 totales", hero: pesos(330), hoy: pesos(330), cambio: { pct: 10, direction: "up" },
    estados: { ...ESTADOS_VACIOS, RECIBIDO: 1, EN_REPARACION: 1, ENTREGADO: 1 }, ingresos7: 330,
    porTecnico: [{ nombre: "Tec A", ordenes: 1, completadas: 1 }],
    recientes: ["ord-A2", "ord-A1", "ord-A3"],
    acciones: { cobros: `${pesos(500)} · 1 orden`, sla: "1 orden", garantias: "2", stock: "2 items" },
    cobrosPendientes: 1,
  },
  B: {
    pendientes: "1", totales: "2 totales", hero: pesos(110), hoy: pesos(20), cambio: { pct: 50, direction: "down" },
    estados: { ...ESTADOS_VACIOS, RECIBIDO: 1, REPARADO: 1 }, ingresos7: 110,
    porTecnico: [{ nombre: "Tec A", ordenes: 1, completadas: 0 }],
    recientes: ["ord-B1", "ord-B2"],
    acciones: { cobros: `${pesos(200)} · 1 orden`, sla: "1 orden", garantias: "2", stock: "2 items" },
    cobrosPendientes: 1,
  },
  TODAS: {
    pendientes: "3", totales: "5 totales", hero: pesos(440), hoy: pesos(350), cambio: { pct: 15, direction: "down" },
    estados: { ...ESTADOS_VACIOS, RECIBIDO: 2, EN_REPARACION: 1, ENTREGADO: 1, REPARADO: 1 }, ingresos7: 440,
    porTecnico: [{ nombre: "Tec A", ordenes: 2, completadas: 1 }],
    recientes: ["ord-A2", "ord-B1", "ord-A1", "ord-B2", "ord-A3"],
    acciones: { cobros: `${pesos(700)} · 2 ordenes`, sla: "2 ordenes", garantias: "4", stock: "2 items" },
    cobrosPendientes: 2,
  },
}
type Esperado = (typeof ESPERADO)["A"]

/** What an ADMIN's dashboard shows for a scope. */
function vistaAdmin(e: Esperado) {
  return {
    pendientes: e.pendientes, totales: e.totales, hero: e.hero, hoy: e.hoy, cambio: e.cambio, estados: e.estados,
    ingresos7: e.ingresos7, porTecnico: e.porTecnico, recientes: e.recientes, acciones: e.acciones, cobrosPendientes: e.cobrosPendientes,
  }
}
function leerAdmin(v: Vista) {
  return {
    pendientes: v.tarjetas["Órdenes Pendientes"]?.valor, totales: v.tarjetas["Órdenes Pendientes"]?.detalle, hero: v.hero?.valor,
    hoy: v.hero?.hoy, cambio: v.hero?.cambio, estados: v.estados, ingresos7: v.ingresos7, porTecnico: v.porTecnico,
    recientes: v.recientes, acciones: v.acciones, cobrosPendientes: v.cobrosPendientes,
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(AHORA)
  cacheNext.entradas.clear()
  cacheNext.ejecuciones.length = 0
  vi.mocked(sesionConSucursalVigente).mockReset()
  vi.mocked(auth).mockReset()
  montarSupabaseEnMemoria(mundo())
})
afterEach(() => {
  vi.useRealTimers()
})

describe("an ADMIN's dashboard (OI-1, SC-3, SC-4)", () => {
  it.each([
    ["Todas las sucursales", ADMIN_TODAS, ESPERADO.TODAS],
    ["branch A selected", ADMIN_A, ESPERADO.A],
    ["branch B selected", ADMIN_B, ESPERADO.B],
  ])("%s shows exactly that scope: orders, money, charts, alerts", async (_caso, espectador, esperado) => {
    expect(leerAdmin(resumen(await cargar(espectador)))).toEqual(vistaAdmin(esperado))
  })

  it("Todas is the sum of the branches (SC-4): orders, orders by state, collections, and no order counted twice", async () => {
    const a = leerAdmin(resumen(await cargar(ADMIN_A)))
    const b = leerAdmin(resumen(await cargar(ADMIN_B)))
    const todas = leerAdmin(resumen(await cargar(ADMIN_TODAS)))
    const n = (texto: string | undefined) => parseInt(texto ?? "", 10)

    expect(n(a.totales) + n(b.totales)).toBe(n(todas.totales))
    expect(n(a.pendientes) + n(b.pendientes)).toBe(n(todas.pendientes))
    expect(a.ingresos7! + b.ingresos7!).toBe(todas.ingresos7)
    expect(a.cobrosPendientes! + b.cobrosPendientes!).toBe(todas.cobrosPendientes)
    for (const estado of Object.keys(ESTADOS_VACIOS)) {
      expect(a.estados![estado] + b.estados![estado], estado).toBe(todas.estados![estado])
    }
    expect([...a.recientes, ...b.recientes].sort()).toEqual([...todas.recientes].sort())
    expect(todas.recientes).toHaveLength(5)
  })
})

describe("the cache never serves a scope to a viewer of another (OI-1)", () => {
  const ESPECTADORES: Array<[string, Espectador, Esperado]> = [
    ["A staff", VENDEDOR_A, ESPERADO.A],
    ["B staff", VENDEDOR_B, ESPERADO.B],
    ["ADMIN Todas", ADMIN_TODAS, ESPERADO.TODAS],
    ["ADMIN selected B", ADMIN_B, ESPERADO.B],
  ]

  function permutaciones<T>(lista: T[]): T[][] {
    if (lista.length <= 1) return [lista]
    return lista.flatMap((x, i) => permutaciones([...lista.slice(0, i), ...lista.slice(i + 1)]).map((resto) => [x, ...resto]))
  }

  it.each(permutaciones(ESPECTADORES).map((orden) => [orden.map(([nombre]) => nombre).join(" > "), orden] as const))(
    "A staff 3 / B staff 2 / ADMIN Todas 5 / ADMIN B == B staff, loaded in this order: %s",
    async (_nombre, orden) => {
      for (const [, espectador, esperado] of orden) {
        const v = resumen(await cargar(espectador))
        expect({ pendientes: v.tarjetas["Órdenes Pendientes"]?.valor, totales: v.tarjetas["Órdenes Pendientes"]?.detalle, recientes: v.recientes }).toEqual({
          pendientes: esperado.pendientes, totales: esperado.totales, recientes: esperado.recientes,
        })
      }
    },
  )

  it("the scope is an ARGUMENT of the cached function: one entry per scope, shared by whoever has it", async () => {
    await cargar(VENDEDOR_A)
    await cargar(VENDEDOR_B)
    await cargar(ADMIN_TODAS)
    await cargar(ADMIN_B) // same scope as B staff: a hit
    await cargar(VENDEDOR_A) // a hit
    expect(cacheNext.ejecuciones).toEqual([
      [ORG, "suc-A"],
      [ORG, "suc-B"],
      [ORG, "todas"],
    ])
  })

  it("ADMIN selected B reads the very same entry B staff reads, so their rows and totals cannot differ (SC-3)", async () => {
    const staff = resumen(await cargar(VENDEDOR_B))
    const admin = resumen(await cargar(ADMIN_B))
    expect(cacheNext.ejecuciones).toHaveLength(1)
    expect(admin.tarjetas["Órdenes Pendientes"]).toEqual(staff.tarjetas["Órdenes Pendientes"])
    expect(admin.recientes).toEqual(staff.recientes)
  })

  it("two organizations never share an entry even on 'todas'", async () => {
    await cargar(ADMIN_TODAS)
    vi.mocked(sesionConSucursalVigente).mockResolvedValue({
      user: { id: "u-admin", role: "ADMIN", organizationId: "org-2", sucursalId: null, name: "x" },
    } as any)
    montarSupabaseEnMemoria({ ...mundo(), organizations: [{ id: "org-2", moneda: "ARS", zona_horaria: "x", onboarding_completed: true, pais: "AR" }] })
    await DashboardPage()
    expect(cacheNext.ejecuciones).toEqual([
      [ORG, "todas"],
      ["org-2", "todas"],
    ])
  })
})

describe("a non-admin has one branch and the stored choice is ignored (SC-1, XC-4)", () => {
  it("a VENDEDOR of A with the cookie of B still gets A", async () => {
    const v = resumen(await cargar({ ...VENDEDOR_A, cookie: "suc-B" }))
    expect(v.tarjetas["Órdenes Pendientes"]).toEqual({ valor: "2", detalle: "3 totales" })
    expect(cacheNext.ejecuciones).toEqual([[ORG, "suc-A"]])
  })

  it("the branch is the FRESH one, not the JWT's (a user moved since login)", async () => {
    // cargar() gives a raw auth() a JWT that still holds an old branch.
    const v = resumen(await cargar({ ...VENDEDOR_B, cookie: "suc-A" }))
    expect(v.tarjetas["Órdenes Pendientes"]).toEqual({ valor: "1", detalle: "2 totales" })
    expect(sesionConSucursalVigente).toHaveBeenCalledTimes(1)
    expect(cacheNext.ejecuciones).toEqual([[ORG, "suc-B"]])
  })

  it("no branch (fail-closed): nothing branch-scoped, and the entry of nobody", async () => {
    const v = resumen(await cargar({ id: "u-sin", role: "VENDEDOR", sucursal: null }))
    expect(v.tarjetas["Órdenes Pendientes"]).toEqual({ valor: "0", detalle: "0 totales" })
    expect(v.recientes).toEqual([])
    expect(v.texto).not.toContain("Cliente venta")
    expect(cacheNext.ejecuciones).toEqual([[ORG, SUCURSAL_NINGUNA]])
  })

  it("an ADMIN cookie that cannot be spliced into a filter shows nothing instead of everything", async () => {
    const v = resumen(await cargar({ ...ADMIN_TODAS, cookie: "suc-A,sucursal_id.neq.zzz" }))
    expect(leerAdmin(v).pendientes).toBe("0")
    expect(v.recientes).toEqual([])
    expect(cacheNext.ejecuciones).toEqual([[ORG, SUCURSAL_NINGUNA]])
  })

  it("a session the database no longer backs (the JWT still looks fine): login", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "u-va", role: "VENDEDOR", organizationId: ORG, sucursalId: "suc-A" } } as any)
    vi.mocked(sesionConSucursalVigente).mockResolvedValue(null)
    await expect(DashboardPage()).rejects.toThrow("REDIRECT:/login")
  })

  it("no session at all: login", async () => {
    vi.mocked(auth).mockResolvedValue(null as any)
    vi.mocked(sesionConSucursalVigente).mockResolvedValue(null)
    await expect(DashboardPage()).rejects.toThrow("REDIRECT:/login")
  })
})

describe("a seller's dashboard", () => {
  it("shows the branch's pending orders, the seller's own sales of that branch, and no other branch's warranty detail", async () => {
    const v = resumen(await cargar(VENDEDOR_A))
    expect(v.tarjetas).toMatchObject({
      "Órdenes Pendientes": { valor: "2", detalle: "3 totales" },
      "Mis Ventas Hoy": { valor: pesos(200), detalle: "1 venta" },
      "Mis Ventas del Mes": { valor: pesos(200), detalle: "1 ventas completadas" },
    })
    expect(v.alertas).toEqual(["1 garantía de venta por vencer", "2 items con stock bajo", "2 órdenes pendientes"])
    expect(v.texto).toContain("Cliente venta A")
    expect(v.texto).not.toContain("Cliente venta B")
  })

  it("the other branch's seller sees his own side only", async () => {
    const v = resumen(await cargar(VENDEDOR_B))
    expect(v.tarjetas["Mis Ventas del Mes"]).toEqual({ valor: pesos(50), detalle: "1 ventas completadas" })
    expect(v.tarjetas["Mis Ventas Hoy"]).toEqual({ valor: pesos(0), detalle: "0 ventas" })
    expect(v.texto).toContain("Cliente venta B")
    expect(v.texto).not.toContain("Cliente venta A")
  })

  it("a seller moved to another branch counts his sales of the new branch, like the sales list does (BM-2)", async () => {
    const datos = mundo()
    datos.ventas.push(
      { id: "v-M1", organization_id: ORG, total: 70, estado: "COMPLETADA", created_at: HOY, vendedor_id: "u-vb", sucursal_id: "suc-A" },
    )
    montarSupabaseEnMemoria(datos)
    const v = resumen(await cargar(VENDEDOR_B))
    // u-vb sold 70 while he was in A and 50 in B; he is in B now: only the 50 counts.
    expect(v.tarjetas["Mis Ventas del Mes"]).toEqual({ valor: pesos(50), detalle: "1 ventas completadas" })
    expect(v.tarjetas["Mis Ventas Hoy"]).toEqual({ valor: pesos(0), detalle: "0 ventas" })
  })
})

describe("a technician's dashboard keeps what is assigned to him, from any branch (BM-6)", () => {
  it("counts his assigned orders of both branches and no unassigned order of either", async () => {
    const v = resumen(await cargar(TECNICO_A))
    // ord-A2 (A) and ord-B1 (B) are active and assigned to him; ord-B1 is received; ord-A3 is done.
    expect(v.tarjetas).toMatchObject({
      "Mis Órdenes Activas": { valor: "2" },
      "Sin Diagnóstico": { valor: "1" },
      "Esperando Repuesto": { valor: "0" },
      "Completadas (Mes)": { valor: "1", detalle: "Prom. 2 días" },
    })
    expect(v.alertas).toEqual(["1 orden con fecha prometida vencida", "1 orden sin diagnóstico"])
  })

  it("lists his orders newest first, with the one of the other branch among them", async () => {
    const v = resumen(await cargar(TECNICO_A))
    expect(v.recientes).toEqual(["ord-A2", "ord-B1", "ord-A3"])
  })

  it("a technician of B with nothing assigned sees nothing of A or B", async () => {
    const v = resumen(await cargar(TECNICO_B))
    expect(v.tarjetas["Mis Órdenes Activas"]).toEqual({ valor: "0", detalle: "Asignadas a mí" })
    expect(v.recientes).toEqual([])
    expect(v.alertas).toEqual([])
    expect(v.texto).toContain("No hay alertas pendientes")
  })
})

describe("an org with one branch sees what it always saw (XC-3)", () => {
  beforeEach(() => {
    montarSupabaseEnMemoria(mundo(true))
  })
  const UNICA: Espectador = { id: "u-va", role: "VENDEDOR", sucursal: "suc-U" }

  it("the seller of the only branch gets the numbers of the whole org", async () => {
    const v = resumen(await cargar(UNICA))
    expect(v.tarjetas["Órdenes Pendientes"]).toEqual({ valor: ESPERADO.TODAS.pendientes, detalle: ESPERADO.TODAS.totales })
    expect(v.recientes).toEqual(ESPERADO.TODAS.recientes)
    expect(v.alertas).toEqual(["2 garantías de venta por vencer", "2 items con stock bajo", "3 órdenes pendientes"])
  })

  it.each([
    ["Todas", ADMIN_TODAS],
    ["the only branch selected", { ...ADMIN_TODAS, cookie: "suc-U" }],
  ])("the ADMIN (%s) gets the numbers of the whole org, money included", async (_caso, espectador) => {
    expect(leerAdmin(resumen(await cargar(espectador)))).toEqual(vistaAdmin(ESPERADO.TODAS))
  })
})

describe("widgets that are org-wide for now", () => {
  // The PR that scopes each of them takes it off its list and moves the expectation into the scoped tables.
  const PENDIENTE_PR15 = ["itemsBajoStock"]
  const PENDIENTE_PR18 = ["totalClientes", "clientesMesAnterior"]

  it("lists exactly what is left unscoped", () => {
    expect([...PENDIENTE_PR15, ...PENDIENTE_PR18]).toEqual(["itemsBajoStock", "totalClientes", "clientesMesAnterior"])
  })

  it.each([
    ["A", VENDEDOR_A],
    ["B", VENDEDOR_B],
  ])("the low-stock count (PR15) and the client counts (PR18) are still the org's, for branch %s", async (_caso, espectador) => {
    const v = resumen(await cargar(espectador))
    expect(v.alertas).toContain("2 items con stock bajo")
    expect(v.tarjetas["Clientes"]).toEqual({ valor: "4", detalle: "Total registrados" })
  })

  it("and for an ADMIN: the same numbers, the client change included", async () => {
    const v = resumen(await cargar(ADMIN_B))
    expect(v.tarjetas["Clientes"]?.valor).toBe("4")
    expect(v.clientesCambio).toEqual({ pct: 100, direction: "up" })
    expect(v.acciones.stock).toBe("2 items")
  })
})
