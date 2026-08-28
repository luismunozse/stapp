import { describe, it, expect } from "vitest"
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

/**
 * Guarda contra una trampa de Next que no se ve leyendo el codigo.
 *
 * `openGraph` NO se mergea en profundidad: una pagina que declara su propio
 * bloque `openGraph` sin `images` pierde la imagen del layout raiz. Hay once
 * paginas asi, y lo unico que las cubre es la convencion
 * `app/opengraph-image.tsx`, que se aplica al segmento y a todos sus hijos.
 *
 * Al borrar ese archivo en #364 el sitio entero quedo sin og:image y el
 * preview de WhatsApp paso a no tener imagen. Los tipos no lo ven, el build no
 * lo ve y los tests de la tarjeta tampoco: solo se detecta pidiendo el HTML.
 */
const RAIZ = join(__dirname, "..", "..")

describe("cobertura de og:image", () => {
  it("existe el opengraph-image de la raiz", () => {
    expect(existsSync(join(RAIZ, "app", "opengraph-image.tsx"))).toBe(true)
  })

  it("la raiz y /api/og dibujan la MISMA tarjeta", () => {
    // El bug original no era que el archivo existiera, sino que dibujaba una
    // tarjeta distinta a la de /api/og. Los dos tienen que salir de OgCard.
    const conv = readFileSync(join(RAIZ, "app", "opengraph-image.tsx"), "utf8")
    const ruta = readFileSync(join(RAIZ, "app", "api", "og", "route.tsx"), "utf8")

    expect(conv).toContain("@/lib/og/card")
    expect(conv).toContain("OgCard")
    expect(ruta).toContain("@/lib/og/card")
    expect(ruta).toContain("OgCard")
  })

  it("ninguna pagina se queda sin og:image", () => {
    // Una pagina que define openGraph sin images depende de una convencion
    // opengraph-image en su segmento o en alguno superior. Si no hay ninguna,
    // esa pagina no tiene og:image y nadie se entera.
    const huerfanas: string[] = []

    const recorrer = (dir: string) => {
      for (const entrada of readdirSync(dir)) {
        const ruta = join(dir, entrada)
        if (statSync(ruta).isDirectory()) {
          recorrer(ruta)
          continue
        }
        if (!/\.tsx$/.test(entrada)) continue
        if (/^opengraph-image/.test(entrada)) continue

        const src = readFileSync(ruta, "utf8")
        const i = src.indexOf("openGraph:")
        if (i < 0) continue
        if (src.slice(i, i + 700).includes("images")) continue

        // Busca una convencion en este segmento o en cualquier padre hasta app/.
        let cur = dir
        let cubierta = false
        while (cur.length >= join(RAIZ, "app").length) {
          if (readdirSync(cur).some((f) => /^opengraph-image\./.test(f))) {
            cubierta = true
            break
          }
          cur = join(cur, "..")
        }
        if (!cubierta) huerfanas.push(ruta.replace(RAIZ, "").replace(/\\/g, "/"))
      }
    }

    recorrer(join(RAIZ, "app"))
    expect(huerfanas).toEqual([])
  })
})
