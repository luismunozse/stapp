import { describe, it, expect } from "vitest"
import robots from "@/app/robots"

/**
 * Google Search Console reporto /api/og y /api/og?v=3 como "Bloqueada por
 * robots.txt" desde el 15/3/26. Esa ruta genera la imagen de Open Graph de
 * todo el sitio, asi que el bloqueo dejaba sin imagen las tarjetas de
 * compartido de WhatsApp, Twitter, LinkedIn y Google.
 *
 * El bug es facil de reintroducir: basta con que alguien "limpie" la lista de
 * allow viendo que /api/ ya esta en disallow. Estos tests fijan la intencion.
 */
describe("robots.txt", () => {
  const rule = () => {
    const result = robots()
    const rules = Array.isArray(result.rules) ? result.rules : [result.rules]
    const wildcard = rules.find((r) => r.userAgent === "*")
    expect(wildcard).toBeDefined()
    return wildcard!
  }

  const asArray = (v: string | string[] | undefined): string[] =>
    v === undefined ? [] : Array.isArray(v) ? v : [v]

  it("mantiene /api/ bloqueado por defecto", () => {
    expect(asArray(rule().disallow)).toContain("/api/")
  })

  it("habilita /api/og, que alimenta las tarjetas de compartido", () => {
    expect(asArray(rule().allow)).toContain("/api/og")
  })

  it("habilita /api/download/apk-info, que /descargar/android pide desde el cliente", () => {
    expect(asArray(rule().allow)).toContain("/api/download/apk-info")
  })

  it("deja las rutas habilitadas mas especificas que el disallow que las cubre", () => {
    // En la especificacion de robots.txt gana la regla de path mas largo. Si
    // una ruta habilitada fuera mas corta o igual que el disallow que la
    // cubre, el bloqueo seguiria ganando y el allow no serviria de nada.
    const { allow, disallow } = rule()
    const disallowed = asArray(disallow)

    for (const path of asArray(allow)) {
      if (path === "/") continue
      const covering = disallowed.filter((d) => path.startsWith(d))
      for (const d of covering) {
        expect(path.length).toBeGreaterThan(d.length)
      }
    }
  })

  it("no habilita rutas sensibles de /api/", () => {
    const allowed = asArray(rule().allow)
    expect(allowed).not.toContain("/api/")
    expect(allowed.some((p) => p.startsWith("/api/auth"))).toBe(false)
  })

  it("sigue publicando el sitemap", () => {
    expect(robots().sitemap).toBe("https://stapp.com.ar/sitemap.xml")
  })
})
