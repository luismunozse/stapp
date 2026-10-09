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

// Org Free que ya recibio el aviso hace 20 dias (gracia de 14): candidata a archivar.
const warnedOrg = (id: string) => ({
  id,
  nombre: `Taller ${id}`,
  slug: id,
  email: `${id}@test.local`,
  activo: true,
  deleted_at: null,
  archival_warned_at: daysAgo(20),
})

const request = () => new Request("http://localhost/api/cron/auto-archive-dormant")

async function loadRoute(enabled: boolean) {
  // ENABLED se lee al importar el modulo.
  vi.resetModules()
  if (enabled) process.env.AUTO_ARCHIVE_DORMANT_ENABLED = "true"
  else delete process.env.AUTO_ARCHIVE_DORMANT_ENABLED
  return (await import("@/app/api/cron/auto-archive-dormant/route")).GET
}

describe("GET /api/cron/auto-archive-dormant: actividad de ordenes", () => {
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

  it("NO archiva una org avisada que cargo una orden hace 5 dias (fecha_ingreso)", async () => {
    const fake = installPostgrestFake({
      organizations: [warnedOrg("o1")],
      ordenes_servicio: [{ organization_id: "o1", fecha_ingreso: daysAgo(5) }],
    })
    const GET = await loadRoute(true)

    const body = await (await GET(request())).json()

    expect(body.results.archived).toBe(0)
    expect(body.results.reprieved).toBe(1)
    expect(fake.writes.some((w) => w.table === "organizations" && JSON.stringify(w.payload).includes("deleted_at"))).toBe(false)
  })

  it("archiva una org avisada sin ninguna actividad en 90 dias", async () => {
    const fake = installPostgrestFake({
      organizations: [warnedOrg("o1")],
      ordenes_servicio: [{ organization_id: "o1", fecha_ingreso: daysAgo(200) }],
    })
    const GET = await loadRoute(true)

    const body = await (await GET(request())).json()

    expect(body.results.reprieved).toBe(0)
    expect(fake.writes.some((w) => w.table === "organizations" && JSON.stringify(w.payload).includes("deleted_at"))).toBe(true)
  })

  it("no consulta columnas inexistentes de ordenes_servicio", async () => {
    const fake = installPostgrestFake({ organizations: [warnedOrg("o1")] })
    const GET = await loadRoute(false)

    await GET(request())

    const args = fake.queries
      .filter((q) => q.table === "ordenes_servicio")
      .flatMap((q) => q.ops)
      .flatMap((o) => o.args.filter((a): a is string => typeof a === "string"))
    expect(args.join(",")).not.toMatch(/created_at|updated_at/)
    expect(args.join(",")).toContain("fecha_ingreso")
  })

  it.each(["subscription_payments", "ordenes_servicio", "ventas", "clientes", "audit_logs"])(
    "aborta con 500 y no escribe nada si falla la consulta de %s (nunca archivar sin datos)",
    async (tabla) => {
      const fake = installPostgrestFake(
        { organizations: [warnedOrg("o1")] },
        { failTables: { [tabla]: { code: "42703", message: "column does not exist" } } }
      )
      const GET = await loadRoute(true)

      const res = await GET(request())

      expect(res.status).toBe(500)
      expect(fake.writes).toHaveLength(0)
    }
  )
})
