import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { createChainMock } from "./helpers"
import { supabaseAdmin } from "@/lib/supabase"

vi.mock("@/lib/notifications/queue", () => ({
  queueNotification: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/cron-auth", () => ({
  requireCronAuth: vi.fn(() => null),
}))

import { GET } from "@/app/api/cron/garantias-por-vencer/route"
import { queueNotification } from "@/lib/notifications/queue"
import { requireCronAuth } from "@/lib/cron-auth"
import { CRON_JOBS } from "@/lib/cron-config"

// 10:00 en Buenos Aires (UTC-3): la hora a la que corre cada org.
const UTC_10_AR = "2026-11-11T13:00:00.000Z"

const ORG = {
  id: "org-1",
  nombre: "Taller",
  nombre_mostrar: "Taller Test",
  slug: "taller",
  moneda: "ARS",
  zona_horaria: "America/Argentina/Buenos_Aires",
  notificaciones_email: true,
  notificaciones_whatsapp: true,
  garantia_aviso_vencimiento: true,
  garantia_ventana_por_vencer_dias: 7,
}

const REPARACION = {
  id: "g-rep",
  origen: "REPARACION",
  organization_id: "org-1",
  sucursal_id: "suc-1",
  cliente_id: "cli-1",
  descripcion: "iPhone 12",
  orden_id: "ord-1",
  numero_garantia: null,
  dias_validez: 90,
  fecha_vencimiento: "2026-11-15T12:00:00Z",
  dia_vencimiento: "2026-11-15",
}

const VENTA = {
  ...REPARACION,
  id: "g-venta",
  origen: "VENTA",
  cliente_id: "cli-2",
  descripcion: "Auriculares BT",
  orden_id: null,
  numero_garantia: "G-0001",
  dias_validez: 30,
  dia_vencimiento: "2026-11-11",
}

/**
 * Simula las tablas de garantías con la marca de aviso: el UPDATE condicional
 * (... IS NULL) solo "toma" la fila si nadie la marcó antes, igual que en la base.
 */
function tablaConMarca(marcadas: Set<string>) {
  return () => {
    let update: Record<string, unknown> | null = null
    let id: string | null = null
    let ids: string[] = []
    const chain: any = {}
    for (const m of ["select", "eq", "is", "not", "in", "order", "limit"]) {
      chain[m] = vi.fn((...args: unknown[]) => {
        if (m === "eq" && args[0] === "id") id = args[1] as string
        if (m === "in" && args[0] === "id") ids = args[1] as string[]
        return chain
      })
    }
    chain.update = vi.fn((v: Record<string, unknown>) => {
      update = v
      return chain
    })
    chain.then = (resolve: any, reject?: any) => {
      let data: unknown
      if (update && update.aviso_vencimiento_enviado_at) {
        const tomada = !!id && !marcadas.has(id)
        if (tomada) marcadas.add(id!)
        data = tomada ? [{ id }] : []
      } else if (update) {
        if (id) marcadas.delete(id)
        data = null
      } else {
        data = ids.filter((i) => marcadas.has(i)).map((i) => ({ id: i }))
      }
      return Promise.resolve({ data, error: null }).then(resolve, reject)
    }
    return chain
  }
}

function mockDb(opts: { orgs?: unknown[]; candidatas?: unknown[]; marcadas?: Set<string>; clientes?: unknown[] } = {}) {
  const marcadas = opts.marcadas ?? new Set<string>()
  const vistas: ReturnType<typeof createChainMock>[] = []
  const tablas: Record<string, ReturnType<typeof tablaConMarca>> = {
    garantias: tablaConMarca(marcadas),
    garantias_venta: tablaConMarca(marcadas),
  }
  const orgChain = createChainMock(opts.orgs ?? [ORG])
  vi.mocked(supabaseAdmin.from).mockImplementation((t: string) => {
    if (t === "organizations") return orgChain as any
    if (t === "v_garantias") {
      const c = createChainMock(opts.candidatas ?? [REPARACION, VENTA])
      vistas.push(c)
      return c as any
    }
    if (tablas[t]) return tablas[t]() as any
    if (t === "clientes")
      return createChainMock(
        opts.clientes ?? [
          { id: "cli-1", nombre: "Ana", email: "ana@test.com", telefono: "1100000000" },
          { id: "cli-2", nombre: "Beto", email: null, telefono: "1100000001" },
        ]
      ) as any
    if (t === "ordenes_servicio")
      return createChainMock([{ id: "ord-1", numero_orden: 42, dispositivo: "iPhone 12", public_token: "tok" }]) as any
    return createChainMock([]) as any
  })
  return { marcadas, vistas, orgChain }
}

const correr = (q = "") => GET(new Request(`http://localhost/api/cron/garantias-por-vencer${q}`))

