// @vitest-environment node
import { describe, it, expect } from "vitest"
import sharp from "sharp"
import { normalizeLogo, marcoLogo } from "@/lib/pdf-logo"

const rgba = (width: number, height: number, background: { r: number; g: number; b: number; alpha: number }) =>
  sharp({ create: { width, height, channels: 4, background } })

/** Un rectángulo rojo de w x h centrado en un lienzo de fondo `bg`. */
async function logoConMargen(w: number, h: number, lienzo: number, bg: { r: number; g: number; b: number; alpha: number }) {
  const rojo = await rgba(w, h, { r: 200, g: 30, b: 30, alpha: 1 }).png().toBuffer()
  return rgba(lienzo, lienzo, bg)
    .composite([{ input: rojo, left: Math.round((lienzo - w) / 2), top: Math.round((lienzo - h) / 2) }])
    .png()
    .toBuffer()
}

describe("normalizeLogo", () => {
  it("aplica la orientación EXIF (un JPG de celular no sale acostado)", async () => {
    const jpg = await sharp({ create: { width: 300, height: 100, channels: 3, background: "#fc9" } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer()
    const logo = await normalizeLogo(jpg)
    expect(logo).not.toBeNull()
    expect(logo!.width).toBe(100)
    expect(logo!.height).toBe(300)
  })

  it("recorta el margen transparente alrededor del logo", async () => {
    const png = await logoConMargen(400, 100, 1000, { r: 0, g: 0, b: 0, alpha: 0 })
    const logo = await normalizeLogo(png)
    expect(logo!.format).toBe("png")
    expect(logo!.width / logo!.height).toBeCloseTo(4, 1)
  })

  it("recorta el margen blanco de un logo opaco", async () => {
    const png = await logoConMargen(300, 100, 900, { r: 255, g: 255, b: 255, alpha: 1 })
    const logo = await normalizeLogo(png)
    expect(logo!.width / logo!.height).toBeCloseTo(3, 1)
  })

  it("no recorta un logo de fondo de color lleno", async () => {
    // Fondo azul con un rectángulo rojo: recortar contra el azul dejaría
    // solo el rectángulo y el logo perdería su fondo.
    const png = await logoConMargen(200, 50, 400, { r: 20, g: 40, b: 200, alpha: 1 })
    const logo = await normalizeLogo(png)
    expect(logo!.width).toBe(400)
    expect(logo!.height).toBe(400)
  })

  it("convierte WEBP a un formato embebible", async () => {
    const webp = await rgba(200, 100, { r: 10, g: 200, b: 10, alpha: 1 }).webp().toBuffer()
    const logo = await normalizeLogo(webp)
    expect(logo).not.toBeNull()
    expect(["png", "jpg"]).toContain(logo!.format)
  })

  it("achica logos enormes", async () => {
    const png = await rgba(4000, 1000, { r: 200, g: 30, b: 30, alpha: 1 }).png().toBuffer()
    const logo = await normalizeLogo(png)
    expect(logo!.width).toBe(600)
    expect(logo!.height).toBe(150)
  })

  it("devuelve null con bytes que no son una imagen", async () => {
    expect(await normalizeLogo(Buffer.from("<html>no soy un logo</html>"))).toBeNull()
  })
})

describe("marcoLogo", () => {
  it("un logo cuadrado o vertical usa un marco cuadrado", () => {
    expect(marcoLogo({ width: 100, height: 100 }, 57, 5).anchoMarco).toBe(57)
    const vertical = marcoLogo({ width: 100, height: 400 }, 57, 5)
    expect(vertical.anchoMarco).toBe(57)
    expect(vertical.alto).toBeCloseTo(47)
  })

  it("un logo horizontal ensancha el marco y llena el alto útil", () => {
    const m = marcoLogo({ width: 200, height: 100 }, 57, 5)
    expect(m.anchoMarco).toBeCloseTo(47 * 2 + 10)
    expect(m.alto).toBeCloseTo(47)
    expect(m.dx).toBeCloseTo(5)
  })

  it("el ancho del marco tiene tope y el logo queda contenido adentro", () => {
    const m = marcoLogo({ width: 1000, height: 100 }, 57, 5, 2.2)
    expect(m.anchoMarco).toBeCloseTo(57 * 2.2)
    expect(m.ancho).toBeLessThanOrEqual(m.anchoMarco - 10 + 1e-9)
    expect(m.dy).toBeGreaterThanOrEqual(5)
  })
})
