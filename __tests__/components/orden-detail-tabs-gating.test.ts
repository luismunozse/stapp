import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import { join } from "path"

// Guard arquitectónico: una pestaña cuyo CONTENIDO se gatea por rol tiene que
// gatear también su TRIGGER.
//
// Si no, el rol sin permiso ve la pestaña en la barra, la abre y encuentra el
// panel vacío: parece que la app se rompió, cuando en realidad el permiso
// funcionó. Pasó con "Servicios" — el contenido salía con {isAdmin && (...)}
// y el trigger no tenía gate, así que el técnico veía una pestaña muerta.
//
// El chequeo es sobre el fuente y no sobre el árbol renderizado a propósito:
// montar OrdenDetail arrastra sesión, router y una cascada de fetch, y lo que
// hay que fijar es la relación estructural entre trigger y contenido.

const SRC = readFileSync(
  join(process.cwd(), "components", "ordenes", "orden-detail.tsx"),
  "utf8",
)

const GATE = /\b(isAdmin|userRole|canVer\w*)\s*(&&|===|!==)/

/**
 * Texto interno de `<TabsContent value="X">`, desde el `>` de la etiqueta de
 * apertura hasta su cierre.
 */
function contenidoDePestana(src: string, valor: string): string {
  const apertura = src.indexOf(`<TabsContent value="${valor}"`)
  if (apertura === -1) return ""
  const finEtiqueta = src.indexOf(">", apertura)
  const cierre = src.indexOf("</TabsContent>", apertura)
  return src.slice(finEtiqueta + 1, cierre === -1 ? src.length : cierre)
}

/** Lo que precede al trigger, donde viviría su condicional de rol. */
function contextoDelTrigger(src: string, valor: string): string {
  const inicio = src.indexOf(`<TabsTrigger value="${valor}"`)
  if (inicio === -1) return ""
  return src.slice(Math.max(0, inicio - 200), inicio)
}

/**
 * El panel ENTERO es condicional al rol: `{isAdmin && (...)}` envolviendo todo.
 *
 * No alcanza con que el rol aparezca adentro. La pestaña "Cotizaciones" pasa el
 * rol como prop (`readOnly`, `mostrarCostos`) y eso NO deja el panel vacío: lo
 * degrada, que es un final legítimo. Lo que rompe la UI es el panel que no se
 * renderiza mientras el trigger sigue visible.
 */
function panelEnteroGateado(contenido: string): boolean {
  const inicio = contenido.trimStart()
  if (!inicio.startsWith("{")) return false
  return GATE.test(inicio.slice(0, 60))
}

describe("OrdenDetail — pestañas gateadas por rol", () => {
  const valores = Array.from(
    SRC.matchAll(/<TabsTrigger value="([^"]+)"/g),
    (m) => m[1],
  )

  it("encuentra las pestañas a auditar", () => {
    expect(valores.length).toBeGreaterThan(0)
    expect(valores).toContain("servicios")
  })

  it("distingue el panel oculto del panel degradado por props", () => {
    // Servicios oculta el panel entero; Cotizaciones solo lo degrada.
    expect(panelEnteroGateado(contenidoDePestana(SRC, "servicios"))).toBe(true)
    expect(panelEnteroGateado(contenidoDePestana(SRC, "cotizaciones"))).toBe(false)
  })

  it.each(valores)(
    'pestaña "%s": si el panel se oculta por rol, el trigger también',
    (valor) => {
      const contenido = contenidoDePestana(SRC, valor)
      if (!panelEnteroGateado(contenido)) return

      const contexto = contextoDelTrigger(SRC, valor)
      expect(
        GATE.test(contexto),
        `El panel de "${valor}" se oculta por rol pero su TabsTrigger no: ` +
          "el rol sin permiso ve la pestaña y la abre vacía.",
      ).toBe(true)
    },
  )
})
