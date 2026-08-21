import { describe, it, expect, vi, beforeEach } from "vitest"
import { auth } from "@/lib/auth"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock, createGetRequest, parseResponse } from "./helpers"

const getEntityHistory = vi.fn()
// generateDescription queda REAL a propósito: la ruta la usa para reescribir la
// descripción sobre el diff ya filtrado, y estos tests verifican ese texto.
vi.mock("@/lib/audit", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/audit")>()
  return {
    ...actual,
    getEntityHistory: (...args: unknown[]) => getEntityHistory(...args),
  }
})

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

/**
 * `changes` iba filtrado pero `description` viajaba tal cual, y
 * generateDescription empuja el label del campo para los campos numéricos. Un
 * UPDATE que tocó SOLO el costo quedaba guardado como "Cambió precio_compra en
 * producto #ab12cd", y audit-historial.tsx pinta log.description sin condición:
 * el guard de fieldsChanged.length solo esconde las filas del diff, no la
 * entrada. El rol sin acceso terminaba leyendo una fila que anunciaba que el
 * precio de compra cambió, con el diff vacío abajo.
 *
 * No se filtraba ningún valor, pero sí se delataba la edición del costo, y el
 * comentario de la ruta afirmaba lo contrario.
 */

const MIXED_LOGS = [
  {
    id: "log-solo-costo",
    action: "UPDATE",
    description: "Cambió precio_compra en producto #0000i1",
    changes: {
      before: { precio_compra: 1000 },
      after: { precio_compra: 1500 },
    },
    users: null,
    ip_address: null,
    created_at: "2026-08-20T10:00:00.000Z",
  },
  {
    id: "log-mixto",
    action: "UPDATE",
    description: "Cambió nombre y precio_compra en producto #0000i1",
    changes: {
      before: { nombre: "Pantalla", precio_compra: 1000 },
      after: { nombre: "Pantalla XL", precio_compra: 1500 },
    },
    users: null,
    ip_address: null,
    created_at: "2026-08-19T10:00:00.000Z",
  },
  {
    id: "log-create",
    action: "CREATE",
    description: 'Creó producto "Pantalla" #0000i1',
    changes: { after: { nombre: "Pantalla", precio_compra: 900 } },
    users: null,
    ip_address: null,
    created_at: "2026-08-18T10:00:00.000Z",
  },
]

async function fetchMixedAudit() {
  mockSupabaseFrom({
    inventario: createChainMock({ id: "i1" }),
    organizations: createChainMock({ vendedores_administran_inventario: false }),
  })
  getEntityHistory.mockResolvedValue(MIXED_LOGS)

  const res = await GET(createGetRequest("http://localhost:3000/api/inventario/i1/audit"), {
    params: Promise.resolve({ id: "i1" }),
  })
  return parseResponse(res)
}

describe("GET /api/inventario/[id]/audit — description does not leak the cost edit", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("drops the entry when the UPDATE touched only the cost", async () => {
    mockAuthSuccess({ role: "TECNICO" })

    const { status, body } = await fetchMixedAudit()

    expect(status).toBe(200)
    expect(body.data.map((l: any) => l.id)).not.toContain("log-solo-costo")
    expect(body.data).toHaveLength(2)
  })

  it("rewrites the description of a mixed UPDATE so it does not name the cost field", async () => {
    mockAuthSuccess({ role: "TECNICO" })

    const { body } = await fetchMixedAudit()

    const mixto = body.data.find((l: any) => l.id === "log-mixto")
    expect(mixto.description).not.toMatch(/precio_compra/)
    // El campo que sí puede ver sigue nombrado: el historial no pierde sentido.
    expect(mixto.description).toContain("nombre")
    expect(Object.keys(mixto.changes.after)).toEqual(["nombre"])
  })

  it("leaves CREATE and DELETE descriptions alone — they name the item, not fields", async () => {
    mockAuthSuccess({ role: "TECNICO" })

    const { body } = await fetchMixedAudit()

    const create = body.data.find((l: any) => l.id === "log-create")
    expect(create.description).toBe('Creó producto "Pantalla" #0000i1')
    expect(create.changes.after).not.toHaveProperty("precio_compra")
  })

  it("ADMIN keeps every entry and every original description", async () => {
    mockAuthSuccess({ role: "ADMIN" })

    const { body } = await fetchMixedAudit()

    expect(body.data).toHaveLength(3)
    expect(body.data[0].description).toBe("Cambió precio_compra en producto #0000i1")
    expect(body.data[1].description).toBe("Cambió nombre y precio_compra en producto #0000i1")
  })
})
