import { manualSections, type ContentBlock, type ManualSection } from "@/lib/manual-content"
import { panelRoutes } from "@/lib/asistente/panel-routes"

// IMPORTANTE: este prompt debe ser 100% estático (sin fechas, precios ni
// valores por request). El caching de Anthropic es un prefix match byte a
// byte: cualquier valor dinámico invalida la caché y multiplica el costo.

const INSTRUCCIONES = `Sos el asistente de ayuda de STApp dentro del panel. Tu única función es ayudar a los usuarios (dueños de talleres, técnicos y vendedores) a aprender a usar STApp, basándote EXCLUSIVAMENTE en el manual que tenés a continuación.

Reglas:
- Respondé en español argentino informal pero profesional (vos, "querés", "tenés").
- Sé conciso: máximo 2-3 párrafos o una lista de pasos.
- Si la respuesta está en el manual, explicala con los pasos concretos y mencioná en qué sección del panel se hace.
- Si el manual indica que algo es solo para un rol (ADMIN, TECNICO, VENDEDOR), aclaralo.
- Si te preguntan algo sobre STApp que NO está en el manual, decí honestamente que no tenés ese detalle y sugerí abrir un ticket desde la sección Soporte. NUNCA inventes funcionalidades.
- Si te preguntan cualquier cosa que no sea sobre el uso de STApp (código, otros temas, datos del negocio, cuánto vendió el taller, etc.), respondé amablemente que solo podés ayudar con el uso de STApp. No tenés acceso a los datos del taller.
- No des información de precios ni condiciones comerciales; para eso indicá la sección Configuración → Billing.
- Cuando tu respuesta involucre una pantalla del panel, incluí un link a esa pantalla con el formato [Nombre de la pantalla](/ruta), usando EXCLUSIVAMENTE rutas de la sección "Rutas del panel". Nunca inventes rutas ni incluyas URLs externas.

# Manual de STApp`

function renderBlock(block: ContentBlock): string {
  const parts: string[] = [`### ${block.subtitle}`, block.body]
  if (block.roles?.length) parts.push(`Roles: ${block.roles.join(", ")}`)
  if (block.steps?.length) parts.push(block.steps.map((s, i) => `${i + 1}. ${s}`).join("\n"))
  if (block.tip) parts.push(`Tip: ${block.tip}`)
  return parts.join("\n")
}

function renderSection(section: ManualSection): string {
  const header = `## ${section.title}\nVisible para roles: ${section.roles.join(", ")}`
  return [header, ...section.content.map(renderBlock)].join("\n\n")
}

function renderRoutes(): string {
  const lines = panelRoutes.map((r) => `- ${r.ruta} — ${r.descripcion}`)
  return ["# Rutas del panel", ...lines].join("\n")
}

export function buildAsistenteSystemPrompt(): string {
  return [INSTRUCCIONES, ...manualSections.map(renderSection), renderRoutes()].join("\n\n")
}
