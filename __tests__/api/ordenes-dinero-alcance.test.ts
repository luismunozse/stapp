// @vitest-environment node
/**
 * The money read surfaces of orders under branch isolation (change sucursales-aislamiento, PR5; OI-1,
 * SC-2, SC-3, OD-9): invoicing candidates and a client's pending orders. Collections, invoices and
 * debt stay with the branch that took the order in (the origin), however the order is handled.
 *
 * Same world on both: orders of A and B, an ADMIN on Todas, an ADMIN with a branch selected, and staff
 * of each branch. The tables are in-memory and honor every filter.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { cookies } from "next/headers"
import { SUCURSAL_COOKIE } from "@/lib/sucursal"
import { mockAuthSuccess, parseResponse } from "./helpers"
import { montarSupabaseEnMemoria } from "../helpers/supabase-memoria"
import { GET as candidatos } from "@/app/api/facturacion/candidatos/route"
import { GET as pendientes } from "@/app/api/clientes/[id]/ordenes-pendientes/route"

const A = "suc-A"
const B = "suc-B"

interface Espectador {
  nombre: string
  role: "ADMIN" | "VENDEDOR" | "TECNICO"
  sucursalId: string | null
  cookie?: string
}
const ADMIN_TODAS: Espectador = { nombre: "ADMIN Todas", role: "ADMIN", sucursalId: null }
const ADMIN_A: Espectador = { ...ADMIN_TODAS, nombre: "ADMIN selected A", cookie: A }
const ADMIN_B: Espectador = { ...ADMIN_TODAS, nombre: "ADMIN selected B", cookie: B }
const VENDEDOR_A: Espectador = { nombre: "VENDEDOR of A", role: "VENDEDOR", sucursalId: A }
const VENDEDOR_B: Espectador = { nombre: "VENDEDOR of B", role: "VENDEDOR", sucursalId: B }
const VENDEDOR_SIN_SUCURSAL: Espectador = { nombre: "VENDEDOR without a branch", role: "VENDEDOR", sucursalId: null }

const conNombre = <R extends unknown[]>(filas: Array<[Espectador, ...R]>) =>
  filas.map(([e, ...resto]) => [e.nombre, e, ...resto] as [string, Espectador, ...R])

function entrar(e: Espectador) {
  mockAuthSuccess({ role: e.role, userId: "u-1", sucursalId: e.sucursalId })
  vi.mocked(cookies).mockResolvedValue({
    get: (nombre: string) => (nombre === SUCURSAL_COOKIE && e.cookie ? { value: e.cookie } : undefined),
    set: vi.fn(),
  } as any)
}

let numero = 0
const orden = (id: string, sucursal: string, extra: Record<string, unknown> = {}) => {
  numero++
  return {
    id,
    organization_id: "org-1",
    sucursal_id: sucursal,
    cliente_id: "cl-1",
    numero_orden: numero,
    codigo_orden: `CEL-${numero}`,
    dispositivo: `Galaxy ${id}`,
    estado: "REPARADO",
    fecha_ingreso: `2026-10-${String(numero).padStart(2, "0")}T10:00:00Z`,
    costo_final: 1000,
    total_cobrado: 0,
    descuento_cobro: 0,
    estado_cobro: "PENDIENTE",
    es_practica: false,
    clientes: { nombre: "Cliente" },
    facturas: [],
    notas_credito: [],
    ...extra,
  }
}

const venta = (id: string, sucursal: string, extra: Record<string, unknown> = {}) => ({
  id,
  organization_id: "org-1",
  sucursal_id: sucursal,
  numero_venta: Number(id.replace(/\D/g, "")),
  cliente_nombre: "Cliente",
  total: "500",
  estado: "COMPLETADA",
  created_at: "2026-10-05T10:00:00Z",
  facturas: [],
  ...extra,
})

function montar() {
  numero = 0
  return montarSupabaseEnMemoria({
    ordenes_servicio: [
      orden("oA1", A),
      orden("oA2", A),
      orden("oB1", B),
      orden("oA3-facturada", A, { facturas: [{ id: "f-1" }] }),
      orden("oB2-pagada", B, { estado_cobro: "PAGADO" }),
    ],
    ventas: [venta("v1", A), venta("v2", B), venta("v3", B)],
    cuenta_corriente: [],
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("GET /api/facturacion/candidatos (ADMIN)", () => {
  async function ids(e: Espectador) {
    entrar(e)
    montar()
    const { status, body } = await parseResponse(await candidatos(new Request("http://localhost:3000/api/facturacion/candidatos")))
    expect(status).toBe(200)
    return {
      ordenes: (body.ordenes as Array<{ id: string }>).map((o) => o.id).sort(),
      ventas: (body.ventas as Array<{ id: string }>).map((v) => v.id).sort(),
    }
  }

  it.each(
    conNombre([
      [ADMIN_TODAS, { ordenes: ["oA1", "oA2", "oB1", "oB2-pagada"], ventas: ["v1", "v2", "v3"] }],
      [ADMIN_A, { ordenes: ["oA1", "oA2"], ventas: ["v1"] }],
      [ADMIN_B, { ordenes: ["oB1", "oB2-pagada"], ventas: ["v2", "v3"] }],
    ]),
  )("%s gets the candidates of that scope", async (_nombre, espectador, esperado) => {
    expect(await ids(espectador)).toEqual(esperado)
  })

  it("the candidates of the branches add up to Todas (SC-4)", async () => {
    const [a, b, todas] = [await ids(ADMIN_A), await ids(ADMIN_B), await ids(ADMIN_TODAS)]
    expect([...a.ordenes, ...b.ordenes].sort()).toEqual(todas.ordenes)
    expect([...a.ventas, ...b.ventas].sort()).toEqual(todas.ventas)
  })

  it("only an ADMIN gets them", async () => {
    entrar(VENDEDOR_A)
    montar()
    expect((await candidatos(new Request("http://localhost:3000/api/facturacion/candidatos"))).status).toBe(403)
  })
})

describe("GET /api/clientes/[id]/ordenes-pendientes", () => {
  async function ids(e: Espectador) {
    entrar(e)
    montar()
    const { status, body } = await parseResponse(
      await pendientes(new Request("http://localhost:3000/api/clientes/cl-1/ordenes-pendientes"), { params: Promise.resolve({ id: "cl-1" }) }),
    )
    expect(status).toBe(200)
    return (body as Array<{ id: string }>).map((o) => o.id).sort()
  }

  it.each(
    conNombre([
      [ADMIN_TODAS, ["oA1", "oA2", "oA3-facturada", "oB1"]],
      [ADMIN_A, ["oA1", "oA2", "oA3-facturada"]],
      [ADMIN_B, ["oB1"]],
      [VENDEDOR_A, ["oA1", "oA2", "oA3-facturada"]],
      [VENDEDOR_B, ["oB1"]],
      [VENDEDOR_SIN_SUCURSAL, []],
    ]),
  )("%s owes to the branch of the order: the expected pending orders", async (_nombre, espectador, esperado) => {
    expect(await ids(espectador)).toEqual(esperado)
  })

  it("an ADMIN with a branch selected gets what that branch's seller gets (SC-3)", async () => {
    expect(await ids(ADMIN_B)).toEqual(await ids(VENDEDOR_B))
  })

  it("a seller ignores the stored choice of another branch", async () => {
    expect(await ids({ ...VENDEDOR_A, cookie: B })).toEqual(["oA1", "oA2", "oA3-facturada"])
  })
})
