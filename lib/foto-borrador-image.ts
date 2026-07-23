import sharp from "sharp"

/** Tope por foto, ya comprimida en el cliente (~300KB con compressImage). */
export const MAX_FOTO_BYTES = 2 * 1024 * 1024

export type MimePermitido = "image/jpeg" | "image/png" | "image/webp"

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/**
 * El `Content-Type` lo miente cualquiera, así que el tipo sale de los bytes.
 * SVG queda fuera a propósito: es el único formato de imagen que puede llevar
 * script, y excluirlo elimina el XSS almacenado en vez de intentar sanearlo.
 */
export function sniffImageMime(buffer: Buffer): MimePermitido | null {
  if (buffer.length < 12) return null
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg"
  if (buffer.subarray(0, 8).equals(PNG_MAGIC)) return "image/png"
  if (
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp"
  }
  return null
}

/**
 * Re-encodea del lado del servidor. `rotate()` aplica la orientación EXIF antes
 * de que se pierda, si no las fotos verticales salen acostadas. sharp descarta
 * la metadata salvo que se pida `withMetadata()`, así que el EXIF (que lleva
 * GPS del cliente) no llega al registro de la orden.
 */
export async function reencodeFoto(
  buffer: Buffer,
): Promise<{ buffer: Buffer; mime: "image/jpeg" }> {
  const out = await sharp(buffer).rotate().jpeg({ quality: 82 }).toBuffer()
  return { buffer: out, mime: "image/jpeg" }
}
