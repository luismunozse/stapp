// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import { unzipSync, strFromU8 } from "fflate"
import { createChainMock, mockSupabaseFrom } from "../../api/helpers"
import {
  isAllowedPdfUrl, fetchAllRows, collectPdfs, buildReadme, buildOrganizationExportStream,
} from "@/lib/account-deletion/export-organization"
import { supabaseAdmin } from "@/lib/supabase"

const pdfOk = () => new Response(new Uint8Array([37, 80, 68, 70]), { status: 200 })
const row = (n: number, url: string | null) => ({ id: `c${n}`, numero: `0001-${n}`, pdf_url: url })

describe("isAllowedPdfUrl", () => {
  it.each([
    ["https://www.tusfacturas.app/x.pdf", true],
    ["https://tusfacturas.app/x.pdf", true],
    ["http://www.tusfacturas.app/x.pdf", false],
    ["https://tusfacturas.app.evil.com/x.pdf", false],
    ["https://eviltusfacturas.app/x.pdf", false],
    ["https://evil.com/tusfacturas.app", false],
    ["no es una url", false],
  ])("%s -> %s", (url, esperado) => expect(isAllowedPdfUrl(url)).toBe(esperado))
})

describe("collectPdfs", () => {
  const deadline = () => Date.now() + 60_000

  it("baja los permitidos, sin seguir redirects, y manda el resto a pendientes", async () => {
    const fetchImpl = vi.fn(async () => pdfOk()) as unknown as typeof fetch
    const r = await collectPdfs(
      [row(1, "https://www.tusfacturas.app/a.pdf"), row(2, "https://evil.com/b.pdf"), row(3, null)],
      deadline(),
      { fetchImpl }
    )
    expect(r.files).toHaveLength(1)
    expect(r.files[0].name).toBe("0001-1-c1.pdf")
    expect(r.pending).toEqual([
      { comprobante: "0001-2", url: "https://evil.com/b.pdf", motivo: "host no permitido" },
      { comprobante: "0001-3", url: "", motivo: "sin link de PDF (emitido directo en ARCA)" },
    ])
    expect(vi.mocked(fetchImpl).mock.calls[0][1]).toMatchObject({ redirect: "error" })
    expect(vi.mocked(fetchImpl)).toHaveBeenCalledTimes(1)
  })

  it("respeta el tope de archivos: lo que no entra queda en pendientes con su link", async () => {
    const fetchImpl = vi.fn(async () => pdfOk()) as unknown as typeof fetch
    const rows = [1, 2, 3].map((n) => row(n, `https://www.tusfacturas.app/${n}.pdf`))
    const r = await collectPdfs(rows, deadline(), { fetchImpl, maxFiles: 2 })
    expect(r.files).toHaveLength(2)
    expect(r.pending).toHaveLength(1)
    expect(r.pending[0].motivo).toMatch(/tope/)
    expect(r.pending[0].url).toBe("https://www.tusfacturas.app/3.pdf")
    expect(vi.mocked(fetchImpl)).toHaveBeenCalledTimes(2)
  })

  it("respeta el tope de bytes", async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array(600), { status: 200 })) as unknown as typeof fetch
    const rows = [1, 2].map((n) => row(n, `https://www.tusfacturas.app/${n}.pdf`))
    const r = await collectPdfs(rows, deadline(), { fetchImpl, maxBytes: 1000 })
    expect(r.files).toHaveLength(1)
    expect(r.pending[0].motivo).toMatch(/tope/)
  })

  it("descarga en secuencia (nunca dos a la vez)", async () => {
    let enVuelo = 0
    let maxEnVuelo = 0
    const fetchImpl = vi.fn(async () => {
      enVuelo++
      maxEnVuelo = Math.max(maxEnVuelo, enVuelo)
      await new Promise((r) => setTimeout(r, 5))
      enVuelo--
      return pdfOk()
    }) as unknown as typeof fetch
    const rows = [1, 2, 3, 4].map((n) => row(n, `https://www.tusfacturas.app/${n}.pdf`))
    const r = await collectPdfs(rows, deadline(), { fetchImpl })
    expect(r.files).toHaveLength(4)
    expect(maxEnVuelo).toBe(1)
  })

  it("rechaza por Content-Length mayor al presupuesto restante", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(new Uint8Array(10), { status: 200, headers: { "content-length": "5000" } })
    ) as unknown as typeof fetch
    const r = await collectPdfs([row(1, "https://www.tusfacturas.app/1.pdf")], deadline(), { fetchImpl, maxBytes: 1000 })
    expect(r.files).toHaveLength(0)
    expect(r.pending[0].motivo).toMatch(/tope/)
  })

  it("corta la lectura si el cuerpo supera el presupuesto aunque Content-Length mienta", async () => {
    const fetchImpl = vi.fn(async () => {
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new Uint8Array(600))
          c.enqueue(new Uint8Array(600))
          c.close()
        },
      })
      return new Response(body, { status: 200, headers: { "content-length": "10" } })
    }) as unknown as typeof fetch
    const r = await collectPdfs([row(1, "https://www.tusfacturas.app/1.pdf")], deadline(), { fetchImpl, maxBytes: 1000 })
    expect(r.files).toHaveLength(0)
    expect(r.pending[0].motivo).toMatch(/tope/)
  })

  it("pasado el deadline no baja más y lo informa", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch
    const r = await collectPdfs([row(1, "https://www.tusfacturas.app/1.pdf")], Date.now() - 1, { fetchImpl })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(r.pending[0].motivo).toMatch(/tiempo/)
  })

  it("un HTTP 404 o un error de red no rompen el respaldo", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("x", { status: 404 }))
      .mockRejectedValueOnce(new Error("timeout")) as unknown as typeof fetch
    const rows = [1, 2].map((n) => row(n, `https://www.tusfacturas.app/${n}.pdf`))
    const r = await collectPdfs(rows, deadline(), { fetchImpl })
    expect(r.files).toHaveLength(0)
    expect(r.pending.map((p) => p.motivo)).toEqual(["HTTP 404", "no se pudo descargar"])
  })
})

