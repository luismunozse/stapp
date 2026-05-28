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
  maxWidth?: number    // max width in dots (default 384)
  threshold?: number   // 0-255, pixels darker than this = black (default 200)
  dither?: boolean     // Floyd-Steinberg dithering (default true)
  contrast?: boolean   // stretch luminance before binarize (default true)
  gamma?: number       // <1 darkens midtones, >1 lightens (default 0.7)
  printerDots?: number // printer head width in dots for manual centering (default 576 = 80mm head)
  center?: boolean     // pad raster with white columns on left to center (default true)
}

export async function imageUrlToRaster(
  url: string,
  options: RasterOptions = {}
): Promise<Uint8Array | null> {
  const { maxWidth = 384, threshold = 200, dither = true, contrast = true, gamma = 0.7, printerDots = 576, center = true } = options

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

    // Build float luminance buffer (transparent → white)
    const lum = new Float32Array(targetW * targetH)
    for (let i = 0, p = 0; i < imgData.length; i += 4, p++) {
      const a = imgData[i + 3]
      lum[p] = a < 128 ? 255 : imgData[i] * 0.299 + imgData[i + 1] * 0.587 + imgData[i + 2] * 0.114
    }

    // Gamma darken midtones (gamma < 1 = darker)
    if (gamma !== 1) {
      for (let p = 0; p < lum.length; p++) {
        lum[p] = 255 * Math.pow(lum[p] / 255, 1 / gamma)
      }
    }

    // Auto contrast: stretch [min..max] of non-white pixels to [0..255]
    if (contrast) {
      let lo = 255, hi = 0
      for (let p = 0; p < lum.length; p++) {
        const v = lum[p]
        if (v < 250) {
          if (v < lo) lo = v
          if (v > hi) hi = v
        }
      }
      const range = hi - lo
      if (range > 20) {
        const scale = 255 / range
        for (let p = 0; p < lum.length; p++) {
          lum[p] = Math.max(0, Math.min(255, (lum[p] - lo) * scale))
        }
      }
    }

    // Convert to 1-bit, MSB first
    const bytesPerRow = targetW / 8
    const fullRaster = new Uint8Array(bytesPerRow * targetH)
    const rowHasInk = new Uint8Array(targetH)

    if (dither) {
      // Floyd-Steinberg dithering
      for (let y = 0; y < targetH; y++) {
        for (let x = 0; x < targetW; x++) {
          const p = y * targetW + x
          const old = lum[p]
          const neu = old < threshold ? 0 : 255
          const err = old - neu
          lum[p] = neu
          if (x + 1 < targetW) lum[p + 1] += (err * 7) / 16
          if (y + 1 < targetH) {
            if (x > 0) lum[p + targetW - 1] += (err * 3) / 16
            lum[p + targetW] += (err * 5) / 16
            if (x + 1 < targetW) lum[p + targetW + 1] += err / 16
          }
          if (neu === 0) {
            const byteIdx = y * bytesPerRow + (x >> 3)
            fullRaster[byteIdx] |= 1 << (7 - (x & 7))
            rowHasInk[y] = 1
          }
        }
      }
    } else {
      // Plain threshold
      for (let y = 0; y < targetH; y++) {
        for (let x = 0; x < targetW; x++) {
          if (lum[y * targetW + x] < threshold) {
            const byteIdx = y * bytesPerRow + (x >> 3)
            fullRaster[byteIdx] |= 1 << (7 - (x & 7))
            rowHasInk[y] = 1
          }
        }
      }
    }

    // Trim blank rows top/bottom to avoid wasting paper from logo padding
    let topTrim = 0
    while (topTrim < targetH && !rowHasInk[topTrim]) topTrim++
    let bottomTrim = targetH
    while (bottomTrim > topTrim && !rowHasInk[bottomTrim - 1]) bottomTrim--
    const trimmedH = bottomTrim - topTrim
    if (trimmedH <= 0) return null
    const trimmedRaster = fullRaster.slice(topTrim * bytesPerRow, bottomTrim * bytesPerRow)

    // Pad raster with white bytes on left to manually center (many printers
    // ignore ESC a for GS v 0 raster commands)
    let raster: Uint8Array
    let finalBytesPerRow: number
    if (center && printerDots > targetW) {
      const padDots = Math.floor((printerDots - targetW) / 2)
      const padBytes = padDots >> 3  // floor to multiple of 8 dots
      const rightPadBytes = Math.max(0, (printerDots >> 3) - bytesPerRow - padBytes)
      finalBytesPerRow = bytesPerRow + padBytes + rightPadBytes
      raster = new Uint8Array(finalBytesPerRow * trimmedH)
      for (let y = 0; y < trimmedH; y++) {
        const srcOff = y * bytesPerRow
        const dstOff = y * finalBytesPerRow + padBytes
        raster.set(trimmedRaster.subarray(srcOff, srcOff + bytesPerRow), dstOff)
      }
    } else {
      raster = trimmedRaster
      finalBytesPerRow = bytesPerRow
    }

    // Build GS v 0 command
    // GS v 0 m xL xH yL yH data
    // m = 0 (normal)
    const xL = finalBytesPerRow & 0xff
    const xH = (finalBytesPerRow >> 8) & 0xff
    const yL = trimmedH & 0xff
    const yH = (trimmedH >> 8) & 0xff

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

interface BinarizeOptions {
  maxWidth?: number
  threshold?: number
  dither?: boolean
  contrast?: boolean
  gamma?: number
}

/**
 * Binarize image to pure B/W PNG data URL.
 * Use for browser printing — driver will receive only black pixels, no grays to crush.
 */
export async function imageUrlToBinarizedDataUrl(
  url: string,
  options: BinarizeOptions = {}
): Promise<string | null> {
  const { maxWidth = 384, threshold = 200, dither = true, contrast = true, gamma = 0.7 } = options

  try {
    const img = await loadImage(url)
    const ratio = Math.min(1, maxWidth / img.width)
    const targetW = Math.max(8, Math.floor(img.width * ratio))
    const targetH = Math.max(1, Math.floor(img.height * (targetW / img.width)))

    const canvas = document.createElement("canvas")
    canvas.width = targetW
    canvas.height = targetH
    const ctx = canvas.getContext("2d")
    if (!ctx) return null

    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, targetW, targetH)
    ctx.drawImage(img, 0, 0, targetW, targetH)

    const imgData = ctx.getImageData(0, 0, targetW, targetH)
    const data = imgData.data

    const lum = new Float32Array(targetW * targetH)
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      const a = data[i + 3]
      lum[p] = a < 128 ? 255 : data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114
    }

    if (gamma !== 1) {
      for (let p = 0; p < lum.length; p++) {
        lum[p] = 255 * Math.pow(lum[p] / 255, 1 / gamma)
      }
    }

    if (contrast) {
      let lo = 255, hi = 0
      for (let p = 0; p < lum.length; p++) {
        const v = lum[p]
        if (v < 250) {
          if (v < lo) lo = v
          if (v > hi) hi = v
        }
      }
      const range = hi - lo
      if (range > 20) {
        const scale = 255 / range
        for (let p = 0; p < lum.length; p++) {
          lum[p] = Math.max(0, Math.min(255, (lum[p] - lo) * scale))
        }
      }
    }

    if (dither) {
      for (let y = 0; y < targetH; y++) {
        for (let x = 0; x < targetW; x++) {
          const p = y * targetW + x
          const old = lum[p]
          const neu = old < threshold ? 0 : 255
          const err = old - neu
          lum[p] = neu
          if (x + 1 < targetW) lum[p + 1] += (err * 7) / 16
          if (y + 1 < targetH) {
            if (x > 0) lum[p + targetW - 1] += (err * 3) / 16
            lum[p + targetW] += (err * 5) / 16
            if (x + 1 < targetW) lum[p + targetW + 1] += err / 16
          }
        }
      }
    } else {
      for (let p = 0; p < lum.length; p++) {
        lum[p] = lum[p] < threshold ? 0 : 255
      }
    }

    for (let p = 0; p < lum.length; p++) {
      const v = lum[p] === 0 ? 0 : 255
      const i = p * 4
      data[i] = data[i + 1] = data[i + 2] = v
      data[i + 3] = 255
    }
    ctx.putImageData(imgData, 0, 0)

    return canvas.toDataURL("image/png")
  } catch (err) {
    console.error("imageUrlToBinarizedDataUrl error:", err)
    return null
  }
}
