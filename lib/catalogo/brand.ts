export interface BrandTheme {
  /** Normalized 6-digit hex, e.g. "#1d4ed8". */
  brand: string
  /** Readable text color over `brand` ("#ffffff" or "#1a1a1a"), chosen by WCAG contrast. */
  brandForeground: string
  /** `brand` + low alpha, for subtle surface washes (8-digit hex). */
  tint: string
  /** `brand` + medium alpha, for accents (8-digit hex). */
  tintStrong: string
}

const DEFAULT_BRAND = "#0f172a"

function parseHex(hex: string): { r: number; g: number; b: number } | null {
  let h = hex.trim().replace(/^#/, "")
  if (/^[0-9a-fA-F]{3}$/.test(h)) {
    h = h
      .split("")
      .map((c) => c + c)
      .join("")
  }
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  }
}

function normalizeHex(rgb: { r: number; g: number; b: number }): string {
  const h = (n: number) => n.toString(16).padStart(2, "0")
  return `#${h(rgb.r)}${h(rgb.g)}${h(rgb.b)}`
}

/** WCAG relative luminance (0..1). */
function luminance({ r, g, b }: { r: number; g: number; b: number }): number {
  const channel = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/**
 * Derives a brand theme from a hex color: a normalized brand, a contrast-correct
 * foreground (fixes "white text on a light brand button" bugs), and alpha tints
 * for surface washes. Invalid input falls back to a safe default.
 */
export function getBrandTheme(hex: string): BrandTheme {
  const rgb = parseHex(hex) ?? parseHex(DEFAULT_BRAND)!
  const brand = normalizeHex(rgb)
  const lum = luminance(rgb)
  const whiteContrast = 1.05 / (lum + 0.05)
  const blackContrast = (lum + 0.05) / 0.05
  const brandForeground = whiteContrast >= blackContrast ? "#ffffff" : "#1a1a1a"
  return {
    brand,
    brandForeground,
    tint: `${brand}14`,
    tintStrong: `${brand}26`,
  }
}