describe("fetchAllRows", () => {
  it("pagina de a 1000 hasta agotar (2500 filas = 3 pedidos)", async () => {
    const all = Array.from({ length: 2500 }, (_, i) => ({ id: String(i) }))
    const range = vi.fn(async (from: number, to: number) => ({ data: all.slice(from, to + 1), error: null }))
    const chain: Record<string, unknown> = {}
    chain.select = vi.fn(() => chain)
    chain.order = vi.fn(() => chain)
    chain.range = range
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain as never)
    expect(await fetchAllRows("clientes", "*", (q) => q)).toHaveLength(2500)
    expect(range).toHaveBeenCalledTimes(3)
  })

  it("un error de la BD tira con el nombre de la tabla", async () => {
    mockSupabaseFrom({ clientes: createChainMock(null, { message: "down" }) })
    await expect(fetchAllRows("clientes", "*", (q) => q)).rejects.toThrow(/clientes: down/)
  })
})

describe("buildReadme", () => {
  it("siempre avisa que la documentación fiscal es obligación del taller", () => {
    const t = buildReadme({ orgNombre: "Taller", slug: "taller", generadoEn: new Date("2026-10-05T12:00:00Z"), pdfIncluidos: 3, pendientes: 0 })
    expect(t).toMatch(/obligaci[oó]n del taller/i)
    expect(t).not.toMatch(/pdfs-pendientes/)
  })
  it("si hubo pendientes explica el tope y apunta a pdfs-pendientes.csv", () => {
    const t = buildReadme({ orgNombre: "Taller", slug: "taller", generadoEn: new Date(), pdfIncluidos: 300, pendientes: 12 })
    expect(t).toMatch(/pdfs-pendientes\.csv/)
    expect(t).toMatch(/12/)
  })
})

