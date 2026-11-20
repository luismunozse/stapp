/**
 * Las imágenes de public/ no pasan por el proxy. Si una extensión falta en el
 * matcher, en el subdominio del taller sin sesión el proxy la redirige a
 * /login y la imagen no carga: pasó con las fotos .avif del panel de acceso,
 * que se perdían al cerrar sesión.
 */
import { describe, it, expect, vi } from "vitest"
import { readdirSync, statSync } from "node:fs"
import path from "node:path"

vi.mock("next-auth/jwt", () => ({ getToken: vi.fn() }))
vi.mock("@/lib/org-slug-edge", () => ({ getOrgSlugById: vi.fn() }))
vi.mock("@/lib/user-status-edge", () => ({ getUserDeletedStatus: vi.fn() }))
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(),
  getApiRateLimit: vi.fn(),
  isExemptFromRateLimit: vi.fn(),
  extractPublicToken: vi.fn(),
  extractPublicCatalogoSlug: vi.fn(),
}))
vi.mock("@/lib/tenant-status-edge", () => ({ getTenantStatusBySlug: vi.fn() }))

import { config } from "@/proxy"

const IMAGEN = /\.(avif|webp|png|jpe?g|gif|svg|ico)$/i

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = path.join(dir, nombre)
    return statSync(ruta).isDirectory() ? archivos(ruta) : [ruta]
  })
}

// El matcher de Next es un patrón de path-to-regexp; este en particular es una
// regex válida de JS anclada a todo el pathname.
const pasaPorProxy = (pathname: string) =>
  config.matcher.some((m: string) => new RegExp(`^${m}$`).test(pathname))

describe("matcher del proxy y archivos de public/", () => {
  const publicDir = path.join(process.cwd(), "public")
  const imagenes = archivos(publicDir)
    .map((f) => "/" + path.relative(publicDir, f).split(path.sep).join("/"))
    .filter((p) => IMAGEN.test(p))

  it("hay imágenes para revisar (incluidas las fotos del login)", () => {
    expect(imagenes).toContain("/fondo-login.avif")
  })

  it.each(imagenes)("%s no pasa por el proxy", (p) => {
    expect(pasaPorProxy(p)).toBe(false)
  })

  it("las páginas siguen pasando por el proxy", () => {
    expect(pasaPorProxy("/login")).toBe(true)
    expect(pasaPorProxy("/dashboard/ordenes")).toBe(true)
  })
})
