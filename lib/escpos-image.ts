/**
 * Convert image URL to ESC/POS raster bit-image command (GS v 0).
 * Browser-only (uses canvas). Use from client components.
 *
 * 80mm printer: typical max width = 384 dots (203 dpi).
 * 58mm printer: typical max width = 384 dots (most use same head, narrow paper).
 *               Safe default = 200 dots for 58mm logos.
 */

const ESC_GS = 0x1d
const ESC_ESC = 0x1b

interface RasterOptions {
  maxWidth?: number    // max width in dots (default 300)
  threshold?: number   // 0-255, pixels darker than this = black (default 160)
}

export async function imageUrlToRaster(
  url: string,
  options: RasterOptions = {}
): Promise<Uint8Array | null> {
  const { maxWidth = 300, threshold = 160 } = options

  try {
    // Load image
    const img = await loadImage(url)

    // Compute scaled dimensions, force width to multiple of 8
    const ratio = Math.min(1, maxWidth / img.width)
    let targetW = Math.floor(img.width * ratio)
    targetW = targetW - (targetW % 8) // multiple of 8
    if (targetW <= 0) return null
    const targetH = Math.floor(img.height * (targetW / img.width))

    // Draw to canvas
    const canvas = document.createElement("canvas")
    canvas.width = targetW
    canvas.height = targetH
    const ctx = canvas.getContext("2d")
    if (!ctx) return null

    // White background to flatten transparency
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, targetW, targetH)
    ctx.drawImage(img, 0, 0, targetW, targetH)

    const imgData = ctx.getImageData(0, 0, targetW, targetH).data

    // Convert to 1-bit, MSB first
    const bytesPerRow = targetW / 8
    const raster = new Uint8Array(bytesPerRow * targetH)

    for (let y = 0; y < targetH; y++) {
      for (let x = 0; x < targetW; x++) {
        const i = (y * targetW + x) * 4
        const r = imgData[i]
        const g = imgData[i + 1]
        const b = imgData[i + 2]
        const a = imgData[i + 3]
        // Treat transparent as white
        const lum = a < 128 ? 255 : (r * 0.299 + g * 0.587 + b * 0.114)
        if (lum < threshold) {
          const byteIdx = y * bytesPerRow + Math.floor(x / 8)
          const bitIdx = 7 - (x % 8)
          raster[byteIdx] |= 1 << bitIdx
        }
      }
    }

    // Build GS v 0 command
    // GS v 0 m xL xH yL yH data
    // m = 0 (normal)
    const xL = bytesPerRow & 0xff
    const xH = (bytesPerRow >> 8) & 0xff
    const yL = targetH & 0xff
    const yH = (targetH >> 8) & 0xff

    const ALIGN_CENTER = [ESC_ESC, 0x61, 0x01]
    const ALIGN_LEFT = [ESC_ESC, 0x61, 0x00]
    const cmd = [ESC_GS, 0x76, 0x30, 0x00, xL, xH, yL, yH]
    const LF = 0x0a

    const out = new Uint8Array(ALIGN_CENTER.length + cmd.length + raster.length + 1 + ALIGN_LEFT.length)
    let pos = 0
    out.set(ALIGN_CENTER, pos); pos += ALIGN_CENTER.length
    out.set(cmd, pos); pos += cmd.length
    out.set(raster, pos); pos += raster.length
    out[pos++] = LF
    out.set(ALIGN_LEFT, pos)

    return out
  } catch (err) {
    console.error("imageUrlToRaster error:", err)
    return null
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error("No se pudo cargar el logo"))
    img.src = url
  })
}
