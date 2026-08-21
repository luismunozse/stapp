import { describe, it, expect, vi, beforeEach } from "vitest"
import { auth } from "@/lib/auth"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock, createGetRequest, parseResponse } from "./helpers"

const getEntityHistory = vi.fn()
vi.mock("@/lib/audit", () => ({
  getEntityHistory: (...args: unknown[]) => getEntityHistory(...args),
}))

import { GET } from "@/app/api/inventario/[id]/audit/route"

/**
 * /api/inventario/[id]/audit runs behind plain requireAuth() and returned
 * `changes` verbatim. AUDITED_FIELDS includes precio_compra and the PUT logs
 * before/after for it, so a TECNICO opening the "Historial" tab read the
 * current purchase cost straight out of the latest UPDATE — the same number
 * /api/inventario/[id] already refuses that role. CREATE (after) and DELETE
 * (before) snapshots carry it too.
 *
 * The sibling historial-precios route is already gated; this is the same rule.
 */

const LOGS = [
  {
    id: "log-1",
    action: "UPDATE",
    description: "Actualizó inventario",
    changes: {
      before: { precio_compra: 1000, precio_venta: 2000, nombre: "Pantalla" },
      after: { precio_compra: 1500, precio_venta: 2600, nombre: "Pantalla XL" },
    },
    users: { id: "u1", nombre: "Admin", email: "a@a.com" },
    ip_address: "1.2.3.4",
    created_at: "2026-08-20T10:00:00.000Z",
  },
  {
    id: "log-2",
    action: "CREATE",
    description: "Creó inventario",
    changes: {
      after: { precio_compra: 900, precio_venta: 1800, nombre: "Pantalla" },
    },
    users: null,
    ip_address: null,
    created_at: "2026-08-19T10:00:00.000Z",
  },
  {
    id: "log-3",
    action: "DELETE",
    description: "Archivó inventario",
    changes: {
      before: { precio_compra: 1500, precio_venta: 2600, accion: "ARCHIVADO" },
    },
    users: null,
    ip_address: null,
    created_at: "2026-08-18T10:00:00.000Z",
  },
]

function mockVendedor() {
  vi.mocked(auth).mockResolvedValue({
    user: {
      id: "vendedor-1",
      organizationId: "org-1",
      role: "VENDEDOR",
      sucursalId: null,
      email: "v@v.com",
    },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } as any)
}

async function fetchAudit(vendedoresHabilitados = false) {
  mockSupabaseFrom({
    inventario: createChainMock({ id: "i1" }),
    organizations: createChainMock({
      vendedores_administran_inventario: vendedoresHabilitados,
    }),
  })
  getEntityHistory.mockResolvedValue(LOGS)

  const res = await GET(createGetRequest("http://localhost:3000/api/inventario/i1/audit"), {
    params: Promise.resolve({ id: "i1" }),
  })
  return parseResponse(res)
}

describe("GET /api/inventario/[id]/audit — purchase cost follows hasInventarioAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("strips precio_compra from every snapshot for TECNICO", async () => {
    mockAuthSuccess({ role: "TECNICO" })

    const { status, body } = await fetchAudit()

    expect(status).toBe(200)
    const [update, create, remove] = body.data
    expect(update.changes.before).not.toHaveProperty("precio_compra")
    expect(update.changes.after).not.toHaveProperty("precio_compra")
    expect(create.changes.after).not.toHaveProperty("precio_compra")
    expect(remove.changes.before).not.toHaveProperty("precio_compra")

    // Everything that is not cost keeps flowing — the history stays useful.
    expect(update.changes.after.precio_venta).toBe(2600)
    expect(update.changes.before.nombre).toBe("Pantalla")
    expect(remove.changes.before.accion).toBe("ARCHIVADO")
    expect(body.data).toHaveLength(3)
  })

  it("strips precio_compra for VENDEDOR without the org opt-in", async () => {
    mockVendedor()

    const { status, body } = await fetchAudit(false)

    expect(status).toBe(200)
    expect(body.data[0].changes.after).not.toHaveProperty("precio_compra")
    expect(body.data[0].changes.after.precio_venta).toBe(2600)
  })

  it("keeps precio_compra for VENDEDOR when the org opted in", async () => {
    mockVendedor()

    const { status, body } = await fetchAudit(true)

    expect(status).toBe(200)
    expect(body.data[0].changes.after.precio_compra).toBe(1500)
    expect(body.data[0].changes.before.precio_compra).toBe(1000)
  })

  it("keeps precio_compra for ADMIN", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    const { status, body } = await fetchAudit()

    expect(status).toBe(200)
    expect(body.data[0].changes.after.precio_compra).toBe(1500)
    expect(body.data[1].changes.after.precio_compra).toBe(900)
    expect(body.data[2].changes.before.precio_compra).toBe(1500)
  })
})
