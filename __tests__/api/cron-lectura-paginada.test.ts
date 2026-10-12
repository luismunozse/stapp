import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { installPostgrestFake } from "./postgrest-fake"

vi.mock("@/lib/cron-auth", () => ({
  requireCronAuth: vi.fn(() => null),
}))

vi.mock("@/lib/emails/template-resolver", () => ({
  resolveTemplate: vi.fn(async () => null),
}))

const NOW = "2026-10-09T12:00:00.000Z"
const daysAgo = (n: number) => new Date(new Date(NOW).getTime() - n * 86_400_000).toISOString()

// PostgREST corta en 1000 filas SIN error. Org "relleno" ocupa las primeras 1050
// filas (por id) y la unica actividad de "pasada" es la fila 1051: una lectura sin
// paginar no la ve y la org parece inactiva.
const pad = (n: number, i: number) => `${String(i).padStart(5, "0")}`.slice(-5) + `-${n}`
const relleno = (extra: Record<string, unknown>) =>
  Array.from({ length: 1050 }, (_, i) => ({ id: `a${pad(0, i)}`, organization_id: "relleno", ...extra }))
const pasada = (extra: Record<string, unknown>) => ({ id: "z00000", organization_id: "pasada", ...extra })

const request = (name: string) => new Request(`http://localhost/api/cron/${name}`)

describe("crons: lectura de actividad pasado el tope de 1000 filas", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW))
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    delete process.env.AUTO_ARCHIVE_DORMANT_ENABLED
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("re-engagement: una org cuya unica actividad esta pasada la fila 1000 cuenta como activa", async () => {
    installPostgrestFake({
      organizations: ["relleno", "pasada"].map((id) => ({ id, nombre: id, slug: id, email: `${id}@t.local`, activo: true })),
      ordenes_servicio: [...relleno({ fecha_ingreso: daysAgo(1) }), pasada({ fecha_ingreso: daysAgo(1) })],
    })
    const { GET } = await import("@/app/api/cron/re-engagement/route")

    const body = await (await GET(request("re-engagement"))).json()

    expect(body.results.skippedActive).toBe(2)
  })

  it("auto-archive-dormant: no archiva una org avisada cuya actividad de ordenes esta pasada la fila 1000", async () => {
    process.env.AUTO_ARCHIVE_DORMANT_ENABLED = "true"
    vi.resetModules()
    const warned = (id: string) => ({
      id, nombre: id, slug: id, email: `${id}@t.local`, activo: true, deleted_at: null, archival_warned_at: daysAgo(20),
    })
    const fake = installPostgrestFake({
      organizations: [warned("relleno"), warned("pasada")],
      ordenes_servicio: [...relleno({ fecha_ingreso: daysAgo(1) }), pasada({ fecha_ingreso: daysAgo(1) })],
    })
    const { GET } = await import("@/app/api/cron/auto-archive-dormant/route")

    const body = await (await GET(request("auto-archive-dormant"))).json()

    expect(body.results.archived).toBe(0)
    expect(body.results.reprieved).toBe(2)
    expect(fake.writes.some((w) => JSON.stringify(w.payload).includes("deleted_at"))).toBe(false)
  })

  it("auto-archive-dormant: detecta actividad en audit_logs pasada la fila 1000", async () => {
    process.env.AUTO_ARCHIVE_DORMANT_ENABLED = "true"
    vi.resetModules()
    const warned = (id: string) => ({
      id, nombre: id, slug: id, email: `${id}@t.local`, activo: true, deleted_at: null, archival_warned_at: daysAgo(20),
    })
    const fake = installPostgrestFake({
      organizations: [warned("relleno"), warned("pasada")],
      audit_logs: [...relleno({ created_at: daysAgo(1) }), pasada({ created_at: daysAgo(1) })],
    })
    const { GET } = await import("@/app/api/cron/auto-archive-dormant/route")

    const body = await (await GET(request("auto-archive-dormant"))).json()

    expect(body.results.archived).toBe(0)
    expect(body.results.reprieved).toBe(2)
    expect(fake.writes.some((w) => JSON.stringify(w.payload).includes("deleted_at"))).toBe(false)
  })

  it("trial-management: lee todas las paginas de actividad de ordenes", async () => {
    const sub = (orgId: string) => ({
      id: `sub-${orgId}`, organization_id: orgId, status: "TRIALING", trial_end: daysAgo(1),
      organizations: { id: orgId, nombre: orgId, slug: orgId, activo: true },
    })
    const fake = installPostgrestFake({
      subscriptions: [sub("relleno"), sub("pasada")],
      ordenes_servicio: [...relleno({ fecha_ingreso: daysAgo(1) }), pasada({ fecha_ingreso: daysAgo(1) })],
    })
    const { GET } = await import("@/app/api/cron/trial-management/route")

    await GET(request("trial-management"))

    const paginas = fake.queries
      .filter((q) => q.table === "ordenes_servicio")
      .flatMap((q) => q.ops.filter((o) => o.op === "range"))
    expect(paginas.length).toBeGreaterThanOrEqual(2)
  })
})
