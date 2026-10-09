// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
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
vi.mock("@/lib/sucursal", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sucursal")>()),
  sucursalParaLectura: vi.fn().mockResolvedValue({ verTodas: true, sucursalId: null }),
}))

import { sucursalParaLectura } from "@/lib/sucursal"
import { POST } from "@/app/api/import/execute/route"

const csv = "codigo,nombre,precioVenta,stock\nA1,Pantalla,100,3\nA2,Funda,50,0\n"

function post() {
  return POST(
    createPostRequest({
      file: Buffer.from(csv, "utf-8").toString("base64"),
      mime: "text/csv",
      filename: "items.csv",
      entityType: "INVENTARIO",
    })
  )
}

function setup(opts: { detalleError?: { message: string } | null } = {}) {
  const inventario = createChainMock([]) // dedup contra la DB: nada existente
  // El insert devuelve las filas creadas (id + stock) para poder moverlas.
  inventario.insert.mockImplementation(() =>
    createChainMock([
      { id: "inv-1", stock: 3 },
      { id: "inv-2", stock: 0 },
    ])
  )
  const depositos = createChainMock({ id: "dep-b" })
  const detalle = createChainMock([{ id: "det" }], opts.detalleError ?? null)
  mockSupabaseFrom({
    organizations: createChainMock({ vendedores_administran_inventario: true }),
    inventario,
    depositos,
    inventario_depositos: detalle,
    importaciones: createChainMock({ id: "imp-1" }),
  })
  vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: "dep-principal", error: null } as any)
  return { depositos, detalle }
}

describe("POST /api/import/execute (INVENTARIO) — depósito por defecto", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(sucursalParaLectura).mockResolvedValue({ verTodas: true, sucursalId: null })
  })

  it("VENDEDOR de la sucursal B: mueve las filas sembradas con stock al depósito de B en un solo UPDATE", async () => {
    mockAuthSuccess({ role: "VENDEDOR", organizationId: "org-1", sucursalId: "suc-b" })
    vi.mocked(sucursalParaLectura).mockResolvedValue({ verTodas: false, sucursalId: "suc-b" })
    const { detalle } = setup()
    const { status, body } = await parseResponse(await post())

    expect(status).toBe(200)
    expect(body.results.success).toBe(2)
    expect(body.results.advertencia).toBeUndefined()
    expect(detalle.update).toHaveBeenCalledTimes(1)
    expect(detalle.update).toHaveBeenCalledWith({ deposito_id: "dep-b" })
    expect(detalle.in).toHaveBeenCalledWith("inventario_id", ["inv-1"])
    expect(detalle.eq).toHaveBeenCalledWith("deposito_id", "dep-principal")
    expect(detalle.eq).toHaveBeenCalledWith("organization_id", "org-1")
  })

  it("ADMIN viendo todas: no mueve nada", async () => {
    mockAuthSuccess({ role: "ADMIN", organizationId: "org-1" })
    const { detalle, depositos } = setup()
    const { status } = await parseResponse(await post())

    expect(status).toBe(200)
    expect(depositos.select).not.toHaveBeenCalled()
    expect(detalle.update).not.toHaveBeenCalled()
  })

  it("si el movimiento falla, los items quedan importados y se informa una advertencia", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    mockAuthSuccess({ role: "VENDEDOR", organizationId: "org-1", sucursalId: "suc-b" })
    vi.mocked(sucursalParaLectura).mockResolvedValue({ verTodas: false, sucursalId: "suc-b" })
    setup({ detalleError: { message: "boom" } })
    const { status, body } = await parseResponse(await post())

    expect(status).toBe(200)
    expect(body.results.success).toBe(2)
    expect(body.results.advertencia).toBe("El stock quedó en el depósito principal")
  })
})
