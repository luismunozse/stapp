import Anthropic from "@anthropic-ai/sdk"

const anthropic = new Anthropic({ apiKey: process.env.STAPP_CHATBOT_API_KEY })

const EXTRACT_MODEL = "claude-haiku-4-5"

export interface ExtractedLeadData {
  nombre: string | null
  email: string | null
  telefono: string | null
  empresa: string | null
  cantidad_tecnicos: number | null
  ciudad: string | null
  sistema_actual: string | null
  urgencia: "alta" | "media" | "baja" | null
  score: number
  resumen: string | null
}

export interface ChatTurn {
  tipo: string
  contenido: string
}

// JSON Schema para structured outputs de Claude. Nulos via union de tipos.
// Todas las propiedades en `required` (strict): los datos ausentes se devuelven null.
const extractionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    nombre: { type: ["string", "null"], description: "Nombre propio del usuario, capitalizado. Null si no es claro." },
    email: { type: ["string", "null"], description: "Email válido o null." },
    telefono: { type: ["string", "null"], description: "Solo dígitos, 8-15 chars. Null si no es teléfono." },
    empresa: { type: ["string", "null"], description: "Nombre del taller/service/local que el usuario mencionó." },
    cantidad_tecnicos: { type: ["number", "null"], description: "Cantidad de técnicos del taller, entero." },
    ciudad: { type: ["string", "null"] },
    sistema_actual: { type: ["string", "null"], description: "Cómo gestiona hoy: excel, papel, software X, ninguno." },
    urgencia: { type: ["string", "null"], enum: ["alta", "media", "baja", null] },
    score: { type: "number", description: "0-100, qué tan calificado está el lead." },
    resumen: { type: ["string", "null"], description: "Contexto útil para comercial, máx 200 chars." },
  },
  required: [
    "nombre", "email", "telefono", "empresa", "cantidad_tecnicos",
    "ciudad", "sistema_actual", "urgencia", "score", "resumen",
  ],
} as const

const SHORT_REPLY = /^(hola|buenas|buen[oa]s? d[ií]as?|buen[oa]s? tardes?|buen[oa]s? noches?|gracias|ok|okay|si|s[ií]|no|listo|dale|perfecto|genial|chau|adios|adi[oó]s)\.?\!?$/i

export function shouldExtract(message: string, hasHistory: boolean): boolean {
  const trimmed = message.trim()
  if (trimmed.length < 6) return false
  if (SHORT_REPLY.test(trimmed) && !hasHistory) return false
  return true
}

const EXTRACTION_SYSTEM = `Sos un extractor de datos. Analizá la conversación entre un usuario y Santi (asistente comercial de STApp, software de gestión para talleres de reparación). Extraé SOLO los datos que el usuario haya mencionado EXPLÍCITAMENTE.

REGLAS DE EXTRACCIÓN:
- nombre: solo si user dijo "me llamo X", "soy X" (X es nombre propio, no profesión como "técnico/electricista/dueño") o respondió con un nombre cuando Santi se lo pidió. Capitalizá correctamente.
- email: solo si formato válido (algo@algo.tld)
- telefono: 8-15 dígitos. Devolvé solo los dígitos sin espacios/guiones. Excluí números que sean cantidades (ej: "200000 reparaciones", "15 técnicos", "3 años").
- empresa: nombre propio de taller/service/local mencionado por el usuario.
- cantidad_tecnicos: entero. Si dice "trabajo solo" → 1. Si "somos 3" o "tengo 5 técnicos" → ese número.
- ciudad: ciudad/provincia argentina si la mencionó.
- sistema_actual: cómo gestiona hoy ("excel", "papel", "software X", "nada").
- urgencia: "alta" si dice "necesito ya/esta semana/urgente"; "media" si "estoy evaluando/pensando/viendo opciones"; "baja" si solo curiosea/explora.

SCORE (0-100), guía:
- 0-30: solo curiosea, sin datos de contacto, sin contexto de negocio
- 31-60: pregunta funcionalidades específicas o dio nombre/empresa, sin contacto aún
- 61-80: dio email o teléfono, mencionó tener taller/negocio
- 81-100: dio email/tel, pidió demo o precios concretos, urgencia alta o mencionó tamaño/sistema actual

resumen: 1-2 frases de contexto para comercial. Máximo 200 caracteres. Null si no hay nada útil.

NUNCA INVENTES DATOS. Si no aparece explícito, devolvé null. Score siempre numérico.`

export async function extractLeadData(messages: ChatTurn[]): Promise<ExtractedLeadData | null> {
  if (!process.env.STAPP_CHATBOT_API_KEY) return null
  if (messages.length === 0) return null

  const conversation = messages
    .map((m) => `${m.tipo === "USER" ? "Usuario" : "Santi"}: ${m.contenido}`)
    .join("\n")

  try {
    const response = await anthropic.messages.create({
      model: EXTRACT_MODEL,
      max_tokens: 500,
      temperature: 0,
      system: EXTRACTION_SYSTEM,
      messages: [{ role: "user", content: `Conversación:\n${conversation}` }],
      output_config: { format: { type: "json_schema", schema: extractionSchema } },
    })

    const textBlock = response.content.find((b) => b.type === "text")
    if (!textBlock || textBlock.type !== "text") return null
    const parsed = JSON.parse(textBlock.text) as Partial<ExtractedLeadData>

    return {
      nombre: parsed.nombre ?? null,
      email: parsed.email ?? null,
      telefono: parsed.telefono ?? null,
      empresa: parsed.empresa ?? null,
      cantidad_tecnicos: parsed.cantidad_tecnicos ?? null,
      ciudad: parsed.ciudad ?? null,
      sistema_actual: parsed.sistema_actual ?? null,
      urgencia: parsed.urgencia ?? null,
      score: typeof parsed.score === "number" ? Math.max(0, Math.min(100, parsed.score)) : 0,
      resumen: parsed.resumen ?? null,
    }
  } catch (err) {
    console.error("[extractLeadData] failed:", err)
    return null
  }
}
