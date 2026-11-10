// @vitest-environment node
/**
 * Execute side of the "CSV import errors" fix: Argentine numbers are stored
 * correctly (1.500 -> 1500, not 1.5) and error rows carry the spreadsheet line
 * number plus a message that is not prefixed twice ("Fila 4: Fila 4: ...").
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  mockAuthSuccess,
  createChainMock,
  mockSupabaseFrom,
  createPostRequest,
  parseResponse,
} from "./helpers"

vi.mock("@/lib/subscriptions", () => ({
  hasPlanFeature: vi.fn().mockResolvedValue(true),
  checkPlanLimit: vi.fn().mockResolvedValue({ allowed: true }),
}))
vi.mock("@/lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage")>()),
  uploadImportFile: vi.fn().mockResolvedValue({ path: "imports/x.csv" }),
}))
vi.mock("@/lib/plan-limits", () => ({
  enforcePlanLimit: vi.fn().mockResolvedValue(null),
}))

import { POST } from "@/app/api/import/execute/route"

function post(csv: string, entityType: "INVENTARIO" | "CLIENTES") {
  return POST(
    createPostRequest({
      file: Buffer.from(csv, "utf-8").toString("base64"),
      mime: "text/csv",
      filename: "datos.csv",
      entityType,
    }),
  )
}

describe("POST /api/import/execute — numbers and row numbers", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
  })

  it("stores 1.500 as 1500 and 12.000 as 12000 (semicolon CSV)", async () => {
    const inventario = createChainMock([])
    inventario.insert.mockImplementation(() => createChainMock([{ id: "i1", stock: 0 }]))
    mockSupabaseFrom({
      organizations: createChainMock({ vendedores_administran_inventario: true }),
      inventario,
      importaciones: createChainMock({ id: "imp-1" }),
    })

    const { status, body } = await parseResponse(
      await post("nombre;stock;precioVenta\nFunda;0;1.500,50\nVidrio;0;12.000\n", "INVENTARIO"),
    )

    expect(status).toBe(200)
    expect(body.results.errors).toBe(0)
    const payloads = inventario.insert.mock.calls[0][0] as Array<{ precio_venta: number }>
    expect(payloads.map((p) => p.precio_venta)).toEqual([1500.5, 12000])
  })

  it("reports bad rows with the spreadsheet line and a single 'Fila' prefix", async () => {
    const inventario = createChainMock([])
    inventario.insert.mockImplementation(() => createChainMock([{ id: "i1", stock: 0 }]))
    mockSupabaseFrom({
      organizations: createChainMock({ vendedores_administran_inventario: true }),
      inventario,
      importaciones: createChainMock({ id: "imp-1" }),
    })

    const csv = [
      "nombre,stock,precioVenta",
      "Funda,0,1500", // 2 ok
      "", // 3 blank
      "Vidrio,0,1500,50", // 4 unquoted decimal comma
      "Cable,0,1.5.0", // 5 invalid price
    ].join("\n")
    const { status, body } = await parseResponse(await post(csv, "INVENTARIO"))

    expect(status).toBe(200)
    expect(body.results.success).toBe(1)
    expect(body.results.errors).toBe(2)
    const [r4, r5] = body.results.errorDetails
    expect(r4.row).toBe(4)
    expect(r4.error).toContain("más columnas")
    expect(r4.error).not.toMatch(/^Fila/)
    expect(r5.row).toBe(5)
    expect(r5.column).toBe("precioVenta")
    expect(r5.error).toContain('"1.5.0"')
  })

  it("imports CLIENTES keeping the leading zero of telefono and dni", async () => {
    const clientes = createChainMock([])
    mockSupabaseFrom({
      organizations: createChainMock({}),
      clientes,
      importaciones: createChainMock({ id: "imp-1" }),
    })

    const { status, body } = await parseResponse(
      await post("nombre,telefono,dni\nJuan,0111234567,00123456\n", "CLIENTES"),
    )

    expect(status).toBe(200)
    expect(body.results.success).toBe(1)
    const payload = clientes.insert.mock.calls[0][0] as Array<{ telefono: string; dni: string }>
    expect(payload[0].telefono).toBe("0111234567")
    expect(payload[0].dni).toBe("00123456")
  })
})
