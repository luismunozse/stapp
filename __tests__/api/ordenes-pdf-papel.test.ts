/**
 * Paper size of the order PDF, as the routes decide it.
 *
 * GET /api/ordenes/[id]/pdf prints on the organization's default size (organizations.orden_formato_papel)
 * unless the request names another one for THIS print (?papel=A4|A5|A6). The column is added by a
 * migration applied by hand after the deploy, so the route reads the organization through `organizations (*)`:
 * a database without the column leaves the key undefined and the order prints on A4.
 *
 * generateOrdenPDF is mocked (the drawing has its own tests); what is pinned here is the size that reaches it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import { mockAuthSuccess, createChainMock, createGetRequest } from "./helpers"

vi.mock("@/lib/pdf", () => ({
  generateOrdenPDF: vi.fn().mockResolvedValue(Buffer.from("fake-pdf")),
}))
vi.mock("@/lib/terminologia-server", () => ({
  getTerminologia: vi.fn().mockResolvedValue(null),
}))

import { GET as GET_PDF } from "@/app/api/ordenes/[id]/pdf/route"
import { GET as GET_PUBLIC_PDF } from "@/app/api/public/ordenes/[token]/pdf/route"
import { generateOrdenPDF } from "@/lib/pdf"

const baseOrden = (organizations: Record<string, unknown>) => ({
  id: "ord-1",
  numero_orden: 7,
  organization_id: "org-1",
  dispositivo: "iPhone 13",
  tipo_dispositivo: "CELULAR",
  problema_reportado: "No enciende",
  fecha_ingreso: "2026-01-01T00:00:00.000Z",
  estado: "RECIBIDO",
  public_token: "tok-1",
  clientes: { id: "cli-1", nombre: "Juan", telefono: "1122334455" },
  organizations,
  tipos_dispositivo: { nombre: "Celular", config: null },
})

function mockTables(organizations: Record<string, unknown>) {
  const ordenes = createChainMock(baseOrden(organizations), null)
  vi.mocked(supabaseAdmin.from).mockImplementation(((table: string) => {
    if (table === "ordenes_servicio") return ordenes
    return createChainMock([], null)
  }) as any)
  return ordenes
}

const call = (query = "") =>
  GET_PDF(createGetRequest(`http://localhost:3000/api/ordenes/ord-1/pdf${query}`), { params: Promise.resolve({ id: "ord-1" }) })

const sentSize = () => (vi.mocked(generateOrdenPDF).mock.calls[0][0] as any).paperSize

describe("GET /api/ordenes/[id]/pdf: paper size", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthSuccess()
  })

  it("prints on the organization's default size", async () => {
    for (const size of ["A4", "A5", "A6"]) {
      vi.mocked(generateOrdenPDF).mockClear()
      mockTables({ nombre: "Taller", orden_formato_papel: size })
      expect((await call()).status).toBe(200)
      expect(sentSize()).toBe(size)
    }
  })

  it("the size asked for this print wins over the default, in both directions", async () => {
    mockTables({ nombre: "Taller", orden_formato_papel: "A6" })
    await call("?papel=A4")
    expect(sentSize()).toBe("A4")

    vi.mocked(generateOrdenPDF).mockClear()
    mockTables({ nombre: "Taller", orden_formato_papel: "A4" })
    await call("?papel=A5")
    expect(sentSize()).toBe("A5")
  })

  it("accepts the size in lowercase", async () => {
    mockTables({ nombre: "Taller", orden_formato_papel: "A4" })
    await call("?papel=a6")
    expect(sentSize()).toBe("A6")
  })

  it("ignores a size it does not know and falls back to the default (never an error, never a strange page)", async () => {
    for (const bad of ["?papel=A3", "?papel=", "?papel=carta", "?papel=A6%20A5"]) {
      vi.mocked(generateOrdenPDF).mockClear()
      mockTables({ nombre: "Taller", orden_formato_papel: "A5" })
      expect((await call(bad)).status).toBe(200)
      expect(sentSize()).toBe("A5")
    }
  })

  it("prints on A4 when the column does not exist yet (the organization row has no such key)", async () => {
    mockTables({ nombre: "Taller" })
    expect((await call()).status).toBe(200)
    expect(sentSize()).toBe("A4")
  })

  it("prints on A4 when the stored value is NULL or garbage", async () => {
    for (const stored of [null, "", "A3", 6]) {
      vi.mocked(generateOrdenPDF).mockClear()
      mockTables({ nombre: "Taller", orden_formato_papel: stored })
      await call()
      expect(sentSize()).toBe("A4")
    }
  })

  it("keeps reading the organization through organizations (*): naming the column in the select would break the route before the migration", async () => {
    const ordenes = mockTables({ nombre: "Taller", orden_formato_papel: "A6" })
    await call()
    const select = String(ordenes.select.mock.calls[0][0])
    expect(select).toContain("organizations (*)")
    expect(select).not.toContain("orden_formato_papel")
  })

  it("keeps the file name and the content type", async () => {
    mockTables({ nombre: "Taller", orden_formato_papel: "A6" })
    const res = await call()
    expect(res.headers.get("Content-Type")).toBe("application/pdf")
    expect(res.headers.get("Content-Disposition")).toBe('inline; filename="orden-7.pdf"')
  })
})

describe("GET /api/public/ordenes/[token]/pdf: the public link", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("is the customer copy sent by WhatsApp, not a print: it does not take the workshop's print size", async () => {
    const token = "a".repeat(32) // the public token has a fixed shape
    const ordenes = createChainMock({ ...baseOrden({ nombre: "Taller", orden_formato_papel: "A6" }), public_token: token, public_token_expires_at: null }, null)
    vi.mocked(supabaseAdmin.from).mockImplementation(((table: string) =>
      table === "ordenes_servicio" ? ordenes : createChainMock([], null)) as any)
    const res = await GET_PUBLIC_PDF(createGetRequest(`http://localhost:3000/api/public/ordenes/${token}/pdf?papel=A6`), {
      params: Promise.resolve({ token }),
    })
    expect(res.status).toBe(200)
    expect((vi.mocked(generateOrdenPDF).mock.calls[0][0] as any).paperSize).toBeUndefined()
  })
})
