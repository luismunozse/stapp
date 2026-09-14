/**
 * Script para generar iconos PNG desde los SVGs del logo.
 * Ejecutar: node scripts/generate-icons.mjs
 *
 * Genera dos juegos, ambos desde el mismo dibujo para que web y app no se
 * desincronicen:
 *   • public/  → favicon, apple-touch-icon e iconos del manifest PWA.
 *   • assets/  → las fuentes que consume `npx capacitor-assets generate`
 *                para escribir los recursos nativos de android/.
 *
 * Después de correr esto, regenerar los recursos nativos con:
 *   npm run cap:assets
 */
import sharp from "sharp"
import { readFileSync, writeFileSync, mkdirSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const publicDir = resolve(__dirname, "..", "public")
const assetsDir = resolve(__dirname, "..", "assets")

// SVG del favicon (48x48 viewBox, sin fondo circular)
const faviconSvg = readFileSync(resolve(publicDir, "favicon.svg"), "utf-8")

// SVG del icono PWA (192x192 viewBox, con fondo circular)
const icon192Svg = readFileSync(resolve(publicDir, "icon-192.svg"), "utf-8")

// SVG del icono grande (512x512 viewBox, con fondo circular)
const icon512Svg = readFileSync(resolve(publicDir, "icon-512.svg"), "utf-8")

// ============================================================
// Fuentes para los recursos nativos (assets/)
// ============================================================
// Paleta, en un solo lugar para que el ícono, el splash y el StatusBar nativo
// (ver lib/capacitor.ts) usen los mismos valores.
const BRAND_FROM = "#3b82f6"
const BRAND_TO = "#2563eb"
const SURFACE_LIGHT = "#f8fafc" // mismo slate-50 del círculo del ícono PWA
const SPLASH_LIGHT = "#ffffff" // igual al SplashScreen.backgroundColor de capacitor.config.ts
const SPLASH_DARK = "#0a0a1a"

// El teléfono, en coordenadas del viewBox de 512 de public/icon-512.svg.
const GLYPH_HEIGHT = 320 // alto del cuerpo del teléfono (y=96 → y=416)
const GLYPH_CENTER = 256 // el dibujo está centrado en (256, 256)

const gradient = (id) => `<linearGradient id="${id}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${BRAND_FROM}"/>
      <stop offset="100%" stop-color="${BRAND_TO}"/>
    </linearGradient>`

/**
 * La marca sin el círculo de fondo, para poder componerla sobre distintos
 * fondos. Es el mismo dibujo que public/icon-512.svg menos el <circle>.
 */
const glyph = (gradientId) => `
  <rect x="160" y="96" width="192" height="320" rx="32" fill="url(#${gradientId})"/>
  <rect x="180" y="128" width="152" height="256" rx="12" fill="white"/>
  <path d="M212 192h32v32h48v-32h20M212 280h80M256 280v56" stroke="${BRAND_FROM}" stroke-width="8" stroke-linecap="round" fill="none"/>
  <circle cx="212" cy="192" r="10" fill="${BRAND_FROM}"/>
  <circle cx="292" cy="280" r="10" fill="${BRAND_FROM}"/>
  <circle cx="256" cy="336" r="10" fill="${BRAND_FROM}"/>
  <rect x="228" y="108" width="56" height="12" rx="6" fill="rgba(255,255,255,0.5)"/>
  <rect x="204" y="392" width="104" height="12" rx="6" fill="rgba(255,255,255,0.3)"/>`

/**
 * Canvas cuadrado con la marca centrada.
 *
 * `glyphFraction` es el alto del teléfono como proporción del lado del canvas.
 * Se mantiene chico a propósito: el adaptive icon de Android recorta con una
 * máscara arbitraria y sólo garantiza el 66% central, y el splash se muestra
 * con center-crop, así que en ambos casos los bordes se pierden.
 */
function composedSvg({ size, glyphFraction, background, gradientId }) {
  const scale = (glyphFraction * 512) / GLYPH_HEIGHT
  const bg = background ? `<rect width="512" height="512" fill="${background}"/>` : ""
  return `<svg width="${size}" height="${size}" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>${gradient(gradientId)}</defs>
  ${bg}
  <g transform="translate(${GLYPH_CENTER},${GLYPH_CENTER}) scale(${scale}) translate(-${GLYPH_CENTER},-${GLYPH_CENTER})">${glyph(gradientId)}
  </g>
</svg>`
}

/** El ícono completo (círculo + marca), renderizado al tamaño que se pida. */
function iconOnlySvg(size) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>${gradient("iconOnly")}</defs>
  <circle cx="256" cy="256" r="256" fill="${SURFACE_LIGHT}"/>${glyph("iconOnly")}
</svg>`
}

/**
 * Escribe las cinco fuentes del "Custom Mode" de @capacitor/assets.
 * Tamaños mínimos que exige la herramienta: 1024 los íconos, 2732 los splash.
 */
async function generateNativeSources() {
  mkdirSync(assetsDir, { recursive: true })

  const write = async (svg, filename) => {
    await sharp(Buffer.from(svg)).png().toFile(resolve(assetsDir, filename))
    console.log(`Generated assets/${filename}`)
  }

  // Ícono cuadrado completo: lo usa iOS y es el fallback legacy de Android.
  await write(iconOnlySvg(1024), "icon-only.png")

  // Capas del adaptive icon de Android. El foreground va sin fondo (Android
  // compone las capas) y el fondo es plano: si tuviera dibujo, el efecto de
  // parallax del launcher lo desalinearía respecto del foreground.
  //
  // Acá el glyph va grande a propósito: capacitor-assets mete este PNG en un
  // <inset android:inset="16.7%">, o sea que ya encoge la fuente hasta la zona
  // segura de 72dp. El canvas de este archivo termina mapeado 1:1 contra el
  // área que el launcher garantiza visible, así que dejar margen propio lo
  // encogería dos veces. 0.68 llena esa zona sin que una máscara circular
  // recorte las esquinas del teléfono (diagonal ≈ 812px sobre 1024).
  await write(
    composedSvg({ size: 1024, glyphFraction: 0.68, background: null, gradientId: "fg" }),
    "icon-foreground.png"
  )
  await write(
    `<svg width="1024" height="1024" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg"><rect width="512" height="512" fill="${SURFACE_LIGHT}"/></svg>`,
    "icon-background.png"
  )

  // Splash. 0.2 es la proporción que usa @capacitor/assets por defecto.
  await write(
    composedSvg({ size: 2732, glyphFraction: 0.2, background: SPLASH_LIGHT, gradientId: "sp" }),
    "splash.png"
  )
  await write(
    composedSvg({ size: 2732, glyphFraction: 0.2, background: SPLASH_DARK, gradientId: "spd" }),
    "splash-dark.png"
  )
}