describe("GET /api/cron/garantias-por-vencer", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date(UTC_10_AR))
  })
  afterEach(() => vi.useRealTimers())

  it("pide la auth del cron", async () => {
    const { NextResponse } = await import("next/server")
    vi.mocked(requireCronAuth).mockReturnValueOnce(NextResponse.json({ error: "No autorizado" }, { status: 401 }))
    const res = await correr()
    expect(res.status).toBe(401)
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it("avisa garantías de reparación Y de venta que entran en la ventana", async () => {
    const { vistas, orgChain } = mockDb()
    const res = await correr()
    const body = await res.json()
    expect(body.enviados).toBe(2)
    expect(orgChain.eq).toHaveBeenCalledWith("garantia_aviso_vencimiento", true)

    // Misma consulta que la pestaña Por vencer: no anuladas, sin reclamo, de hoy a hoy + ventana.
    expect(vistas[0].eq).toHaveBeenCalledWith("organization_id", "org-1")
    expect(vistas[0].eq).toHaveBeenCalledWith("anulada", false)
    expect(vistas[0].eq).toHaveBeenCalledWith("tiene_reclamo_abierto", false)
    expect(vistas[0].gte).toHaveBeenCalledWith("dia_vencimiento", "2026-11-11")
    expect(vistas[0].lte).toHaveBeenCalledWith("dia_vencimiento", "2026-11-18")

    const avisos = vi.mocked(queueNotification).mock.calls.map((c) => c[0])
    expect(avisos.map((a) => a.tipo)).toEqual(["GARANTIA_POR_VENCER", "GARANTIA_POR_VENCER"])
    const rep = avisos.find((a) => a.garantiaId === "g-rep")!
    expect(rep).toMatchObject({ organizationId: "org-1", ordenId: "ord-1", clienteId: "cli-1" })
    expect(rep.context.garantia).toMatchObject({ origen: "REPARACION", diasRestantes: 4 })
    expect(rep.context.orden?.publicToken).toBe("tok")
    const venta = avisos.find((a) => a.clienteId === "cli-2")!
    // notification_logs.garantia_id es FK a garantias (reparación): la de venta no va.
    expect(venta.garantiaId).toBeUndefined()
    expect(venta.ordenId).toBeUndefined()
    expect(venta.context.garantia).toMatchObject({ origen: "VENTA", numeroGarantia: "G-0001", diasRestantes: 0 })
  })

  it("es idempotente: una segunda corrida no vuelve a avisar", async () => {
    const { marcadas } = mockDb()
    await correr()
    expect(queueNotification).toHaveBeenCalledTimes(2)
    expect([...marcadas].sort()).toEqual(["g-rep", "g-venta"])

    vi.mocked(queueNotification).mockClear()
    mockDb({ marcadas })
    const body = await (await correr("?force=1")).json()
    expect(queueNotification).not.toHaveBeenCalled()
    expect(body.enviados).toBe(0)
    expect(body.omitidos).toBe(2)
  })

  it("si otra corrida tomó la marca entre la lectura y el UPDATE, no avisa", async () => {
    const { marcadas } = mockDb({ candidatas: [REPARACION] })
    const original = vi.mocked(supabaseAdmin.from).getMockImplementation()!
    let pedidos = 0
    vi.mocked(supabaseAdmin.from).mockImplementation((t: string) => {
      // 1er pedido a garantias: la lectura de las ya avisadas (no la ve marcada).
      // 2do: el UPDATE condicional; justo antes, otra corrida la marca.
      if (t === "garantias" && ++pedidos === 2) marcadas.add("g-rep")
      return original(t)
    })
    const body = await (await correr()).json()
    expect(queueNotification).not.toHaveBeenCalled()
    expect(body.enviados).toBe(0)
    expect(body.omitidos).toBe(1)
  })

  it("si el encolado falla, suelta la marca para reintentar mañana", async () => {
    const { marcadas } = mockDb({ candidatas: [REPARACION] })
    vi.mocked(queueNotification).mockRejectedValueOnce(new Error("caído"))
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    const body = await (await correr()).json()
    spy.mockRestore()
    expect(body.errores).toBe(1)
    expect(marcadas.has("g-rep")).toBe(false)
  })

  it("no avisa una garantía tan corta como la ventana (nace por vencer)", async () => {
    mockDb({ candidatas: [{ ...REPARACION, dias_validez: 7 }] })
    const body = await (await correr()).json()
    expect(queueNotification).not.toHaveBeenCalled()
    expect(body.omitidos).toBe(1)
  })

  it("no avisa sin cliente o sin un medio de contacto", async () => {
    mockDb({
      candidatas: [{ ...REPARACION, cliente_id: null }, VENTA],
      clientes: [{ id: "cli-2", nombre: "Beto", email: null, telefono: null }],
    })
    const body = await (await correr()).json()
    expect(queueNotification).not.toHaveBeenCalled()
    expect(body.omitidos).toBe(2)
  })

  it("salta las orgs con el aviso apagado, sin canales o fuera de su hora", async () => {
    mockDb({
      orgs: [
        { ...ORG, id: "apagado", garantia_aviso_vencimiento: false },
        { ...ORG, id: "sin-canales", notificaciones_email: false, notificaciones_whatsapp: false },
        { ...ORG, id: "cr", zona_horaria: "America/Costa_Rica" }, // 07:00 allá
      ],
    })
    const body = await (await correr()).json()
    expect(body.orgsProcesadas).toBe(0)
    expect(queueNotification).not.toHaveBeenCalled()
  })

  it("si la 402 no corrió (columna inexistente) no avisa a nadie y no falla", async () => {
    vi.mocked(supabaseAdmin.from).mockImplementation(
      () => createChainMock(null, { code: "42703", message: "column does not exist" }) as any
    )
    const res = await correr()
    expect(res.status).toBe(200)
    expect((await res.json()).enviados).toBe(0)
  })

  it("está registrado en vercel.json y en el panel de cron", () => {
    const vercel = JSON.parse(readFileSync(join(__dirname, "..", "..", "vercel.json"), "utf8"))
    expect(vercel.crons).toContainEqual({ path: "/api/cron/garantias-por-vencer", schedule: "0 * * * *" })
    expect(CRON_JOBS.map((j) => j.path)).toContain("/api/cron/garantias-por-vencer")
  })
})
