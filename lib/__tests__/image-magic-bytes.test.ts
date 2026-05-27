import { describe, it, expect } from "vitest"
import { detectImageMime } from "../image-magic-bytes"

describe("detectImageMime", () => {
  it("detecta JPEG válido (FF D8 FF)", () => {
    const buf = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])
    expect(detectImageMime(buf)).toBe("image/jpeg")
  })

  it("detecta PNG válido (89 50 4E 47 0D 0A 1A 0A)", () => {
    const buf = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
    expect(detectImageMime(buf)).toBe("image/png")
  })

  it("detecta WEBP válido (RIFF....WEBP)", () => {
    const buf = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, // RIFF
      0, 0, 0, 0,             // file size (irrelevante)
      0x57, 0x45, 0x42, 0x50, // WEBP
    ])
    expect(detectImageMime(buf)).toBe("image/webp")
  })

  it("rechaza buffer demasiado corto", () => {
    expect(detectImageMime(new Uint8Array([0xff, 0xd8]))).toBeNull()
    expect(detectImageMime(new Uint8Array([]))).toBeNull()
  })

  it("rechaza SVG (formato vectorial, no soportado)", () => {
    const svg = new TextEncoder().encode('<?xml version="1.0"?><svg...')
    expect(detectImageMime(svg)).toBeNull()
  })

  it("rechaza HTML disfrazado de PNG", () => {
    const html = new TextEncoder().encode("<!DOCTYPE html><html>...")
    expect(detectImageMime(html)).toBeNull()
  })

  it("rechaza GIF (no soportado)", () => {
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0, 0, 0, 0, 0, 0])
    expect(detectImageMime(gif)).toBeNull()
  })

  it("rechaza payload con magic bytes parciales", () => {
    // JPEG empieza con FF D8 FF — un FF D8 solo NO basta
    const partial = new Uint8Array([0xff, 0xd8, 0x00, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])
    expect(detectImageMime(partial)).toBeNull()
  })

  it("rechaza RIFF sin WEBP (puede ser WAV, AVI)", () => {
    const wav = new Uint8Array([
      0x52, 0x49, 0x46, 0x46,
      0, 0, 0, 0,
      0x57, 0x41, 0x56, 0x45, // WAVE
    ])
    expect(detectImageMime(wav)).toBeNull()
  })

  it("acepta Buffer (Node) además de Uint8Array", () => {
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])
    expect(detectImageMime(buf)).toBe("image/jpeg")
  })
})
