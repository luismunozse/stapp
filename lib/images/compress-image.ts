/**
 * Resizes an image on a canvas (default 400px wide) and returns it as a data URL.
 * PNG stays PNG (keeps transparency); anything else is re-encoded as JPEG.
 *
 * Browser-only: relies on FileReader, Image and canvas.
 * Not to be confused with `compressImage` in `lib/image-compression.ts`, which
 * shrinks photos by size and returns a File.
 */
export function compressImageToDataUrl(
  file: File,
  maxWidth = 400,
  quality = 0.8
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (event) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement("canvas")
        let w = img.width
        let h = img.height
        if (w > maxWidth) {
          h = Math.round((h * maxWidth) / w)
          w = maxWidth
        }
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext("2d")!
        ctx.drawImage(img, 0, 0, w, h)
        // Usar PNG si es transparente, JPEG si no
        const isPng = file.type === "image/png"
        const outputType = isPng ? "image/png" : "image/jpeg"
        const dataUrl = canvas.toDataURL(outputType, isPng ? undefined : quality)
        resolve(dataUrl)
      }
      img.onerror = reject
      img.src = event.target?.result as string
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}
