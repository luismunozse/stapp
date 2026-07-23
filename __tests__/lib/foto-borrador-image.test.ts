// @vitest-environment node
import { describe, it, expect } from "vitest"
import sharp from "sharp"
import { sniffImageMime, reencodeFoto } from "@/lib/foto-borrador-image"

const lienzo = () =>
  sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 10, g: 20, b: 30 } },
  })

describe("sniffImageMime: el tipo sale de los magic bytes, no del header", () => {
  it("reconoce JPEG, PNG y WebP reales", async () => {
    expect(sniffImageMime(await lienzo().jpeg().toBuffer())).toBe("image/jpeg")
    expect(sniffImageMime(await lienzo().png().toBuffer())).toBe("image/png")
    expect(sniffImageMime(await lienzo().webp().toBuffer())).toBe("image/webp")
  })

  it("rechaza SVG aunque se presente como imagen", () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
    expect(sniffImageMime(svg)).toBeNull()
  })

  it("rechaza un archivo cualquiera renombrado como imagen", () => {
    expect(sniffImageMime(Buffer.from("no soy una imagen"))).toBeNull()
  })

  it("rechaza un buffer demasiado corto sin explotar", () => {
    expect(sniffImageMime(Buffer.from([0xff, 0xd8]))).toBeNull()
  })
})

describe("reencodeFoto: la salida no arrastra metadata del cliente", () => {
  it("borra el EXIF que traía la foto original", async () => {
    const conExif = await lienzo()
      .withExif({ IFD0: { Copyright: "cliente", Software: "camara" } })
      .jpeg()
      .toBuffer()
    expect((await sharp(conExif).metadata()).exif).toBeDefined()

    const { buffer } = await reencodeFoto(conExif)
    expect((await sharp(buffer).metadata()).exif).toBeUndefined()
  })

  it("normaliza siempre a JPEG decodificable", async () => {
    const { buffer, mime } = await reencodeFoto(await lienzo().png().toBuffer())
    expect(mime).toBe("image/jpeg")
    expect(sniffImageMime(buffer)).toBe("image/jpeg")
    expect((await sharp(buffer).metadata()).width).toBe(8)
  })

  it("falla ante bytes que no son imagen en vez de devolver basura", async () => {
    await expect(reencodeFoto(Buffer.from("no soy una imagen"))).rejects.toThrow()
  })
})
