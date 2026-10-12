// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { supabaseAdmin } from "@/lib/supabase"
import { createChainMock, mockSupabaseFrom } from "../../api/helpers"
import {
  PURGE_BUCKETS, catalogoOrgHash, listAllFiles, removePrefix, storageTargets,
} from "@/lib/account-deletion/storage"

type Entry = { name: string; id: string | null }
/** tree["bucket:dir"] = entradas de esa carpeta (id null = subcarpeta). */
function mockStorage(tree: Record<string, Entry[]>, removeFn = vi.fn().mockResolvedValue({ data: null, error: null })) {
  vi.mocked(supabaseAdmin.storage.from).mockImplementation(((bucket: string) => ({
    list: vi.fn(async (dir: string, opts: { limit: number; offset: number }) => {
      if (tree[`${bucket}:__missing__`]) return { data: null, error: { message: "Bucket not found" } }
      return { data: (tree[`${bucket}:${dir}`] ?? []).slice(opts.offset, opts.offset + opts.limit), error: null }
    }),
    remove: removeFn,
  })) as never)
  return removeFn
}

describe("catalogoOrgHash", () => {
  it("replica la fórmula del upload público (sha256 de orgId:secret, 16 hex)", () => {
    vi.stubEnv("NEXTAUTH_SECRET", "s3cret")
    expect(catalogoOrgHash("org-1")).toBe("628e3d23f8c0494f")
    expect(catalogoOrgHash("org-1")).toHaveLength(16)
  })
})

describe("PURGE_BUCKETS", () => {
  it("incluye proveedor-adjuntos y excluye los APK (no son de la org)", () => {
    expect(PURGE_BUCKETS).toContain("proveedor-adjuntos")
    expect(PURGE_BUCKETS).toContain("fotos-ordenes")
    expect(PURGE_BUCKETS).not.toContain("apk-releases")
  })
})

describe("listAllFiles", () => {
  it("recorre subcarpetas (fotos-ordenes/{org}/{orden}/archivo)", async () => {
    mockStorage({
      "b:org": [{ name: "ord1", id: null }, { name: "logo.png", id: "x" }],
      "b:org/ord1": [{ name: "a.jpg", id: "1" }, { name: "deep", id: null }],
      "b:org/ord1/deep": [{ name: "b.jpg", id: "2" }],
    })
    expect((await listAllFiles("b", "org")).sort()).toEqual(["org/logo.png", "org/ord1/a.jpg", "org/ord1/deep/b.jpg"])
  })

  it("pagina cuando una carpeta tiene más de 1000 entradas", async () => {
    const many = Array.from({ length: 2500 }, (_, i) => ({ name: `f${i}.jpg`, id: String(i) }))
    mockStorage({ "b:org": many })
    expect(await listAllFiles("b", "org")).toHaveLength(2500)
  })
})

describe("removePrefix", () => {
  it("borra en tandas de 100 y devuelve el total", async () => {
    const files = Array.from({ length: 250 }, (_, i) => ({ name: `f${i}`, id: String(i) }))
    const removeFn = mockStorage({ "b:org": files })
    expect(await removePrefix("b", "org")).toBe(250)
    expect(removeFn).toHaveBeenCalledTimes(3)
    expect(removeFn.mock.calls[0][0]).toHaveLength(100)
  })

  it("un bucket inexistente cuenta como vacío (csv-imports se crea de forma lazy)", async () => {
    mockStorage({ "b:__missing__": [] })
    expect(await removePrefix("b", "org")).toBe(0)
  })

  it("si falla el borrado tira, para que el paso quede marcado como fallido", async () => {
    mockStorage({ "b:org": [{ name: "a", id: "1" }] }, vi.fn().mockResolvedValue({ data: null, error: { message: "denied" } }))
    await expect(removePrefix("b", "org")).rejects.toThrow(/denied/)
  })

  it("corta al pasar el deadline (el cron reintenta mañana)", async () => {
    const files = Array.from({ length: 250 }, (_, i) => ({ name: `f${i}`, id: String(i) }))
    mockStorage({ "b:org": files })
    await expect(removePrefix("b", "org", Date.now() - 1)).rejects.toThrow(/deadline/)
  })
})

describe("storageTargets", () => {
  beforeEach(() => vi.stubEnv("NEXTAUTH_SECRET", "s3cret"))

  it("cubre {orgId} en todos los buckets, proveedores/, el hash del catálogo y cada ticket de soporte", async () => {
    mockSupabaseFrom({ support_tickets: createChainMock([{ id: "t1" }, { id: "t2" }], null) })
    const targets = await storageTargets("org-1")
    expect(targets).toContainEqual({ bucket: "fotos-ordenes", prefix: "org-1" })
    expect(targets).toContainEqual({ bucket: "proveedor-adjuntos", prefix: "org-1" })
    expect(targets).toContainEqual({ bucket: "logos", prefix: "proveedores/org-1" })
    expect(targets).toContainEqual({ bucket: "catalogo", prefix: catalogoOrgHash("org-1") })
    expect(targets).toContainEqual({ bucket: "soporte-attachments", prefix: "t1" })
    expect(targets).toContainEqual({ bucket: "soporte-attachments", prefix: "t2" })
  })

  it("si no se pueden leer los tickets tira (no se puede garantizar el barrido)", async () => {
    mockSupabaseFrom({ support_tickets: createChainMock(null, { message: "down" }) })
    await expect(storageTargets("org-1")).rejects.toThrow(/support_tickets/)
  })
})

describe("guardas de prefijo vacío o inseguro", () => {
  it("removePrefix y listAllFiles tiran antes de listar o borrar", async () => {
    const removeFn = mockStorage({})
    vi.mocked(supabaseAdmin.storage.from).mockClear()
    for (const bad of ["", "  ", "/x", "a/../b"]) {
      await expect(removePrefix("b", bad)).rejects.toThrow(/prefijo/)
      await expect(listAllFiles("b", bad)).rejects.toThrow(/prefijo/)
    }
    expect(removeFn).not.toHaveBeenCalled()
    expect(supabaseAdmin.storage.from).not.toHaveBeenCalled()
  })

  it("storageTargets rechaza orgId vacío o en blanco sin consultar nada", async () => {
    mockSupabaseFrom({ support_tickets: createChainMock([], null) })
    await expect(storageTargets("")).rejects.toThrow(/prefijo/)
    await expect(storageTargets("  ")).rejects.toThrow(/prefijo/)
  })

  it("un ticket con id vacío tira", async () => {
    mockSupabaseFrom({ support_tickets: createChainMock([{ id: "" }], null) })
    await expect(storageTargets("org-1")).rejects.toThrow(/prefijo/)
  })
})
