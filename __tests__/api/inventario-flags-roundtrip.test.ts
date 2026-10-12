import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createGetRequest,
  createPostRequest,
  parseResponse,
} from "./helpers"

vi.mock("@/lib/webhooks/dispatcher", () => ({
  emitWebhookEvent: vi.fn().mockResolvedValue(undefined),
}))

import { GET, POST } from "@/app/api/inventario/route"
import { PUT } from "@/app/api/inventario/[id]/route"

// Regression: the list endpoint used an explicit column list that omitted the
// per-item flags, so every row reported them as false. The edit form then
// initialised its checkboxes from that row and saved `false` back, wiping the
// real flag ("I turn variants on and it turns itself off").

const FLAG_COLUMNS = [
  "tiene_variantes",
  "trackea_lotes",
  "trackea_series",
  "es_kit",
  "tipo_kit",
  "dias_alerta_vencimiento",
  "dias_garantia_default",
]

const fullRow = {
  id: "inv-1",
  codigo: "C1",
  nombre: "Pantalla",
  descripcion: null,
  categoria: "Repuestos",
  tipo_dispositivo: "CELULAR",
  stock: 10,
  stock_reservado: 0,
  precio_compra: 300,
  precio_venta: 900,
  proveedor: null,
  proveedor_id: null,
  organization_id: "org-1",
  tiene_variantes: true,
  trackea_lotes: true,
  trackea_series: true,
  es_kit: true,
  tipo_kit: "VIRTUAL",
  dias_alerta_vencimiento: 30,
  dias_garantia_default: 90,
}

/** Returns the flag columns only when the SELECT string asked for them. */
function selectAwareChain(row: Record<string, any>) {
  const chain = createChainMock(row, null, 1)
  chain.select.mockImplementation((cols: string) => {
    const requested = new Set(cols.split(",").map((c) => c.trim()))
    const projected: Record<string, any> = {}
    for (const [k, v] of Object.entries(row)) {
      if (!FLAG_COLUMNS.includes(k) || requested.has(k)) projected[k] = v
    }
    const result = { data: [projected], error: null, count: 1 }
    chain.then = (resolve: any, reject?: any) => Promise.resolve(result).then(resolve, reject)
    return chain
  })
  return chain
}

describe("GET /api/inventario — flags survive the list SELECT", () => {
  beforeEach(() => vi.clearAllMocks())

  it("selects every flag column", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const inv = selectAwareChain(fullRow)
    mockSupabaseFrom({ inventario: inv })

    await GET(createGetRequest("http://localhost:3000/api/inventario"))

    const cols = String(inv.select.mock.calls[0][0])
    for (const c of FLAG_COLUMNS) expect(cols).toContain(c)
  })

  it("returns the real flag values, not false-by-omission", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockSupabaseFrom({ inventario: selectAwareChain(fullRow) })

    const res = await GET(createGetRequest("http://localhost:3000/api/inventario"))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body.data[0]).toMatchObject({
      tieneVariantes: true,
      trackeaLotes: true,
      trackeaSeries: true,
      esKit: true,
      tipoKit: "VIRTUAL",
      diasAlertaVencimiento: 30,
      diasGarantiaDefault: 90,
    })
  })
})

describe("POST /api/inventario — flags are persisted on create", () => {
  beforeEach(() => vi.clearAllMocks())

  const baseBody = {
    codigo: "C1",
    nombre: "Pantalla",
    categoria: "Repuestos",
    tipoDispositivo: "CELULAR",
    stock: 5,
    precioCompra: 300,
    precioVenta: 900,
  }

  it("writes the flags sent in the body", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const inv = createChainMock(fullRow)
    mockSupabaseFrom({ inventario: inv })

    const res = await POST(
      createPostRequest({
        ...baseBody,
        tieneVariantes: true,
        trackeaLotes: true,
        trackeaSeries: true,
        esKit: true,
        tipoKit: "ENSAMBLADO",
        diasAlertaVencimiento: 15,
      })
    )

    expect(res.status).toBe(201)
    expect(inv.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        tiene_variantes: true,
        trackea_lotes: true,
        trackea_series: true,
        es_kit: true,
        tipo_kit: "ENSAMBLADO",
        dias_alerta_vencimiento: 15,
      })
    )
  })

  it("does not write flags that were not sent (DB defaults apply)", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const inv = createChainMock(fullRow)
    mockSupabaseFrom({ inventario: inv })

    await POST(createPostRequest(baseBody))

    const payload = inv.insert.mock.calls[0][0]
    for (const k of ["tiene_variantes", "trackea_lotes", "trackea_series", "es_kit", "tipo_kit"]) {
      expect(payload).not.toHaveProperty(k)
    }
  })
})

