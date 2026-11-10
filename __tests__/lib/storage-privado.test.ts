// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

const { createSignedUrls, from } = vi.hoisted(() => {
  const createSignedUrls = vi.fn()
  const from = vi.fn(() => ({ createSignedUrls }))
  return { createSignedUrls, from }
})

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: { storage: { from } },
  STORAGE_BUCKETS: {
    FOTOS_ORDENES: "fotos-ordenes",
    FIRMAS: "firmas",
    SOPORTE_ATTACHMENTS: "soporte-attachments",
    COMPROBANTES_GASTOS: "comprobantes-gastos",
  },
}))

import {
  pathDesdeReferencia,
  firmarReferencias,
  firmarReferencia,
  firmarCampo,
  VIGENCIA_URL_FIRMADA_SEG,
} from "@/lib/storage-privado"

const BASE = "https://abc.supabase.co/storage/v1/object"

function firmarEco() {
  createSignedUrls.mockImplementation(async (paths: string[]) => ({
    data: paths.map((p) => ({ path: p, signedUrl: `${BASE}/sign/x/${p}?token=t`, error: null })),
    error: null,
  }))
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("pathDesdeReferencia", () => {
  it("acepta un path pelado", () => {
    expect(pathDesdeReferencia("FOTOS_ORDENES", "org1/ord1/a.jpg")).toBe("org1/ord1/a.jpg")
    expect(pathDesdeReferencia("FOTOS_ORDENES", "/org1/ord1/a.jpg")).toBe("org1/ord1/a.jpg")
  })

  it("extrae el path de una URL pública guardada del mismo bucket", () => {
    expect(
      pathDesdeReferencia("FOTOS_ORDENES", `${BASE}/public/fotos-ordenes/org1/ord1/a.jpg`)
    ).toBe("org1/ord1/a.jpg")
  })

  it("extrae el path de una URL firmada y descarta el token", () => {
    expect(
      pathDesdeReferencia("COMPROBANTES_GASTOS", `${BASE}/sign/comprobantes-gastos/org1/x%20y.pdf?token=abc`)
    ).toBe("org1/x y.pdf")
  })

  it("rechaza URLs de otro bucket, de otro sitio o vacías", () => {
    expect(pathDesdeReferencia("FIRMAS", `${BASE}/public/fotos-ordenes/org1/a.png`)).toBeNull()
    expect(pathDesdeReferencia("FIRMAS", "https://example.com/firmas/org1/a.png")).toBeNull()
    expect(pathDesdeReferencia("FIRMAS", "")).toBeNull()
    expect(pathDesdeReferencia("FIRMAS", null)).toBeNull()
    expect(pathDesdeReferencia("FIRMAS", undefined)).toBeNull()
  })

  it("rechaza paths con segmentos relativos", () => {
    expect(pathDesdeReferencia("FOTOS_ORDENES", "org1/../org2/a.jpg")).toBeNull()
    expect(pathDesdeReferencia("FOTOS_ORDENES", `${BASE}/public/fotos-ordenes/org1%2F..%2Forg2/a.jpg`)).toBeNull()
  })
})

describe("firmarReferencias", () => {
  it("firma en una sola llamada al bucket correcto con la vigencia por defecto", async () => {
    firmarEco()
    const out = await firmarReferencias("FOTOS_ORDENES", [
      `${BASE}/public/fotos-ordenes/org1/o/a.jpg`,
      "org1/o/b.jpg",
    ])
    expect(from).toHaveBeenCalledWith("fotos-ordenes")
    expect(createSignedUrls).toHaveBeenCalledTimes(1)
    expect(createSignedUrls).toHaveBeenCalledWith(["org1/o/a.jpg", "org1/o/b.jpg"], VIGENCIA_URL_FIRMADA_SEG)
    expect(out).toEqual([
      `${BASE}/sign/x/org1/o/a.jpg?token=t`,
      `${BASE}/sign/x/org1/o/b.jpg?token=t`,
    ])
  })

  it("devuelve null en la posición de referencias fuera del prefijo de la organización", async () => {
    firmarEco()
    const out = await firmarReferencias("COMPROBANTES_GASTOS", ["org1/a.pdf", "org2/b.pdf", "org10/c.pdf"], {
      prefijo: "org1",
    })
    expect(createSignedUrls).toHaveBeenCalledWith(["org1/a.pdf"], VIGENCIA_URL_FIRMADA_SEG)
    expect(out).toEqual([`${BASE}/sign/x/org1/a.pdf?token=t`, null, null])
  })

  it("no llama a Storage si no hay nada que firmar", async () => {
    const out = await firmarReferencias("FIRMAS", [null, "https://example.com/x.png"])
    expect(createSignedUrls).not.toHaveBeenCalled()
    expect(out).toEqual([null, null])
  })

  it("devuelve null para todo si Storage falla", async () => {
    createSignedUrls.mockResolvedValue({ data: null, error: { message: "boom" } })
    const out = await firmarReferencias("FIRMAS", ["org1/a.png"])
    expect(out).toEqual([null])
  })

  it("devuelve null para el archivo que Storage no pudo firmar", async () => {
    createSignedUrls.mockResolvedValue({
      data: [
        { path: "org1/a.png", signedUrl: "s-a", error: null },
        { path: "org1/b.png", signedUrl: "", error: "Object not found" },
      ],
      error: null,
    })
    const out = await firmarReferencias("FIRMAS", ["org1/a.png", "org1/b.png"])
    expect(out).toEqual(["s-a", null])
  })

  it("firma una sola vez los paths repetidos", async () => {
    firmarEco()
    const out = await firmarReferencias("FIRMAS", ["org1/a.png", "org1/a.png"])
    expect(createSignedUrls).toHaveBeenCalledWith(["org1/a.png"], VIGENCIA_URL_FIRMADA_SEG)
    expect(out[0]).toBe(out[1])
  })
})

describe("firmarReferencia", () => {
  it("firma una referencia suelta", async () => {
    firmarEco()
    expect(await firmarReferencia("FIRMAS", "org1/a.png")).toBe(`${BASE}/sign/x/org1/a.png?token=t`)
  })
})

describe("firmarCampo", () => {
  it("prefiere el campo de path y reemplaza la URL guardada", async () => {
    firmarEco()
    const filas = [
      { id: "1", url: `${BASE}/public/fotos-ordenes/org1/o/a.jpg`, storage_path: "org1/o/a.jpg" },
      { id: "2", url: `${BASE}/public/fotos-ordenes/org1/o/b.jpg`, storage_path: null },
    ]
    const out = await firmarCampo("FOTOS_ORDENES", filas, "url", { campoPath: "storage_path" })
    expect(out).toEqual([
      { id: "1", url: `${BASE}/sign/x/org1/o/a.jpg?token=t`, storage_path: "org1/o/a.jpg" },
      { id: "2", url: `${BASE}/sign/x/org1/o/b.jpg?token=t`, storage_path: null },
    ])
  })
})
