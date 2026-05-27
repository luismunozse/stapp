/**
 * Detección de tipo de imagen por magic bytes (sniff de los primeros bytes).
 * Defensa contra content-type spoofing: el header MIME enviado por el cliente
 * es trivialmente falsificable; el contenido real no.
 *
 * Solo soporta JPEG/PNG/WEBP (los formatos que aceptamos en uploads públicos).
 * SVG y otros formatos vectoriales NO son detectables por magic bytes únicos
 * y son rechazados implícitamente.
 */

export type DetectedImageMime = "image/jpeg" | "image/png" | "image/webp"

export function detectImageMime(buf: Uint8Array | Buffer): DetectedImageMime | null {
  if (buf.length < 12) return null
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg"
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) return "image/png"
  // WEBP: "RIFF"....."WEBP"
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) return "image/webp"
  return null
}
