import imageCompression from "browser-image-compression"

interface CompressionOptions {
  maxSizeMB?: number
  maxWidthOrHeight?: number
  quality?: number
}

const DEFAULT_OPTIONS: CompressionOptions = {
  maxSizeMB: 0.3, // 300KB máximo
  maxWidthOrHeight: 1920, // Full HD máximo
  quality: 0.8, // 80% calidad
}

/**
 * Comprime una imagen manteniendo buena calidad para documentación
 * Reduce imágenes de 5-10MB a ~200-300KB
 */
export async function compressImage(
  file: File,
  options: CompressionOptions = {}
): Promise<File> {
  const mergedOptions = { ...DEFAULT_OPTIONS, ...options }

  // Si la imagen ya es pequeña, no comprimir
  if (file.size <= (mergedOptions.maxSizeMB! * 1024 * 1024)) {
    return file
  }

  try {
    const compressedFile = await imageCompression(file, {
      maxSizeMB: mergedOptions.maxSizeMB!,
      maxWidthOrHeight: mergedOptions.maxWidthOrHeight!,
      useWebWorker: true,
      fileType: file.type as "image/jpeg" | "image/png" | "image/webp",
    })

    console.log(
      `Imagen comprimida: ${(file.size / 1024).toFixed(0)}KB -> ${(compressedFile.size / 1024).toFixed(0)}KB`
    )

    return compressedFile
  } catch (error) {
    console.error("Error comprimiendo imagen:", error)
    // Si falla la compresión, devolver original
    return file
  }
}

/**
 * Comprime una imagen y la convierte a base64
 */
export async function compressImageToBase64(
  file: File,
  options: CompressionOptions = {}
): Promise<{ base64: string; mime: string; size: number }> {
  const compressedFile = await compressImage(file, options)

  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const result = reader.result as string
      // Extraer solo la parte base64 (sin el prefijo data:image/...)
      const base64Match = result.match(/^data:(image\/[a-z]+);base64,(.+)$/)
      if (base64Match) {
        resolve({
          base64: base64Match[2],
          mime: base64Match[1],
          size: compressedFile.size,
        })
      } else {
        reject(new Error("Error al procesar imagen"))
      }
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(compressedFile)
  })
}

/**
 * Comprime múltiples imágenes en paralelo
 */
export async function compressMultipleImages(
  files: File[],
  options: CompressionOptions = {}
): Promise<File[]> {
  return Promise.all(files.map((file) => compressImage(file, options)))
}