async function generate() {
  // 1. favicon-32.png (32x32) - para browsers
  await sharp(Buffer.from(faviconSvg))
    .resize(32, 32)
    .png()
    .toFile(resolve(publicDir, "favicon-32.png"))
  console.log("Generated favicon-32.png")

  // 2. apple-touch-icon.png (180x180) - para iOS home screen
  // Crear un SVG específico para apple-touch-icon con fondo sólido blanco (no transparente)
  const appleSvg = `<svg width="180" height="180" viewBox="0 0 192 192" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="dg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#3b82f6"/>
      <stop offset="100%" stop-color="#2563eb"/>
    </linearGradient>
  </defs>
  <rect width="192" height="192" rx="38" fill="#f8fafc"/>
  <rect x="64" y="40" width="64" height="112" rx="12" fill="url(#dg)"/>
  <rect x="72" y="52" width="48" height="88" rx="4" fill="white"/>
  <path d="M84 72h12v12h16v-12h8M84 104h28M100 104v20" stroke="#3b82f6" stroke-width="3" stroke-linecap="round" fill="none"/>
  <circle cx="84" cy="72" r="4" fill="#3b82f6"/>
  <circle cx="112" cy="104" r="4" fill="#3b82f6"/>
  <circle cx="100" cy="124" r="4" fill="#3b82f6"/>
  <rect x="88" y="44" width="16" height="4" rx="2" fill="rgba(255,255,255,0.5)"/>
  <rect x="80" y="144" width="32" height="4" rx="2" fill="rgba(255,255,255,0.3)"/>
</svg>`
  await sharp(Buffer.from(appleSvg))
    .resize(180, 180)
    .png()
    .toFile(resolve(publicDir, "apple-touch-icon.png"))
  console.log("Generated apple-touch-icon.png")

  // 3. icon-192.png (192x192) - para PWA manifest
  await sharp(Buffer.from(icon192Svg))
    .resize(192, 192)
    .png()
    .toFile(resolve(publicDir, "icon-192.png"))
  console.log("Generated icon-192.png")

  // 4. icon-512.png (512x512) - para PWA manifest (splash screen)
  await sharp(Buffer.from(icon512Svg))
    .resize(512, 512)
    .png()
    .toFile(resolve(publicDir, "icon-512.png"))
  console.log("Generated icon-512.png")

  // 5. Regenerar favicon.ico desde el SVG (32x32 PNG en formato ICO)
  const favicon32Buffer = await sharp(Buffer.from(faviconSvg))
    .resize(32, 32)
    .png()
    .toBuffer()

  const favicon16Buffer = await sharp(Buffer.from(faviconSvg))
    .resize(16, 16)
    .png()
    .toBuffer()

  // ICO format: header + directory entries + PNG data
  const icoBuffer = createIco([
    { size: 16, png: favicon16Buffer },
    { size: 32, png: favicon32Buffer },
  ])
  writeFileSync(resolve(publicDir, "favicon.ico"), icoBuffer)
  console.log("Generated favicon.ico")

  // 6. Fuentes para los recursos nativos de Android/iOS
  await generateNativeSources()

  console.log("\nAll icons generated successfully!")
  console.log("Recordá correr `npm run cap:assets` para regenerar android/.")
}

