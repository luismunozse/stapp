import type Anthropic from "@anthropic-ai/sdk"
import type { ContextoHerramienta, Herramienta, LlamadaRegistrada } from "./herramientas"
import { definiciones } from "./herramientas"

export const ASISTENTE_MODEL = "claude-haiku-5-5"
// El thinking de Haiku 5.5 viene activado y cuenta dentro de max_tokens: dejar margen.
const MAX_TOKENS = 4096
const EFFORT = "medium" as const
/** Rondas de herramientas por mensaje. Pasado el tope, el modelo responde con lo que tiene. */
export const MAX_RONDAS = 4

export const RESPUESTA_FALLIDA = "Disculpá, tuve un problema para responder. Probá de nuevo en unos segundos."
export const RESPUESTA_RECHAZADA = "No puedo ayudarte con esa consulta. Si es sobre el uso de STApp, probá reformularla."

export interface UsoAcumulado {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

/** Lo que el panel va mostrando mientras se arma la respuesta (solo en modo streaming). */
export type EventoAsistente =
  | { tipo: "texto"; delta: string }
  | { tipo: "herramienta"; nombre: string; etiqueta: string }

export const ETIQUETA_GENERICA = "Consultando tus datos…"

export interface ResultadoAsistente {
  texto: string
  uso: UsoAcumulado
  llamadas: LlamadaRegistrada[]
}

interface Entrada {
  client: Pick<Anthropic, "messages">
  system: string
  historial: Anthropic.MessageParam[]
  /** El mensaje del usuario tal como se manda al modelo (con el contexto de fecha incluido). */
  mensaje: string
  herramientas: readonly Herramienta[]
  ctx: ContextoHerramienta
  /** Si viene, cada ronda se pide en streaming y se avisa el texto y las herramientas a medida que llegan. */
  alEvento?: (evento: EventoAsistente) => void
}

function sumarUso(acc: UsoAcumulado, u: Anthropic.Usage) {
  acc.input_tokens += u.input_tokens
  acc.output_tokens += u.output_tokens
  acc.cache_read_input_tokens += u.cache_read_input_tokens ?? 0
  acc.cache_creation_input_tokens += u.cache_creation_input_tokens ?? 0
}

function textoDe(response: Anthropic.Message): string {
  // Leer por tipo: con thinking activado la respuesta puede empezar con bloques `thinking`.
  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim()
}

type ParamsMensaje = Anthropic.MessageCreateParamsNonStreaming

/**
 * Una ronda. En streaming el resultado es el mismo mensaje final (`finalMessage`); solo cambia que
 * el texto y el nombre de cada herramienta se avisan apenas empiezan a llegar.
 */
async function pedirRonda(
  client: Pick<Anthropic, "messages">,
  params: ParamsMensaje,
  alEvento: ((e: EventoAsistente) => void) | undefined,
  etiquetas: Map<string, string>,
  separarDelTextoAnterior: boolean
): Promise<Anthropic.Message> {
  if (!alEvento) return client.messages.create(params)
  const stream = client.messages.stream(params)
  let primerTexto = true
  for await (const evento of stream) {
    if (evento.type === "content_block_start" && evento.content_block.type === "tool_use") {
      const nombre = evento.content_block.name
      alEvento({ tipo: "herramienta", nombre, etiqueta: etiquetas.get(nombre) ?? ETIQUETA_GENERICA })
    } else if (evento.type === "content_block_delta" && evento.delta.type === "text_delta" && evento.delta.text) {
      // El texto de una ronda nueva va en un párrafo aparte del de la anterior.
      const delta = primerTexto && separarDelTextoAnterior ? `\n\n${evento.delta.text}` : evento.delta.text
      primerTexto = false
      alEvento({ tipo: "texto", delta })
    }
  }
  return stream.finalMessage()
}

async function ejecutarLlamada(
  bloque: Anthropic.ToolUseBlock,
  porNombre: Map<string, Herramienta>,
  ctx: ContextoHerramienta,
  llamadas: LlamadaRegistrada[]
): Promise<Anthropic.ToolResultBlockParam> {
  const inicio = Date.now()
  const herramienta = porNombre.get(bloque.name)
  if (!herramienta) {
    llamadas.push({ nombre: bloque.name, input: bloque.input, filas: 0, ms: 0, error: "no disponible" })
    return { type: "tool_result", tool_use_id: bloque.id, is_error: true, content: "Esta herramienta no está disponible para este usuario." }
  }
  try {
    const { datos, filas } = await herramienta.ejecutar(bloque.input, ctx)
    llamadas.push({ nombre: bloque.name, input: bloque.input, filas, ms: Date.now() - inicio })
    return { type: "tool_result", tool_use_id: bloque.id, content: JSON.stringify(datos) }
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : "error"
    llamadas.push({ nombre: bloque.name, input: bloque.input, filas: 0, ms: Date.now() - inicio, error: mensaje })
    // Al modelo, un texto genérico: el detalle interno queda solo en el registro.
    return { type: "tool_result", tool_use_id: bloque.id, is_error: true, content: "No se pudo consultar ese dato. Sugerí revisarlo en la pantalla correspondiente." }
  }
}

/**
 * Bucle de herramientas: el modelo pide datos, STApp los busca con los permisos del usuario y se
 * los devuelve, hasta que responde con texto. Las herramientas son de solo lectura.
 */
export async function ejecutarAsistente({ client, system, historial, mensaje, herramientas, ctx, alEvento }: Entrada): Promise<ResultadoAsistente> {
  const uso: UsoAcumulado = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  const llamadas: LlamadaRegistrada[] = []
  const porNombre = new Map(herramientas.map((h) => [h.definicion.name, h]))
  const etiquetas = new Map(herramientas.flatMap((h) => (h.etiqueta ? [[h.definicion.name, h.etiqueta] as const] : [])))
  // Texto de todas las rondas: si el modelo escribe algo antes de consultar ("Busco la orden…"),
  // queda en la respuesta igual que se vio en pantalla.
  const textos: string[] = []
  const textoFinal = () => textos.join("\n\n")
  const tools = definiciones(herramientas)
  const messages: Anthropic.MessageParam[] = [...historial, { role: "user", content: mensaje }]

  for (let ronda = 0; ronda <= MAX_RONDAS; ronda++) {
    const ultimaRonda = ronda === MAX_RONDAS
    const response = await pedirRonda(client, {
      model: ASISTENTE_MODEL,
      max_tokens: MAX_TOKENS,
      output_config: { effort: EFFORT },
      // Las herramientas van antes del system en el prefijo: el breakpoint cachea ambos.
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      ...(tools.length > 0 && {
        tools,
        // En la última ronda ya no se permiten más consultas: responder con lo que haya.
        ...(ultimaRonda && { tool_choice: { type: "none" as const } }),
      }),
      messages,
    }, alEvento, etiquetas, textos.length > 0)
    sumarUso(uso, response.usage)
    const texto = textoDe(response)
    if (texto) textos.push(texto)

    if (response.stop_reason === "refusal") {
      return { texto: RESPUESTA_RECHAZADA, uso, llamadas }
    }

    if (response.stop_reason !== "tool_use" || ultimaRonda) {
      return { texto: textoFinal() || RESPUESTA_FALLIDA, uso, llamadas }
    }

    // El turno del asistente vuelve completo (incluidos los bloques de thinking, sin tocar).
    messages.push({ role: "assistant", content: response.content })
    const pedidos = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
    // Todas las respuestas en un solo mensaje, aunque se ejecuten en paralelo.
    const resultados = await Promise.all(pedidos.map((b) => ejecutarLlamada(b, porNombre, ctx, llamadas)))
    messages.push({ role: "user", content: resultados })
  }

  return { texto: textoFinal() || RESPUESTA_FALLIDA, uso, llamadas }
}