describe("PUT /api/inventario/[id] — flags", () => {
  beforeEach(() => vi.clearAllMocks())

  const params = { params: Promise.resolve({ id: "inv-1" }) }

  function put(body: Record<string, unknown>) {
    return PUT(
      new Request("http://localhost:3000/api/inventario/inv-1", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      params
    )
  }

  it("does not overwrite flags omitted from the body", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const inv = createChainMock(fullRow)
    mockSupabaseFrom({ inventario: inv })

    const res = await put({ nombre: "Nuevo nombre" })

    expect(res.status).toBe(200)
    const payload = inv.update.mock.calls[0][0]
    expect(payload).toHaveProperty("nombre", "Nuevo nombre")
    for (const k of ["tiene_variantes", "trackea_lotes", "trackea_series", "es_kit", "tipo_kit"]) {
      expect(payload).not.toHaveProperty(k)
    }
  })

  it.each([true, false])("writes tieneVariantes=%s when sent", async (value) => {
    mockAuthSuccess({ role: "ADMIN" })
    const inv = createChainMock(fullRow)
    mockSupabaseFrom({ inventario: inv })

    await put({ tieneVariantes: value })

    expect(inv.update).toHaveBeenCalledWith(expect.objectContaining({ tiene_variantes: value }))
  })
})

// Migration 177: CHECK (es_kit = false OR tipo_kit IS NOT NULL). A kit without
// a tipo must be a 400 validation error, not a 500 from the constraint.
describe("kit without tipo is a 400, not a DB check violation", () => {
  beforeEach(() => vi.clearAllMocks())

  const baseBody = {
    codigo: "C1",
    nombre: "Pantalla",
    categoria: "Repuestos",
    tipoDispositivo: "CELULAR",
    stock: 5,
    precioCompra: 300,
    precioVenta: 900,
  }
  const params = { params: Promise.resolve({ id: "inv-1" }) }
  const put = (body: Record<string, unknown>) =>
    PUT(
      new Request("http://localhost:3000/api/inventario/inv-1", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      params
    )

  it.each([
    ["missing", {}],
    ["null", { tipoKit: null }],
  ])("POST esKit=true with tipoKit %s returns 400 and does not insert", async (_l, extra) => {
    mockAuthSuccess({ role: "ADMIN" })
    const inv = createChainMock(fullRow)
    mockSupabaseFrom({ inventario: inv })

    const res = await POST(createPostRequest({ ...baseBody, esKit: true, ...extra }))
    const { status, body } = await parseResponse(res)

    expect(status).toBe(400)
    expect(body.error).toMatch(/kit/i)
    expect(inv.insert).not.toHaveBeenCalled()
  })

  it("PUT esKit=true with no tipoKit anywhere (row has none) returns 400", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const inv = createChainMock({ ...fullRow, es_kit: false, tipo_kit: null })
    mockSupabaseFrom({ inventario: inv })

    const res = await put({ esKit: true })

    expect(res.status).toBe(400)
    expect(inv.update).not.toHaveBeenCalled()
  })

  it("PUT esKit=true with explicit tipoKit null returns 400 even if row had one", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const inv = createChainMock(fullRow)
    mockSupabaseFrom({ inventario: inv })

    const res = await put({ esKit: true, tipoKit: null })

    expect(res.status).toBe(400)
    expect(inv.update).not.toHaveBeenCalled()
  })

  it("PUT esKit=true without tipoKit is fine when the row already has one", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const inv = createChainMock(fullRow)
    mockSupabaseFrom({ inventario: inv })

    const res = await put({ esKit: true })

    expect(res.status).toBe(200)
  })

  it("PUT tipoKit=null on an existing kit (no esKit sent) returns 400", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const inv = createChainMock(fullRow)
    mockSupabaseFrom({ inventario: inv })

    const res = await put({ tipoKit: null })

    expect(res.status).toBe(400)
    expect(inv.update).not.toHaveBeenCalled()
  })

  it("PUT esKit=false with tipoKit null is allowed", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const inv = createChainMock(fullRow)
    mockSupabaseFrom({ inventario: inv })

    const res = await put({ esKit: false, tipoKit: null })

    expect(res.status).toBe(200)
  })
})
