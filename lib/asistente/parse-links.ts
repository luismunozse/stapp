// Parsea links internos [texto](/ruta) en las respuestas del asistente.
// Solo rutas exactas en el allowlist de panelRoutes se renderiza como link.
// Cualquier otra ruta (alucinada, traversal, externa) queda como texto plano.
// También parsea negrita **texto** como segmentos bold.

import { panelRoutes } from "./panel-routes"

export type AsistenteSegment =
  | { type: "text"; text: string }
  | { type: "bold"; text: string }
  | { type: "link"; label: string; href: string }

const LINK_RE = /\[([^\]\n]+)\]\((\/[^)\s]*)\)/g
const BOLD_RE = /\*\*([^*\n]+)\*\*/g
const RUTAS_VALIDAS = new Set(panelRoutes.map((r) => r.ruta))

function parseBold(text: string): AsistenteSegment[] {
  const segments: AsistenteSegment[] = []
  let lastIndex = 0
  for (const match of text.matchAll(BOLD_RE)) {
    const index = match.index ?? 0
    if (index > lastIndex) segments.push({ type: "text", text: text.slice(lastIndex, index) })
    segments.push({ type: "bold", text: match[1] })
    lastIndex = index + match[0].length
  }
  if (lastIndex < text.length) segments.push({ type: "text", text: text.slice(lastIndex) })
  return segments
}

export function parseAsistenteLinks(text: string): AsistenteSegment[] {
  const segments: AsistenteSegment[] = []
  let lastIndex = 0
  for (const match of text.matchAll(LINK_RE)) {
    const [full, rawLabel, href] = match
    const index = match.index ?? 0
    if (!RUTAS_VALIDAS.has(href)) continue
    if (index > lastIndex) segments.push(...parseBold(text.slice(lastIndex, index)))
    segments.push({ type: "link", label: rawLabel.replaceAll("**", ""), href })
    lastIndex = index + full.length
  }
  if (lastIndex < text.length) segments.push(...parseBold(text.slice(lastIndex)))
  return segments
}
