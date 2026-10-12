import { describe, it, expect } from "vitest"
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

/**
 * Guarda contra dos trampas de Next que no se ven leyendo el codigo, y que
 * juntas dejaron al sitio sin `og:image`.
 *
 * 1. `openGraph` NO se mergea en profundidad. Una pagina que declara su propio
 *    bloque pierde entero el del layout raiz, `images` incluido.
 *
 * 2. La convencion `opengraph-image.*` NO cascadea a las rutas hijas: cubre
 *    unicamente el segmento donde vive.
 *
 * La segunda se verifico en produccion. Una version anterior de este test daba
 * verde asumiendo que si cascadeaba, y por eso no atrapo que `/precios`,
 * `/ayuda`, `/empresa/blog`, `/registro`, `/empresa/contacto` y
 * `/descargar/android` seguian sin imagen. El test estaba en verde y el sitio
 * roto.
 */
const RAIZ = join(__dirname, "..", "..")
const APP = join(RAIZ, "app")

/** Paginas que declaran `openGraph:` sin `images:` dentro del bloque. */
function paginasSinImages(): string[] {
  const sueltas: string[] = []

  const recorrer = (dir: string) => {
    for (const entrada of readdirSync(dir)) {
      const ruta = join(dir, entrada)
      if (statSync(ruta).isDirectory()) {
        recorrer(ruta)
        continue
      }
      if (!entrada.endsWith(".tsx")) continue
      if (entrada.startsWith("opengraph-image")) continue

      const src = readFileSync(ruta, "utf8")
      const i = src.indexOf("openGraph:")
      if (i < 0) continue
      if (src.slice(i, i + 700).includes("images")) continue

      // Solo la salva una convencion en SU MISMO segmento. No hay cascada.
      const cubiertaAca = readdirSync(dir).some((f) =>
        /^opengraph-image\./.test(f)
      )
      if (!cubiertaAca) sueltas.push(ruta.replace(RAIZ, "").replace(/\\/g, "/"))
    }
  }

  recorrer(APP)
  return sueltas
}

describe("cobertura de og:image", () => {
  it("ninguna pagina que declara openGraph se queda sin imagen", () => {
    expect(paginasSinImages()).toEqual([])
  })

  it("existe el opengraph-image de la raiz", () => {
    // Cubre `/`, que es la pagina que mas se comparte.
    expect(existsSync(join(APP, "opengraph-image.tsx"))).toBe(true)
  })

  it("la convencion y /api/og dibujan la MISMA tarjeta", () => {
    // El bug original no era que la convencion existiera, sino que dibujaba una
    // tarjeta distinta a la de /api/og: og:image servia una y twitter:image
    // otra. Mientras las dos salgan de OgCard, no pueden divergir.
    const conv = readFileSync(join(APP, "opengraph-image.tsx"), "utf8")
    const ruta = readFileSync(join(APP, "api", "og", "route.tsx"), "utf8")

    for (const src of [conv, ruta]) {
      expect(src).toContain("@/lib/og/card")
      expect(src).toContain("OgCard")
    }
  })

  it("todas las paginas apuntan a la misma imagen", () => {
    // Si alguien hardcodea otra URL, la tarjeta se bifurca de nuevo.
    const metadata = readFileSync(join(RAIZ, "lib", "og", "metadata.ts"), "utf8")
    expect(metadata).toContain("/api/og?v=")
  })
})
