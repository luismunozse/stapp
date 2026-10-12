// @vitest-environment node
import { describe, it, expect } from "vitest"
import { unzipSync, strFromU8 } from "fflate"
import { buildZipStream } from "@/lib/account-deletion/zip"

async function read(stream: ReadableStream<Uint8Array>) {
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

describe("buildZipStream", () => {
  it("produce un ZIP válido con texto y binarios", async () => {
    const pdf = new Uint8Array([37, 80, 68, 70, 1, 2, 3])
    const bytes = await read(
      buildZipStream(async (zip) => {
        zip.addText("clientes.csv", "id,nombre\r\n1,Ñandú\r\n")
        zip.addBytes("comprobantes_pdf/a.pdf", pdf, { store: true })
      })
    )
    const files = unzipSync(bytes)
    expect(Object.keys(files).sort()).toEqual(["clientes.csv", "comprobantes_pdf/a.pdf"])
    expect(strFromU8(files["clientes.csv"])).toBe("id,nombre\r\n1,Ñandú\r\n")
    expect(Array.from(files["comprobantes_pdf/a.pdf"])).toEqual(Array.from(pdf))
  })

  it("conserva byte a byte texto no ASCII (ñ, á) y datos binarios con deflate", async () => {
    const texto = "niño á é ü — €\r\n".repeat(50)
    const binario = Uint8Array.from({ length: 4096 }, (_, i) => (i * 31) % 256)
    const files = unzipSync(
      await read(
        buildZipStream(async (zip) => {
          zip.addText("ñ/á.txt", texto)
          zip.addBytes("datos.bin", binario)
        })
      )
    )
    expect(Array.from(files["ñ/á.txt"])).toEqual(Array.from(new TextEncoder().encode(texto)))
    expect(strFromU8(files["ñ/á.txt"])).toBe(texto)
    expect(Array.from(files["datos.bin"])).toEqual(Array.from(binario))
  })

  it("emite chunks a medida que se agregan archivos (no espera al final)", async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const stream = buildZipStream(async (zip) => {
      zip.addBytes("a.bin", new Uint8Array(1000), { store: true })
      await gate
      zip.addBytes("b.bin", new Uint8Array(1000), { store: true })
    })
    const reader = stream.getReader()
    const first = await reader.read()
    expect(first.done).toBe(false)
    expect(first.value!.length).toBeGreaterThan(0)
    release()
    const chunks: Uint8Array[] = [first.value!]
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }
    const total = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
    let off = 0
    for (const c of chunks) {
      total.set(c, off)
      off += c.length
    }
    expect(Object.keys(unzipSync(total)).sort()).toEqual(["a.bin", "b.bin"])
  })

  it("si fill tira, el stream falla (no entrega un ZIP 'completo' trunco)", async () => {
    const stream = buildZipStream(async (zip) => {
      zip.addText("a.txt", "x")
      throw new Error("boom")
    })
    await expect(read(stream)).rejects.toThrow("boom")
  })

  it("un ZIP sin archivos igual es válido", async () => {
    expect(Object.keys(unzipSync(await read(buildZipStream(async () => {}))))).toEqual([])
  })
})

describe("buildZipStream cancelacion", () => {
  it("si el cliente cancela, el siguiente addText de fill tira y no encola", async () => {
    let fillError: unknown = null
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const stream = buildZipStream(async (zip) => {
      zip.addText("a.txt", "x")
      await gate
      try {
        zip.addText("b.txt", "y")
      } catch (e) {
        fillError = e
        throw e
      }
    })
    const reader = stream.getReader()
    await reader.read()
    await reader.cancel()
    release()
    await new Promise((r) => setTimeout(r, 10))
    expect(fillError).toBeInstanceOf(Error)
  })
})
