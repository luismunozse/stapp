import { formatCurrencyValue, type CurrencyCode } from "@/lib/currency"

/**
 * Meta description de los items del catalogo publico.
 *
 * Antes salia de `item.descripcion` a secas. Ese campo lo carga el taller y en
 * la practica suele traer una palabra: un item real del catalogo tenia
 * `description="XIAOMI"`. Google no indexa una pagina cuya descripcion es una
 * marca suelta, y de hecho no lo hacia: aparecian como "Descubierta,
 * actualmente sin indexar" en Search Console.
 *
 * La descripcion del taller se sigue respetando cuando dice algo, pero deja de
 * ser lo unico: se completa con los datos que el catalogo ya tiene (nombre,
 * etiquetas, precio, disponibilidad, taller) hasta armar una frase que
 * describa el producto.
 */

/**
 * Debajo de esto, lo que cargo el taller no alcanza para ser una descripcion
 * por si sola — es una marca, un codigo o media palabra. Se conserva como
 * dato, no como frase.
 */
const MIN_DESCRIPCION_UTIL = 60

/** Google trunca alrededor de los 160 caracteres. */
const MAX_LARGO = 160

export interface ItemMetaInput {
  nombre: string
  descripcion?: string | null
  etiquetas?: string[] | null
  precio?: number | string | null
  precioHasta?: number | string | null
  moneda?: CurrencyCode
  stockDisponible?: number | null
  orgName: string
}

function limpiar(texto: string): string {
  return texto.replace(/\s+/g, " ").trim()
}

/** Corta en el limite sin partir una palabra al medio. */
function recortar(texto: string, max: number): string {
  if (texto.length <= max) return texto
  const corte = texto.slice(0, max - 1)
  const ultimoEspacio = corte.lastIndexOf(" ")
  const base = ultimoEspacio > max * 0.6 ? corte.slice(0, ultimoEspacio) : corte
  return base.replace(/[\s,.;:—-]+$/, "") + "…"
}

function precioLegible(input: ItemMetaInput): string | null {
  const { precio, precioHasta, moneda } = input
  if (precio === null || precio === undefined || precio === "") return null
  const desde = formatCurrencyValue(precio, moneda)
  if (!desde) return null

  // Los items con rango de precio (variantes) muestran el rango, no un valor
  // que despues no coincide con lo que ve el usuario en la pagina.
  if (precioHasta !== null && precioHasta !== undefined && precioHasta !== "") {
    const hasta = formatCurrencyValue(precioHasta, moneda)
    if (hasta && hasta !== desde) return `${desde} a ${hasta}`
  }
  return desde
}

export function buildItemDescription(input: ItemMetaInput): string {
  const { nombre, orgName, stockDisponible } = input
  const descripcion = limpiar(input.descripcion ?? "")
  const partes: string[] = []

  // 1. La descripcion del taller manda cuando realmente describe algo.
  if (descripcion.length >= MIN_DESCRIPCION_UTIL) {
    partes.push(descripcion)
  } else {
    // 2. Si no, el nombre del producto es la frase principal, y lo que haya
    //    cargado el taller entra como calificador ("BATERIA BN5D. XIAOMI.").
    partes.push(limpiar(nombre))
    if (descripcion) partes.push(descripcion)

    const etiquetas = (input.etiquetas ?? [])
      .map((e) => limpiar(String(e)))
      .filter(Boolean)
      // Una etiqueta que solo repite lo que ya dice el nombre no suma.
      .filter((e) => !partes.join(" ").toLowerCase().includes(e.toLowerCase()))
      .slice(0, 3)
    if (etiquetas.length > 0) partes.push(etiquetas.join(", "))
  }

  partes.push(`Disponible en ${limpiar(orgName)}`)

  const precio = precioLegible(input)
  if (precio) partes.push(precio)

  // Solo se afirma el agotado, que es informacion util. "Hay stock" no se
  // declara: el numero cambia y la pagina ya lo muestra en vivo.
  if (stockDisponible === 0) partes.push("Sin stock por el momento")

  const frase = partes
    .map((p) => p.replace(/[.\s]+$/, ""))
    .filter(Boolean)
    .join(". ")

  return recortar(`${frase}.`, MAX_LARGO)
}

/**
 * Title del item. Se mantiene el formato `producto — taller` que ya usaba la
 * pagina; lo unico que cambia es que se recorta para que el buscador no lo
 * parta a la mitad.
 */
export function buildItemTitle(nombre: string, orgName: string): string {
  const limpio = limpiar(nombre)
  const taller = limpiar(orgName)
  const completo = `${limpio} — ${taller}`
  if (completo.length <= 65) return completo
  // Con nombres largos se prioriza el producto sobre el taller: es lo que la
  // persona busco.
  return recortar(limpio, 65 - taller.length - 3) + ` — ${taller}`
}