function createIco(images) {
  const headerSize = 6
  const dirEntrySize = 16
  const dataOffset = headerSize + dirEntrySize * images.length

  // Calculate total size
  let totalSize = dataOffset
  for (const img of images) {
    totalSize += img.png.length
  }

  const buffer = Buffer.alloc(totalSize)

  // ICO Header
  buffer.writeUInt16LE(0, 0) // Reserved
  buffer.writeUInt16LE(1, 2) // Type: ICO
  buffer.writeUInt16LE(images.length, 4) // Number of images

  let currentOffset = dataOffset
  for (let i = 0; i < images.length; i++) {
    const img = images[i]
    const entryOffset = headerSize + i * dirEntrySize

    buffer.writeUInt8(img.size === 256 ? 0 : img.size, entryOffset) // Width
    buffer.writeUInt8(img.size === 256 ? 0 : img.size, entryOffset + 1) // Height
    buffer.writeUInt8(0, entryOffset + 2) // Color palette
    buffer.writeUInt8(0, entryOffset + 3) // Reserved
    buffer.writeUInt16LE(1, entryOffset + 4) // Color planes
    buffer.writeUInt16LE(32, entryOffset + 6) // Bits per pixel
    buffer.writeUInt32LE(img.png.length, entryOffset + 8) // Size of image data
    buffer.writeUInt32LE(currentOffset, entryOffset + 12) // Offset to image data

    img.png.copy(buffer, currentOffset)
    currentOffset += img.png.length
  }

  return buffer
}

generate().catch(console.error)
