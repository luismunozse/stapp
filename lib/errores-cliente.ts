/**
 * Manejo de errores del lado del navegador. Sin imports de servidor.
 *
 * Un solo lugar decide qué se le dice al usuario cuando una llamada falla, en
 * vez de un "Error al guardar" distinto (o ninguno) en cada pantalla:
 *
 *   const r = await apiFetch<Orden>("/api/ordenes", { method: "POST", body })
 *   if (!r.ok) return toast.error(r.mensaje)
 *
 * o, en código que ya usa fetch:
 *
 *   if (!res.ok) return toast.error(await leerError(res, "No se pudo guardar"))
 *   ...
 *   } catch (e) { toast.error(mensajeDeExcepcion(e, "No se pudo guardar")) }
 */

const ALFABETO_REF = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"

/** Mismo formato que el servidor (lib/error-log.ts): "E-4F7K2Q". */
export function generarRefCliente(): string {
  let out = ""
  const bytes = new Uint8Array(6)
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(bytes)
  else for (let i = 0; i < 6; i++) bytes[i] = Math.floor(Math.random() * 256)
  for (const b of bytes) out += ALFABETO_REF[b % ALFABETO_REF.length]
  return `E-${out}`
}

export const MENSAJE_SIN_CONEXION =
  "No hay conexión con el servidor. Revisá tu internet e intentá de nuevo."

function sinConexion(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false
}

/** Mensaje para una excepción de `fetch` (la request no llegó o se cortó). */
export function mensajeDeExcepcion(error: unknown, fallback = "No se pudo completar la operación"): string {
  if (sinConexion()) return MENSAJE_SIN_CONEXION
  const e = error as { name?: string; message?: string } | null
  if (e?.name === "AbortError" || e?.name === "TimeoutError") {
    return "La operación tardó demasiado. Revisá si se guardó antes de intentar de nuevo."
  }
  // fetch rechaza con TypeError cuando no hay red, hay CORS o el servidor cortó.
  if (e?.name === "TypeError" || /failed to fetch|networkerror|load failed/i.test(e?.message ?? "")) {
    return MENSAJE_SIN_CONEXION
  }
  return `${fallback}. Intentá de nuevo.`
}

/**
 * Mensaje para lo que cae en un `catch` de pantalla. Distingue lo que el
 * código lanzó a propósito (`throw new Error("El cliente ya existe")`, que se
 * muestra tal cual) de las fallas técnicas, cuyo texto no le sirve al usuario
 * ("Failed to fetch", "Unexpected token < in JSON").
 */
export function mensajeDeError(error: unknown, fallback = "No se pudo completar la operación"): string {
  if (sinConexion()) return MENSAJE_SIN_CONEXION
  const e = error as { name?: string; message?: string } | null
  const msg = typeof e?.message === "string" ? e.message.trim() : ""
  if (e?.name === "AbortError" || e?.name === "TimeoutError") return mensajeDeExcepcion(error, fallback)
  if (e?.name === "TypeError" && /fetch|network|load failed/i.test(msg)) return MENSAJE_SIN_CONEXION
  // El servidor respondió algo que no era JSON (un 500 en HTML, un timeout del proxy).
  if (e?.name === "SyntaxError" || /unexpected token|json/i.test(msg)) {
    return `${fallback.replace(/\.$/, "")}. Tuvimos un problema de nuestro lado; intentá de nuevo.`
  }
  return msg || fallback
}

interface CuerpoError {
  error?: unknown
  message?: unknown
  code?: unknown
  ref?: unknown
  details?: unknown
}

function texto(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null
}

function detalleDeCampos(details: unknown): string | null {
  if (!details || typeof details !== "object") return null
  const partes: string[] = []
  for (const [campo, errores] of Object.entries(details as Record<string, unknown>)) {
    const primero = Array.isArray(errores) ? texto(errores[0]) : texto(errores)
    if (primero) partes.push(`${campo}: ${primero}`)
    if (partes.length === 3) break
  }
  return partes.length ? partes.join(" · ") : null
}

/**
 * Mensaje para una respuesta con status de error. `body` es el JSON ya leído
 * (o `null` si no era JSON).
 */
