/**
 * Divide una respuesta del asistente en bloques para mostrarla con formato: párrafos, listas con
 * viñetas, pasos numerados y títulos. Es un subconjunto chico de Markdown a propósito: lo que
 * escribe el modelo y nada más (sin HTML, sin tablas). El texto de cada bloque se sigue pasando por
 * `parseAsistenteLinks` para los links y las negritas.
 */
export type BloqueAsistente =
  | { tipo: "parrafo"; texto: string }
  | { tipo: "titulo"; texto: string }
  | { tipo: "lista"; ordenada: boolean; items: string[]; inicio?: number }

const VINETA_RE = /^\s*[-*•]\s+(.*)$/
const NUMERO_RE = /^\s*(\d{1,3})[.)]\s+(.*)$/
const TITULO_RE = /^\s{0,3}#{1,4}\s+(.*)$/

export function bloquesDeTexto(texto: string): BloqueAsistente[] {
  const bloques: BloqueAsistente[] = []
  let parrafo: string[] = []

  const cerrarParrafo = () => {
    if (parrafo.length > 0) bloques.push({ tipo: "parrafo", texto: parrafo.join("\n") })
    parrafo = []
  }
  const agregarItem = (ordenada: boolean, item: string, numero?: number) => {
    cerrarParrafo()
    const ultimo = bloques[bloques.length - 1]
    if (ultimo?.tipo === "lista" && ultimo.ordenada === ordenada) {
      ultimo.items.push(item)
    } else {
      bloques.push({ tipo: "lista", ordenada, items: [item], ...(ordenada && numero !== undefined && numero !== 1 && { inicio: numero }) })
    }
  }

  for (const linea of texto.split("\n")) {
    const vineta = linea.match(VINETA_RE)
    const numero = linea.match(NUMERO_RE)
    const titulo = linea.match(TITULO_RE)
    if (vineta) {
      agregarItem(false, vineta[1])
    } else if (numero) {
      agregarItem(true, numero[2], Number(numero[1]))
    } else if (titulo) {
      cerrarParrafo()
      bloques.push({ tipo: "titulo", texto: titulo[1].replace(/\*\*/g, "") })
    } else if (linea.trim() === "") {
      cerrarParrafo()
    } else {
      const ultimo = bloques[bloques.length - 1]
      // Una línea con sangría justo después de un ítem es la continuación de ese ítem.
      if (parrafo.length === 0 && ultimo?.tipo === "lista" && /^\s{2,}\S/.test(linea)) {
        ultimo.items[ultimo.items.length - 1] += ` ${linea.trim()}`
      } else {
        parrafo.push(linea)
      }
    }
  }
  cerrarParrafo()
  return bloques
}
