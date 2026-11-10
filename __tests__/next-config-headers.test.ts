// @vitest-environment node
import { describe, it, expect } from "vitest"
import { createRequire } from "module"

const require = createRequire(import.meta.url)
const nextConfig = require("../next.config.js")

async function headersDe(source: string): Promise<Record<string, string>> {
  const reglas: Array<{ source: string; headers: Array<{ key: string; value: string }> }> =
    await nextConfig.headers()
  const regla = reglas.find((r) => r.source === source)
  return Object.fromEntries((regla?.headers ?? []).map((h) => [h.key, h.value]))
}

describe("next.config.js — headers de seguridad", () => {
  it("se aplican a todas las rutas", async () => {
    const h = await headersDe("/:path*")
    expect(Object.keys(h)).toEqual(
      expect.arrayContaining([
        "Content-Security-Policy",
        "X-Content-Type-Options",
        "Referrer-Policy",
        "Permissions-Policy",
      ])
    )
  })

  it("solo STApp puede embeber sus páginas en un iframe", async () => {
    const csp = (await headersDe("/:path*"))["Content-Security-Policy"]
    const frameAncestors = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("frame-ancestors"))
    expect(frameAncestors).toBe("frame-ancestors 'self' https://stapp.com.ar https://*.stapp.com.ar")
  })

  it("bloquea plugins y cambios de <base>", async () => {
    const csp = (await headersDe("/:path*"))["Content-Security-Policy"]
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("base-uri 'self'")
  })

  it("no restringe scripts todavía (una script-src rompería integraciones sin relevar)", async () => {
    const csp = (await headersDe("/:path*"))["Content-Security-Policy"]
    expect(csp).not.toMatch(/script-src|default-src/)
  })

  it("desactiva el sniffing de tipos", async () => {
    expect((await headersDe("/:path*"))["X-Content-Type-Options"]).toBe("nosniff")
  })
})