export function mensajeDeRespuesta(
  status: number,
  body: CuerpoError | null | undefined,
  fallback = "No se pudo completar la operación"
): string {
  const delServidor = texto(body?.error) ?? texto(body?.message)
  const code = texto(body?.code)
  const ref = texto(body?.ref)

  if (status === 401) {
    return code === "SESSION_STALE"
      ? "Tu sesión cambió. Volvé a iniciar sesión."
      : "Tu sesión venció. Volvé a iniciar sesión."
  }
  if (status === 402 || code === "SUBSCRIPTION_REQUIRED") {
    return "La suscripción del taller no está activa. Renovála en Configuración → Suscripción para seguir operando."
  }
  if (status === 403) return delServidor ?? "No tenés permiso para hacer esto."
  if (status === 404) return delServidor ?? "No encontramos lo que buscabas. Puede que lo hayan borrado."
  if (status === 413) return "El archivo es demasiado grande."
  if (status === 429) return "Demasiadas solicitudes seguidas. Esperá un momento e intentá de nuevo."

  if (status >= 500) {
    // El mensaje de un 5xx puede ser interno: solo se muestra si vino con `ref`
    // (lo armó respuestaError, que ya lo dejó entendible).
    const base = ref && delServidor ? delServidor : `${fallback}. Tuvimos un problema de nuestro lado; intentá de nuevo.`
    return ref ? `${base} Si sigue pasando, pasale a soporte el código ${ref}.` : base
  }

  // 400 / 409 / 422: errores de validación o de negocio, el servidor explica.
  if (delServidor) {
    const campos = delServidor === "Datos inválidos" ? detalleDeCampos(body?.details) : null
    return campos ? `Datos inválidos — ${campos}` : delServidor
  }
  return `${fallback}.`
}

async function leerCuerpo(res: Response): Promise<CuerpoError | null> {
  try {
    const ct = res.headers.get("content-type") ?? ""
    if (!ct.includes("json")) return null
    return (await res.json()) as CuerpoError
  } catch {
    return null
  }
}

/** Lee el cuerpo de una respuesta fallida y devuelve el mensaje para el usuario. */
export async function leerError(res: Response, fallback?: string): Promise<string> {
  return mensajeDeRespuesta(res.status, await leerCuerpo(res), fallback)
}

export type ResultadoApi<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; mensaje: string; status: number; code: string | null; ref: string | null; body: unknown }

/**
 * `fetch` que nunca lanza y siempre devuelve un mensaje listo para mostrar.
 * `status: 0` significa que la request no llegó al servidor.
 */
export async function apiFetch<T = unknown>(
  url: string,
  init?: RequestInit & { fallback?: string }
): Promise<ResultadoApi<T>> {
  const { fallback, ...opciones } = init ?? {}
  let res: Response
  try {
    res = await fetch(url, opciones)
  } catch (e) {
    return { ok: false, mensaje: mensajeDeExcepcion(e, fallback), status: 0, code: null, ref: null, body: null }
  }

  const body = await leerCuerpo(res)
  if (res.ok) return { ok: true, data: body as T, status: res.status }
  return {
    ok: false,
    mensaje: mensajeDeRespuesta(res.status, body, fallback),
    status: res.status,
    code: texto(body?.code),
    ref: texto(body?.ref),
    body,
  }
}

// ── Reporte de errores de pantalla ─────────────────────────────────────────

const yaReportados = new Set<string>()

/**
 * Avisa al servidor de un error de pantalla y devuelve el código para mostrar.
 * Nunca lanza; no reporta dos veces el mismo error en la misma carga.
 */
export function reportarErrorCliente(
  error: (Error & { digest?: string }) | unknown,
  origen: string,
  /** Código ya mostrado en pantalla; si falta se genera uno. */
  refExistente?: string
): string {
  const ref = refExistente ?? generarRefCliente()
  try {
    const e = error as { message?: string; stack?: string; digest?: string; name?: string } | null
    const clave = `${origen}|${e?.digest ?? ""}|${e?.message ?? ""}`
    if (yaReportados.has(clave)) return ref
    yaReportados.add(clave)

    void fetch("/api/public/client-errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        ref,
        origen,
        message: String(e?.message ?? e?.name ?? error ?? "Error sin mensaje").slice(0, 2000),
        stack: e?.stack ? String(e.stack).slice(0, 8000) : undefined,
        digest: e?.digest,
        url: typeof location !== "undefined" ? location.pathname : undefined,
      }),
    }).catch(() => {})
  } catch {
    // reportar nunca puede romper la pantalla de error
  }
  return ref
}
