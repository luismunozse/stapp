import { describe, it, expect, beforeEach, vi } from "vitest"
import { NextRequest } from "next/server"
import ExcelJS from "exceljs"
import { supabaseAdmin } from "@/lib/supabase"
import { mockAuthSuccess, mockSupabaseFrom, createChainMock } from "./helpers"

vi.mock("@/lib/subscriptions", () => ({
  hasPlanFeature: vi.fn().mockResolvedValue(true),
}))

import { GET, POST } from "@/app/api/export/[entity]/route"

/**
 * The inventory list already tracks a selection (selectedKeys) but the export
 * only ever sent filters, so "export" meant "export everything that matches
 * the filters". These cover the selection path and the pedido preset.
 *
 * ids arrive from the client, so the org scope has to survive them: an id from
 * another organization must not widen the export (IDOR).
 */

const ROWS = [
  {
    id: "i1",
    codigo: "ABC123",
    nombre: "Pantalla",
    stock: 2,
    stock_minimo: 10,
    punto_reorden: null,
    stock_maximo: null,
    precio_compra: 1000,
    precio_venta: 4000,
    proveedor: null,
    proveedores: { nombre: "Proveedor SA" },
  },
]

function getRequest(query = "") {
  const url = `http://localhost:3000/api/export/inventario${query}`
  return {
    req: new NextRequest(url),
    ctx: { params: Promise.resolve({ entity: "inventario" }) },
  }
}

function postRequest(body: unknown) {
  const url = "http://localhost:3000/api/export/inventario"
  return {
    req: new NextRequest(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    ctx: { params: Promise.resolve({ entity: "inventario" }) },
  }
}

function mockTables(rows: any[] = ROWS) {
  const inventario = createChainMock(rows)
  mockSupabaseFrom({
    inventario,
    organizations: createChainMock({
      umbral_stock_bajo: 5,
      vendedores_administran_inventario: false,
    }),
    sucursales: createChainMock([]),
  })
  return inventario
}

async function readSheet(res: Response): Promise<ExcelJS.Worksheet> {
  const buf = Buffer.from(await res.arrayBuffer())
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf as unknown as Parameters<typeof wb.xlsx.load>[0])
  return wb.worksheets[0]
}

describe("GET /api/export/inventario?ids= — selection filter", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("narrows the export to the selected ids", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const inventario = mockTables()

    const { req, ctx } = getRequest("?ids=i1,i2")
    const res = await GET(req, ctx)

    expect(res.status).toBe(200)
    expect(inventario.in).toHaveBeenCalledWith("id", ["i1", "i2"])
  })

  it("keeps the org scope so a foreign id cannot widen the export", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const inventario = mockTables()

    const { req, ctx } = getRequest("?ids=i1,otra-org")
    await GET(req, ctx)

    expect(inventario.eq).toHaveBeenCalledWith("organization_id", "org-1")
  })

  it("exports everything when no ids are sent (unchanged behaviour)", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const inventario = mockTables()

    const { req, ctx } = getRequest()
    await GET(req, ctx)

    expect(inventario.in).not.toHaveBeenCalled()
  })
})

describe("POST /api/export/inventario — selection without a URL length cap", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("exports the pedido sheet for the posted ids", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    const inventario = mockTables()

    const { req, ctx } = postRequest({
      ids: ["i1"],
      preset: "pedido",
      format: "xlsx",
    })
    const res = await POST(req, ctx)

    expect(res.status).toBe(200)
    expect(inventario.in).toHaveBeenCalledWith("id", ["i1"])

    const ws = await readSheet(res)
    const headers = ws.getRow(1).values as string[]
    expect(headers).toContain("Cantidad a Pedir")
    expect(headers).not.toContain("Precio Venta")
    // umbral 10 -> target 20, stock 2 -> 18 units prefilled
    const cantidadCol = headers.indexOf("Cantidad a Pedir")
    expect(ws.getRow(2).getCell(cantidadCol).value).toBe("18")
  })

  it("names the download pedido_<fecha>.xlsx so it is not mistaken for the inventory dump", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockTables()

    const { req, ctx } = postRequest({
      ids: ["i1"],
      preset: "pedido",
      format: "xlsx",
    })
    const res = await POST(req, ctx)

    expect(res.headers.get("Content-Disposition")).toMatch(
      /filename="pedido_\d{8}\.xlsx"/
    )
  })

  it("rejects an empty selection instead of silently exporting everything", async () => {
    mockAuthSuccess({ role: "ADMIN" })
    mockTables()

    const { req, ctx } = postRequest({ ids: [], preset: "pedido" })
    const res = await POST(req, ctx)

    expect(res.status).toBe(400)
    expect(supabaseAdmin.from).not.toHaveBeenCalledWith("inventario")
  })

  it("drops purchase cost from the pedido sheet for a TECNICO", async () => {
    mockAuthSuccess({ role: "TECNICO" })
    mockTables()

    const { req, ctx } = postRequest({
      ids: ["i1"],
      preset: "pedido",
      format: "xlsx",
    })
    const res = await POST(req, ctx)

    const ws = await readSheet(res)
    const headers = ws.getRow(1).values as string[]
    expect(headers).not.toContain("Precio Compra")
    expect(headers).not.toContain("Subtotal")
    expect(headers).toContain("Cantidad a Pedir")
  })
})
