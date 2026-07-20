// Parsea links internos [texto](/ruta) en las respuestas del asistente.
// Solo rutas internas: cualquier destino que no empiece con "/" (o que
// contenga "//" o "http") queda como texto plano — aunque el modelo
// alucine una URL externa, nunca se renderiza como link.

export type AsistenteSegment =
  | { type: "text"; text: string }
  | { type: "link"; label: string; href: string }

const LINK_RE = /\[([^\]\n]+)\]\((\/[^)\s]*)\)/g

function esRutaInterna(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("//") && !href.includes("http")
}

export function parseAsistenteLinks(text: string): AsistenteSegment[] {
  const segments: AsistenteSegment[] = []
  let lastIndex = 0
  for (const match of text.matchAll(LINK_RE)) {
    const [full, label, href] = match
    const index = match.index ?? 0
    if (!esRutaInterna(href)) continue
    if (index > lastIndex) segments.push({ type: "text", text: text.slice(lastIndex, index) })
    segments.push({ type: "link", label, href })
    lastIndex = index + full.length
  }
  if (lastIndex < text.length) segments.push({ type: "text", text: text.slice(lastIndex) })
  return segments
}
