import sharp from "sharp"

// ─── Logo de la organización para los PDF ───
//
// El logo se sube tal cual lo manda el usuario (app/api/configuracion), así
// que llega en cualquier estado: JPG de celular con orientación EXIF, PNG con
// un margen transparente enorme alrededor, WEBP, fotos de 4000px. Antes cada
// generador hacía su propio fetch + embedPng/embedJpg, y eso tenía tres
// problemas visibles en el papel:
//   - pdf-lib ignora el EXIF, así que un logo sacado con el celular salía
//     acostado (react-pdf sí lo respeta, por eso el remito salía bien y la
//     orden no);
//   - el margen blanco/transparente del archivo cuenta como parte del logo,
//     que quedaba chico y corrido dentro del marco;
//   - WEBP/GIF no se podían embeber y el logo desaparecía sin aviso.
// normalizeLogo resuelve los tres una sola vez, para todos los motores.

export type PdfLogo = {
  data: Buffer
  format: "png" | "jpg"
  /** Píxeles ya rotados y recortados: la proporción real del logo. */
  width: number
  height: number
}

/** Lado máximo del logo normalizado. Sobra para ~120pt impresos a 300dpi. */
const MAX_LADO = 600
const FORMATOS_ACEPTADOS = new Set(["png", "jpeg", "webp", "gif"])
const FETCH_TIMEOUT_MS = 8000

/**
 * El recorte solo se aplica si la esquina superior izquierda es transparente
 * o casi blanca. sharp toma esa esquina como "fondo": con un logo que es un
 * cuadrado de color lleno, recortar contra ese color se comería el logo
 * hasta dejar solo el texto de adentro.
 */
function esFondoRecortable([r, g, b, a]: number[]): boolean {
  if (a < 16) return true
  return a > 240 && r >= 245 && g >= 245 && b >= 245
}

export async function normalizeLogo(input: Buffer): Promise<PdfLogo | null> {
  try {
    const meta = await sharp(input).metadata()
    if (!meta.format || !FORMATOS_ACEPTADOS.has(meta.format)) return null

    // Paso 1: aplicar la orientación EXIF. Va en su propio paso porque el
    // recorte tiene que medir la imagen ya derecha.
    const derecho = await sharp(input, { animated: false }).rotate().png().toBuffer()

    const esquina = await sharp(derecho)
      .ensureAlpha()
      .extract({ left: 0, top: 0, width: 1, height: 1 })
      .raw()
      .toBuffer()

    let base = derecho
    if (esFondoRecortable([...esquina])) {
      try {
        base = await sharp(derecho).trim({ threshold: 12 }).png().toBuffer()
      } catch {
        // Imagen de un solo color: no hay nada que recortar.
      }
    }

    const pipeline = sharp(base).resize({
      width: MAX_LADO,
      height: MAX_LADO,
      fit: "inside",
      withoutEnlargement: true,
    })
    const { hasAlpha } = await sharp(base).metadata()
    const { data, info } = hasAlpha
      ? await pipeline.png().toBuffer({ resolveWithObject: true })
      : await pipeline.jpeg({ quality: 90 }).toBuffer({ resolveWithObject: true })

    return { data, format: hasAlpha ? "png" : "jpg", width: info.width, height: info.height }
  } catch (error) {
    console.error("Error normalizando el logo:", error)
    return null
  }
}

/**
 * Descarga y normaliza el logo. Nunca rechaza: un logo_url roto, lento o en
 * un formato raro degrada a "sin logo" y el documento se genera igual.
 */
export async function fetchLogo(logoUrl: string | null | undefined): Promise<PdfLogo | null> {
  if (!logoUrl) return null
  try {
    const res = await fetch(logoUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!res.ok) return null
    return await normalizeLogo(Buffer.from(await res.arrayBuffer()))
  } catch (error) {
    console.error("Error loading logo:", error)
    return null
  }
}

export type MarcoLogo = {
  /** Ancho del marco; el alto es siempre el `alto` pedido. */
  anchoMarco: number
  /** Tamaño y desplazamiento del logo dentro del marco. */
  ancho: number
  alto: number
  dx: number
  dy: number
}

/**
 * Marco de alto fijo y ancho según la proporción del logo: un logo
 * horizontal ya no queda como una tira finita en el medio de un cuadrado.
 * Va de cuadrado (logos verticales o cuadrados) hasta `proporcionMax`:1.
 */
export function marcoLogo(
  logo: { width: number; height: number },
  alto: number,
  margen: number,
  proporcionMax = 2.2,
): MarcoLogo {
  const altoUtil = alto - margen * 2
  const proporcion = logo.width / logo.height
  const anchoMarco = Math.min(Math.max(altoUtil * proporcion + margen * 2, alto), alto * proporcionMax)
  const escala = Math.min((anchoMarco - margen * 2) / logo.width, altoUtil / logo.height)
  const ancho = logo.width * escala
  const altoLogo = logo.height * escala
  return {
    anchoMarco,
    ancho,
    alto: altoLogo,
    dx: (anchoMarco - ancho) / 2,
    dy: (alto - altoLogo) / 2,
  }
}
