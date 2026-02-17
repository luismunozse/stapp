/**
 * Script para generar iconos PNG desde los SVGs del logo.
 * Ejecutar: node scripts/generate-icons.mjs
 */
import sharp from "sharp"
import { readFileSync, writeFileSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const publicDir = resolve(__dirname, "..", "public")

// SVG del favicon (48x48 viewBox, sin fondo circular)
const faviconSvg = readFileSync(resolve(publicDir, "favicon.svg"), "utf-8")

// SVG del icono PWA (192x192 viewBox, con fondo circular)
const icon192Svg = readFileSync(resolve(publicDir, "icon-192.svg"), "utf-8")

// SVG del icono grande (512x512 viewBox, con fondo circular)
const icon512Svg = readFileSync(resolve(publicDir, "icon-512.svg"), "utf-8")

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

  console.log("\nAll icons generated successfully!")
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