describe("buildOrganizationExportStream", () => {
  beforeEach(() => vi.clearAllMocks())

  const tables = (over: Record<string, ReturnType<typeof createChainMock>> = {}) => ({
    clientes: createChainMock([{ id: "k1", nombre: "Ana" }], null),
    ventas: createChainMock([{ id: "v1", total: 100 }], null),
    items_venta: createChainMock([{ id: "i1", venta_id: "v1" }], null),
    pagos_venta: createChainMock([{ id: "p1", venta_id: "v1", monto: 100 }], null),
    facturas: createChainMock([{ id: "f1", numero_factura: "A-1", ordenes_servicio: { organization_id: "o1" } }], null),
    notas_credito: createChainMock([], null),
    cuenta_corriente: createChainMock([], null),
    comprobantes_fiscales: createChainMock([], null),
    ...over,
  })

  it("arma el ZIP: CSVs, PDFs, sin provider_response y sin la unión interna de facturas", async () => {
    const comprobantes = createChainMock(
      [
        { id: "c1", numero: "0001-1", estado: "emitido", pdf_url: "https://www.tusfacturas.app/1.pdf", total: -50 },
        { id: "c2", numero: "0001-2", estado: "emitido", pdf_url: "https://otro.com/2.pdf", total: 10 },
      ],
      null
    )
    const t = tables({ comprobantes_fiscales: comprobantes })
    mockSupabaseFrom(t)
    const fetchImpl = vi.fn(async () => pdfOk()) as unknown as typeof fetch

    const bytes = new Uint8Array(await new Response(buildOrganizationExportStream({ id: "o1", nombre: "Taller", slug: "taller" }, { fetchImpl })).arrayBuffer())
    const files = unzipSync(bytes)

    expect(Object.keys(files).sort()).toEqual([
      "LEEME.txt",
      "clientes.csv",
      "comprobantes_fiscales.csv",
      "comprobantes_pdf/0001-1-c1.pdf",
      "cuenta_corriente.csv",
      "facturas.csv",
      "notas_credito.csv",
      "pdfs-pendientes.csv",
      "ventas.csv",
      "ventas_items.csv",
      "ventas_pagos.csv",
    ])
    expect(strFromU8(files["comprobantes_fiscales.csv"])).toContain("-50")
    expect(strFromU8(files["comprobantes_fiscales.csv"])).not.toContain("'-50")
    expect(strFromU8(files["facturas.csv"])).not.toContain("ordenes_servicio")
    expect(strFromU8(files["pdfs-pendientes.csv"])).toContain("https://otro.com/2.pdf")
    expect(String(comprobantes.select.mock.calls[0][0])).not.toContain("provider_response")
    expect(strFromU8(files["LEEME.txt"])).toMatch(/obligaci[oó]n del taller/i)
  })

  it("todas las consultas se acotan por la organización de la sesión", async () => {
    const t = tables()
    mockSupabaseFrom(t)
    await new Response(buildOrganizationExportStream({ id: "o1", nombre: "Taller", slug: "taller" })).arrayBuffer()
    for (const name of ["clientes", "ventas", "notas_credito", "cuenta_corriente", "comprobantes_fiscales"] as const) {
      expect(t[name].eq).toHaveBeenCalledWith("organization_id", "o1")
    }
    expect(t.facturas.eq).toHaveBeenCalledWith("ordenes_servicio.organization_id", "o1")
    expect(t.items_venta.in).toHaveBeenCalledWith("venta_id", ["v1"])
    expect(t.pagos_venta.in).toHaveBeenCalledWith("venta_id", ["v1"])
  })

  it("si falla la lectura de una tabla el stream falla (no hay CSV vacío silencioso)", async () => {
    mockSupabaseFrom(tables({ clientes: createChainMock(null, { message: "down" }) }))
    await expect(
      new Response(buildOrganizationExportStream({ id: "o1", nombre: "Taller", slug: "taller" })).arrayBuffer()
    ).rejects.toThrow(/clientes: down/)
  })

  it("los montos fiscales llegan al CSV como números aunque la BD los devuelva como string", async () => {
    mockSupabaseFrom(
      tables({
        comprobantes_fiscales: createChainMock([{ id: "c1", numero: "1", estado: "anulado", pdf_url: null, total: "-50.25" }], null),
      })
    )
    const bytes = new Uint8Array(await new Response(buildOrganizationExportStream({ id: "o1", nombre: "T", slug: "t" })).arrayBuffer())
    const csv = strFromU8(unzipSync(bytes)["comprobantes_fiscales.csv"])
    expect(csv).toContain("-50.25")
    expect(csv).not.toContain("'-50.25")
  })
})
