import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { installPostgrestFake } from "./postgrest-fake"

vi.mock("@/lib/cron-auth", () => ({
  requireCronAuth: vi.fn(() => null),
}))

vi.mock("@/lib/emails/template-resolver", () => ({
  resolveTemplate: vi.fn(async (type: string) => ({
    subject: `asunto ${type}`,
    html: `<p>${type}</p>`,
    source: "hardcoded",
  })),
}))

import { GET } from "@/app/api/cron/lifecycle-emails/route"
import { resolveTemplate } from "@/lib/emails/template-resolver"

const NOW = "2026-10-09T12:00:00.000Z"
const DAY = 24 * 60 * 60 * 1000

const daysAgo = (n: number) => new Date(new Date(NOW).getTime() - n * DAY).toISOString()

const org = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  nombre: `Taller ${id}`,
  slug: id,
  activo: true,
  // Org vieja: no dispara WELCOME / TIP_DAY_*.
  created_at: daysAgo(400),
  notificaciones_whatsapp: false,
  notificaciones_email: false,
  ...extra,
})

const admin = (orgId: string) => ({
  id: `admin-${orgId}`,
  nombre: "Ana",
  email: `ana@${orgId}.test`,
  organization_id: orgId,
  rol: "ADMIN",
})

// Las filas de ordenes_servicio NO tienen created_at: igual que prod.
const orden = (orgId: string, fechaIngreso: string) => ({
  organization_id: orgId,
  fecha_ingreso: fechaIngreso,
})

const ordenes = (orgId: string, n: number, fechaDe: (i: number) => string) =>
  Array.from({ length: n }, (_, i) => orden(orgId, fechaDe(i)))

const request = () => new Request("http://localhost/api/cron/lifecycle-emails")

describe("GET /api/cron/lifecycle-emails: actividad de ordenes", () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW))
    process.env.ENVIALOSIMPLE_API_KEY = "test-key"
    fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal("fetch", fetchMock)
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const tiposResueltos = () => vi.mocked(resolveTemplate).mock.calls.map((c) => c[0])

  it("manda WIN_BACK_7 cuando la ultima orden (por fecha_ingreso) fue hace 7 dias", async () => {
    installPostgrestFake({
      organizations: [org("o1")],
      users: [admin("o1")],
      ordenes_servicio: [orden("o1", daysAgo(7)), orden("o1", daysAgo(90))],
    })

    const res = await GET(request())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.results.winBack7).toBe(1)
    expect(tiposResueltos()).toEqual(["WIN_BACK_7"])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("manda WIN_BACK_30 cuando la ultima orden fue hace 30 dias", async () => {
    installPostgrestFake({
      organizations: [org("o1")],
      users: [admin("o1")],
      ordenes_servicio: [orden("o1", daysAgo(30))],
    })

    const body = await (await GET(request())).json()

    expect(body.results.winBack30).toBe(1)
    expect(tiposResueltos()).toEqual(["WIN_BACK_30"])
  })

  it("no manda win-back a una org con ordenes de ayer", async () => {
    installPostgrestFake({
      organizations: [org("o1")],
      users: [admin("o1")],
      ordenes_servicio: [orden("o1", daysAgo(1))],
    })

    const body = await (await GET(request())).json()

    expect(body.results.winBack7).toBe(0)
    expect(body.results.winBack30).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("manda MILESTONE cuando la orden del umbral se creo hace pocos dias", async () => {
    // 50 ordenes: la numero 50 (la mas nueva) entro hace 2 dias.
    installPostgrestFake({
      organizations: [org("o1")],
      users: [admin("o1")],
      ordenes_servicio: ordenes("o1", 50, (i) => daysAgo(i === 49 ? 2 : 100 + (49 - i))),
    })

    const body = await (await GET(request())).json()

    expect(body.results.milestones).toBe(1)
    expect(tiposResueltos()).toContain("MILESTONE")
  })

  it("no manda MILESTONE si el umbral se cruzo hace meses (backlog)", async () => {
    // 50 ordenes en total, la numero 50 es de hace 168 dias: ya paso la fiesta.
    installPostgrestFake({
      organizations: [org("o1")],
      users: [admin("o1")],
      ordenes_servicio: ordenes("o1", 50, (i) => daysAgo(168 + (49 - i))),
    })

    const body = await (await GET(request())).json()

    expect(body.results.milestones).toBe(0)
    expect(tiposResueltos()).not.toContain("MILESTONE")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("cuenta TODAS las ordenes aunque superen las 1000 filas que devuelve PostgREST", async () => {
    // Y tiene 600 ordenes "recientes" que llenan la primera pagina junto con las
    // ultimas de X. X tiene 502 en total y la 500 es de hace 2 dias.
    const x = ordenes("ox", 502, (i) => (i >= 499 ? daysAgo(2 - (i - 499) * 0.5) : daysAgo(300 + (499 - i))))
    const y = ordenes("oy", 600, (i) => daysAgo(20 + i * 0.01))
    installPostgrestFake({
      organizations: [org("ox"), org("oy")],
      users: [admin("ox"), admin("oy")],
      ordenes_servicio: [...x, ...y],
    })

    const body = await (await GET(request())).json()

    expect(body.results.milestones).toBe(1)
  })

  it("aborta con 500 y no manda ningun mail si falla la consulta de ordenes", async () => {
    const fake = installPostgrestFake(
      {
        // Org de 1 dia: dispararia WELCOME antes de llegar a la consulta de ordenes.
        organizations: [org("o1", { created_at: daysAgo(1) })],
        users: [admin("o1")],
      },
      { failTables: { ordenes_servicio: { code: "42703", message: "column does not exist" } } }
    )

    const res = await GET(request())

    expect(res.status).toBe(500)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(fake.writes.filter((w) => w.table === "lifecycle_emails")).toHaveLength(0)
  })

  it("no consulta columnas inexistentes de ordenes_servicio", async () => {
    const fake = installPostgrestFake({
      organizations: [org("o1")],
      users: [admin("o1")],
      ordenes_servicio: [orden("o1", daysAgo(7))],
    })

    await GET(request())

    const columnas = fake.queries
      .filter((q) => q.table === "ordenes_servicio")
      .flatMap((q) => q.ops)
      .flatMap((o) => o.args.filter((a): a is string => typeof a === "string"))
    expect(columnas.length).toBeGreaterThan(0)
    expect(columnas.join(",")).not.toMatch(/created_at|updated_at/)
    expect(columnas.join(",")).toContain("fecha_ingreso")
  })
})
