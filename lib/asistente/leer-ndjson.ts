/**
 * Lee una respuesta NDJSON (una línea JSON por evento) a medida que llega. Una línea que no es
 * JSON válido se descarta: el evento `fin` trae el texto completo, así que perder un delta no
 * deja la respuesta incompleta.
 */
export async function* leerNdjson<T = Record<string, unknown>>(body: ReadableStream<Uint8Array>): AsyncGenerator<T> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let pendiente = ""
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      pendiente += decoder.decode(value, { stream: true })
      const lineas = pendiente.split("\n")
      pendiente = lineas.pop() ?? ""
      for (const linea of lineas) {
        const evento = parsear<T>(linea)
        if (evento) yield evento
      }
    }
    pendiente += decoder.decode()
    const ultimo = parsear<T>(pendiente)
    if (ultimo) yield ultimo
  } finally {
    reader.releaseLock()
  }
}

function parsear<T>(linea: string): T | null {
  if (!linea.trim()) return null
  try {
    return JSON.parse(linea) as T
  } catch {
    return null
  }
}
