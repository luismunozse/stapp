// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { auth } from "@/lib/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { mockAuthSuccess, mockAuthError, mockSupabaseFrom, createChainMock } from "./helpers"

vi.mock("@/lib/account-deletion/export-organization", () => ({
  buildOrganizationExportStream: vi.fn(
    () =>
      new ReadableStream({
        start(c) {
          c.enqueue(new Uint8Array([0x50, 0x4b, 5, 6]))
          c.close()
        },
      })
  ),
}))
import { buildOrganizationExportStream } from "@/lib/account-deletion/export-organization"
import { GET, maxDuration, dynamic, runtime } from "@/app/api/account/export/route"

const ORG = { id: "o1", nombre: "Taller Uno", slug: "taller-uno" }

function setup(org: Record<string, unknown> | null = ORG, auditError: unknown = null) {
  const audit = createChainMock(null, auditError)
  mockSupabaseFrom({ organizations: createChainMock(org, null), audit_logs: audit })
  return { audit }
}

describe("GET /api/account/export", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  it("configura 60 s, dinámica y runtime node", () => {
    expect(maxDuration).toBe(60)
    expect(dynamic).toBe("force-dynamic")
    expect(runtime).toBe("nodejs")
  })

  it("sin sesión: 401 sin tocar la DB", async () => {
    mockAuthError()
    expect((await GET()).status).toBe(401)
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it.each(["TECNICO", "VENDEDOR"])("un %s recibe 403 y no se arma nada", async (role) => {
    mockAuthSuccess({ organizationId: "o1", role })
    setup()
    expect((await GET()).status).toBe(403)
    expect(buildOrganizationExportStream).not.toHaveBeenCalled()
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it.each([{ isSuperadmin: true }, { isImpersonating: true }])("sesión %o: 403 sin armar nada", async (flag) => {
    vi.mocked(auth).mockResolvedValue({
      user: { id: "u1", organizationId: "o1", role: "ADMIN", email: "test@test.com", ...flag },
      expires: new Date(Date.now() + 86400000).toISOString(),
    } as never)
    setup()
    expect((await GET()).status).toBe(403)
    expect(buildOrganizationExportStream).not.toHaveBeenCalled()
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it("taller inexistente: 404 JSON", async () => {
    mockAuthSuccess({ organizationId: "o1", role: "ADMIN" })
    setup(null)
    const res = await GET()
    expect(res.status).toBe(404)
    expect(res.headers.get("content-type")).toContain("application/json")
    expect(buildOrganizationExportStream).not.toHaveBeenCalled()
  })

  it("un ADMIN recibe el ZIP con nombre de archivo del taller y sin caché", async () => {
    mockAuthSuccess({ organizationId: "o1", role: "ADMIN" })
    const { audit } = setup()
    const res = await GET()
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("application/zip")
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(res.headers.get("content-disposition")).toMatch(
      /^attachment; filename="respaldo-taller-uno-\d{4}-\d{2}-\d{2}\.zip"$/
    )
    expect(new Uint8Array(await res.arrayBuffer())[0]).toBe(0x50)
    expect(buildOrganizationExportStream).toHaveBeenCalledWith(ORG)
    expect(audit.insert).toHaveBeenCalledWith(
      expect.objectContaining({ organization_id: "o1", action: "EXPORT", entity: "organizations", entity_id: "o1" })
    )
  })

  it("sanea el slug en el nombre de archivo (sin comillas, CRLF ni separadores)", async () => {
    mockAuthSuccess({ organizationId: "o1", role: "ADMIN" })
    setup({ ...ORG, slug: 'ta"ller\r\n/../x' })
    const cd = (await GET()).headers.get("content-disposition")!
    expect(cd).toMatch(/^attachment; filename="respaldo-[a-z0-9-]+-\d{4}-\d{2}-\d{2}\.zip"$/)
    expect(cd).not.toMatch(/[\r\n/\\]/)
  })

  it("si falla el audit_logs igual entrega el ZIP", async () => {
    mockAuthSuccess({ organizationId: "o1", role: "ADMIN" })
    setup(ORG, { message: "boom" })
    expect((await GET()).status).toBe(200)
  })
})
