import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

/**
 * Guarda de regresión del cableado de vocabulario.
 *
 * La capa de terminología (SP-1) existía desde hace tiempo pero estaba cableada
 * en 6 archivos de ~194: quien configuraba su vocabulario lo veía reflejado en
 * una pantalla de cada diez, que se lee como un bug. Este test fija los archivos
 * ya migrados para que nadie vuelva a meter el texto fijo al editarlos.
 *
 * No cubre TODO el repo a propósito: la lista crece a medida que avanza el
 * barrido. Agregar un archivo acá es la forma de declararlo "ya cableado".
 */

const ARCHIVOS_CABLEADOS = [
  "components/cotizaciones/cotizacion-form.tsx",
  "components/cotizaciones/checklist-picker.tsx",
  "components/cotizaciones/orden-selector.tsx",
  "components/inventario/inventario-bulk-form.tsx",
  "components/fotos/foto-upload.tsx",
  "components/fotos/foto-gallery.tsx",
  "components/dashboard/onboarding-panel.tsx",
  "app/(dashboard)/ordenes/recepcion/page.tsx",
]

/**
 * Frases que ve el usuario y que deberían salir del vocabulario de la org.
 * Se buscan como palabras completas para no marcar identificadores de código
 * (`tipoDispositivo`, `TipoDispositivo`) ni rutas de import.
 */
const PROHIBIDO: RegExp[] = [
  /\bdel equipo\b/i,
  /\bdel dispositivo\b/i,
  /\btipo de dispositivo\b/i,
  /\bvarios equipos\b/i,
  /\blos equipos\b/i,
]

/**
 * Los comentarios se sacan antes de escanear: describen la intención del código
 * y ahí "datos del equipo" es la forma natural de nombrar el concepto, no una
 * cadena que vea el usuario.
 */
function sinComentarios(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\r\n]*/g, "$1")
}

function leer(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), "utf-8")
}

describe("cableado de terminología", () => {
  it.each(ARCHIVOS_CABLEADOS)("%s consume el vocabulario de la org", (archivo) => {
    const src = leer(archivo)
    const usaHook = src.includes("useTerminologia")
    const usaServer = src.includes("getTerminologia")
    expect(usaHook || usaServer, `${archivo} no importa la terminología`).toBe(true)
  })

  it.each(ARCHIVOS_CABLEADOS)("%s no reintrodujo texto fijo", (archivo) => {
    const src = sinComentarios(leer(archivo))
    for (const patron of PROHIBIDO) {
      const match = src.match(patron)
      expect(match?.[0] ?? null, `${archivo}: literal fijo "${match?.[0]}"`).toBeNull()
    }
  })
})

describe("terminología: falsos amigos", () => {
  /**
   * "tu equipo" en el panel de onboarding significa el EQUIPO HUMANO, no el
   * aparato que se repara. Reemplazarlo por el vocabulario del rubro haría que
   * un taller mecánico lea "Asigná órdenes a tu vehículo".
   */
  it("no traduce 'tu equipo' (equipo humano) en el panel de onboarding", () => {
    const src = leer("components/dashboard/onboarding-panel.tsx")
    expect(src).toContain("Asigná órdenes a tu equipo")
  })

  it("no traduce las métricas de equipo humano en técnicos", () => {
    const src = leer("app/(dashboard)/tecnicos/ranking/page.tsx")
    expect(src).toContain("Comparativa operativa del equipo")
  })
})
