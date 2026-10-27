// @vitest-environment node
/**
 * GET /api/clientes/[id] reaches orders through an embed (the last ten orders of the client). Under
 * branch isolation those orders follow the same scope as the list (change sucursales-aislamiento, PR5;
 * OI-1, SC-3, BM-6, OI-3, XC-4). The client is shared across branches (that is PR18's to change), so the
 * client always comes back; only its embedded orders are narrowed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { cookies } from "next/headers"
import { SUCURSAL_COOKIE } from "@/lib/sucursal"
import { mockAuthSuccess, parseResponse } from "./helpers"
import { montarSupabaseEnMemoria } from "../helpers/supabase-memoria"
import { GET } from "@/app/api/clientes/[id]/route"

const A = "suc-A"
const B = "suc-B"

const embebida = (id: string, numero: number, sucursal: string, tecnico: string | null, dia: number) => ({
  id,
  numero_orden: numero,
  dispositivo: `Galaxy ${id}`,
  estado: "EN_REPARACION",
  fecha_ingreso: `2026-10-${String(dia).padStart(2, "0")}T10:00:00Z`,
  sucursal_id: sucursal,
  tecnico_id: tecnico,
})

// One client with an order of each kind: free and held by t-a in A, free and held by t-a / t-b in B.
const ORDENES_DEL_CLIENTE = [
  embebida("a1", 101, A, null, 1),
  embebida("a2", 102, A, "t-a", 2),
  embebida("a3", 103, A, "t-b", 3),
  embebida("b1", 104, B, null, 4),
  embebida("b2", 105, B, "t-a", 5),
  embebida("b3", 106, B, "t-b", 6),
]

function montar(toma = false, ordenes = ORDENES_DEL_CLIENTE) {
  return montarSupabaseEnMemoria({
    clientes: [
      { id: "cl-1", organization_id: "org-1", nombre: "Cliente", telefono: "1", ordenes_servicio: ordenes, sectores_cliente: [] },
      { id: "cl-ajeno", organization_id: "org-2", nombre: "De otra organización", telefono: "2", ordenes_servicio: [], sectores_cliente: [] },
    ],
    organizations: [{ id: "org-1", tecnicos_toman_ordenes: toma }],
  })
}

interface Espectador {
  nombre: string
  role: "ADMIN" | "VENDEDOR" | "TECNICO"
  userId: string
  sucursalId: string | null
  cookie?: string
}
const ADMIN_TODAS: Espectador = { nombre: "ADMIN Todas", role: "ADMIN", userId: "u-admin", sucursalId: null }
const ADMIN_B: Espectador = { nombre: "ADMIN selected B", role: "ADMIN", userId: "u-admin", sucursalId: null, cookie: B }
const VENDEDOR_A: Espectador = { nombre: "VENDEDOR of A", role: "VENDEDOR", userId: "v-a", sucursalId: A }
const VENDEDOR_B: Espectador = { nombre: "VENDEDOR of B", role: "VENDEDOR", userId: "v-b", sucursalId: B }
const VENDEDOR_SIN_SUCURSAL: Espectador = { nombre: "VENDEDOR without a branch", role: "VENDEDOR", userId: "v-x", sucursalId: null }
const TECNICO_A: Espectador = { nombre: "TECNICO t-a of A", role: "TECNICO", userId: "t-a", sucursalId: A }
const TECNICO_SIN_SUCURSAL: Espectador = { nombre: "TECNICO t-a without a branch", role: "TECNICO", userId: "t-a", sucursalId: null }

function entrar(e: Espectador) {
  mockAuthSuccess({ role: e.role, userId: e.userId, sucursalId: e.sucursalId })
  vi.mocked(cookies).mockResolvedValue({
    get: (nombre: string) => (nombre === SUCURSAL_COOKIE && e.cookie ? { value: e.cookie } : undefined),
    set: vi.fn(),
  } as any)
}

async function pedir(e: Espectador, id = "cl-1", toma = false, ordenes = ORDENES_DEL_CLIENTE) {
  entrar(e)
  const memoria = montar(toma, ordenes)
  const { status, body } = await parseResponse(await GET(new Request(`http://localhost:3000/api/clientes/${id}`), { params: Promise.resolve({ id }) }))
  return { status, body, memoria, ordenes: ((body.ordenes ?? []) as Array<{ id: string }>).map((o) => o.id).sort() }
}

beforeEach(() => vi.clearAllMocks())

describe("GET /api/clientes/[id]: the orders of the client follow the list scope", () => {
  const CASOS: Array<[Espectador, boolean, string[]]> = [
    [ADMIN_TODAS, false, ["a1", "a2", "a3", "b1", "b2", "b3"]],
    [VENDEDOR_A, false, ["a1", "a2", "a3"]],
    [VENDEDOR_B, false, ["b1", "b2", "b3"]],
    [ADMIN_B, false, ["b1", "b2", "b3"]],
    [VENDEDOR_SIN_SUCURSAL, false, []],
    [TECNICO_A, false, ["a2", "b2"]],
    [TECNICO_A, true, ["a1", "a2", "b2"]],
    [TECNICO_SIN_SUCURSAL, true, ["a2", "b2"]],
  ]

  it.each(CASOS.map(([e, toma, esperado]) => [`${e.nombre} (opt-in ${toma ? "on" : "off"})`, e, toma, esperado] as const))(
    "%s sees the expected orders",
    async (_nombre, espectador, toma, esperado) => {
      const { status, ordenes } = await pedir(espectador, "cl-1", toma)
      expect(status).toBe(200)
      expect(ordenes).toEqual(esperado)
    },
  )

  it("an ADMIN with a branch selected sees what that branch's seller sees (SC-3)", async () => {
    expect((await pedir(ADMIN_B)).ordenes).toEqual((await pedir(VENDEDOR_B)).ordenes)
  })

  it("a seller ignores the stored choice of another branch", async () => {
    expect((await pedir({ ...VENDEDOR_A, cookie: B })).ordenes).toEqual(["a1", "a2", "a3"])
  })

  it("the client always comes back, even when none of its orders is in the scope", async () => {
    const { status, body } = await pedir(VENDEDOR_SIN_SUCURSAL)
    expect(status).toBe(200)
    expect(body.id).toBe("cl-1")
    expect(body.ordenes).toEqual([])
  })

  it("the ten most recent orders of the scope, not of the whole client", async () => {
    // Twelve orders of A, newer than the single order of B: a seller of B must still get his own.
    const muchas = [
      ...Array.from({ length: 12 }, (_, i) => embebida(`a-${i}`, 200 + i, A, null, 10 + i)),
      embebida("b-viejo", 300, B, null, 1),
    ]
    expect((await pedir(VENDEDOR_B, "cl-1", false, muchas)).ordenes).toEqual(["b-viejo"])
    expect((await pedir(VENDEDOR_A, "cl-1", false, muchas)).ordenes).toHaveLength(10)
  })

  it("a client of another organization is still not found", async () => {
    expect((await pedir(ADMIN_TODAS, "cl-ajeno")).status).toBe(404)
  })
})
