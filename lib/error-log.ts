import { createHash, randomBytes } from "node:crypto"
import { supabaseAdmin } from "@/lib/supabase"
import { escapeHtml } from "@/lib/escape-html"

/**
 * Registro central de errores (tabla `error_logs`, migración 423).
 *
 * Antes un error inesperado solo quedaba en los logs de Vercel o en la consola
 * del navegador del taller: nadie se enteraba hasta que el taller escribía a
 * soporte, y soporte no tenía con qué buscarlo.
 *
 * Reglas de este módulo:
 *  - NUNCA lanza. Registrar un error no puede romper la request que lo sufrió.
 *  - No guarda cuerpos de requests ni datos de clientes: mensaje, stack, ruta.
 *  - Cada error tiene un `ref` corto ("E-4F7K2Q") que se le muestra al usuario.
 *  - Los errores repetidos (mismo `fingerprint`) disparan UN mail al superadmin.
 */

export type ErrorSource = "API" | "SERVER" | "CLIENT" | "CRON" | "WEBHOOK"

export interface RegistrarErrorInput {
  source: ErrorSource
  error: unknown
  /** Código ya mostrado al usuario; si falta se genera uno. */
  ref?: string
  route?: string | null
  method?: string | null
  status?: number | null
  organizationId?: string | null
  userId?: string | null
  tenantSlug?: string | null
  digest?: string | null
  userAgent?: string | null
  context?: Record<string, unknown> | null
}

const MAX_MESSAGE = 2000
const MAX_STACK = 8000
const MAX_CONTEXT = 4000

/** Cuántas veces en la ventana tiene que repetirse un error para avisar. */
export const ALERTA_UMBRAL = 5
const ALERTA_VENTANA_MS = 60 * 60 * 1000
/** No se vuelve a avisar del mismo error hasta pasado este tiempo. */
const ALERTA_SILENCIO_MS = 6 * 60 * 60 * 1000

// Sin 0/O/1/I: el taller lo dicta por teléfono o lo copia de una captura.
const ALFABETO_REF = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"

/** Código corto para que el usuario se lo pase a soporte. */
export function generarRef(): string {
  const bytes = randomBytes(6)
  let out = ""
  for (const b of bytes) out += ALFABETO_REF[b % ALFABETO_REF.length]
  return `E-${out}`
}

export function esRefValido(valor: unknown): valor is string {
  return typeof valor === "string" && /^E-[2-9A-HJ-NP-Z]{6}$/.test(valor)
}

interface ErrorNormalizado {
  message: string
  stack: string | null
  digest: string | null
}

export function normalizarError(error: unknown): ErrorNormalizado {
  if (error instanceof Error) {
    const digest = (error as { digest?: unknown }).digest
    return {
      message: error.message || error.name || "Error sin mensaje",
      stack: error.stack ?? null,
      digest: typeof digest === "string" ? digest : null,
    }
  }
  if (typeof error === "string") return { message: error, stack: null, digest: null }
  if (error && typeof error === "object") {
    // Errores de Supabase/PostgREST: objetos planos { message, code, details, hint }.
    const e = error as Record<string, unknown>
    const partes = [e.code, e.message, e.details, e.hint].filter(
      (p): p is string => typeof p === "string" && p.trim() !== ""
    )
    if (partes.length > 0) return { message: partes.join(" | "), stack: null, digest: null }
    try {
      return { message: JSON.stringify(error), stack: null, digest: null }
    } catch {
      return { message: "Error no serializable", stack: null, digest: null }
    }
  }
  return { message: String(error), stack: null, digest: null }
}

/**
 * Agrupa repeticiones del mismo error. Se sacan los valores que cambian entre
 * ocurrencias (ids, números, fechas) para que "orden 123 no existe" y "orden
 * 456 no existe" cuenten como el mismo problema.
 */
export function calcularFingerprint(source: string, route: string | null | undefined, message: string): string {
  const normalizado = message
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<id>")
    .replace(/\b[a-z0-9]{20,}\b/g, "<id>")
    .replace(/\d+/g, "<n>")
    .slice(0, 300)
  const ruta = (route ?? "").split("?")[0]
  return createHash("sha256").update(`${source}|${ruta}|${normalizado}`).digest("hex").slice(0, 32)
}

function recortar(valor: string | null | undefined, max: number): string | null {
  if (!valor) return null
  return valor.length > max ? `${valor.slice(0, max)}…` : valor
}

function contextoSeguro(context: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!context) return null
  try {
    const json = JSON.stringify(context)
    if (json.length <= MAX_CONTEXT) return JSON.parse(json)
    return { recortado: json.slice(0, MAX_CONTEXT) }
  } catch {
    return null
  }
}

/** En los tests no se escribe ni se manda mail salvo que el test lo pida. */
export function registroDeshabilitado(): boolean {
  if (process.env.ERROR_LOG_FORCE === "1") return false
  return process.env.NODE_ENV === "test" || !!process.env.VITEST
}

/**
 * Guarda el error y devuelve su `ref`. Nunca lanza: si la tabla no existe o la
 * base no responde, el error queda en `console.error` como siempre.
 */
export async function registrarError(input: RegistrarErrorInput): Promise<string> {
  const ref = esRefValido(input.ref) ? input.ref : generarRef()
  try {
    const norm = normalizarError(input.error)
    const message = recortar(norm.message, MAX_MESSAGE) ?? "Error sin mensaje"
    const fingerprint = calcularFingerprint(input.source, input.route, message)

    if (registroDeshabilitado()) return ref

    console.error(
      `[error-log] ${ref} ${input.source} ${input.method ?? ""} ${input.route ?? ""}: ${message}`.replace(/\s+/g, " ")
    )

    const { error: insertError } = await supabaseAdmin.from("error_logs").insert({
      source: input.source,
      ref,
      fingerprint,
      digest: input.digest ?? norm.digest,
      route: recortar(input.route, 500),
      method: input.method ?? null,
      status: input.status ?? null,
      organization_id: input.organizationId ?? null,
      user_id: input.userId ?? null,
      tenant_slug: input.tenantSlug ?? null,
      message,
      stack: recortar(norm.stack, MAX_STACK),
      context: contextoSeguro(input.context),
      user_agent: recortar(input.userAgent, 400),
    })

    if (insertError) {
      console.error("[error-log] no se pudo guardar el error:", insertError.message ?? insertError)
      return ref
    }

    await alertarSiSeRepite({ fingerprint, ref, source: input.source, route: input.route ?? null, message })
  } catch (e) {
    console.error("[error-log] fallo registrando el error:", e)
  }
  return ref
}

async function alertarSiSeRepite(p: {
  fingerprint: string
  ref: string
  source: string
  route: string | null
  message: string
}): Promise<void> {
  const destino = process.env.SUPERADMIN_EMAIL
  if (!destino) return

  const ahora = Date.now()
  const { data: recientes, error } = await supabaseAdmin
    .from("error_logs")
    .select("id, alerted_at, organization_id, occurred_at")
    .eq("fingerprint", p.fingerprint)
    .gte("occurred_at", new Date(ahora - ALERTA_SILENCIO_MS).toISOString())
    .order("occurred_at", { ascending: false })
    .limit(200)

  if (error || !recientes) return
  if (recientes.some((r) => r.alerted_at)) return

  const desde = ahora - ALERTA_VENTANA_MS
  const enVentana = recientes.filter((r) => new Date(r.occurred_at).getTime() >= desde)
  if (enVentana.length < ALERTA_UMBRAL) return

  // Marcar ANTES de mandar: dos requests simultáneas no mandan dos mails.
  const { data: marcado } = await supabaseAdmin
    .from("error_logs")
    .update({ alerted_at: new Date(ahora).toISOString() })
    .eq("fingerprint", p.fingerprint)
    .eq("ref", p.ref)
    .is("alerted_at", null)
    .select("id")
  if (!marcado || marcado.length === 0) return

  const talleres = new Set(enVentana.map((r) => r.organization_id).filter(Boolean)).size
  const { sendPlatform } = await import("@/lib/email/index")
  await sendPlatform({
    to: destino,
    subject: `[STApp] Error repetido ${enVentana.length}x — ${p.source} ${p.route ?? ""}`.trim(),
    html:
      `<p>El mismo error ocurrió <strong>${enVentana.length}</strong> veces en la última hora` +
      (talleres > 0 ? `, en <strong>${talleres}</strong> taller(es)` : "") +
      `.</p>` +
      `<p><strong>Origen:</strong> ${escapeHtml(p.source)} ${escapeHtml(p.route ?? "")}</p>` +
      `<p><strong>Mensaje:</strong> ${escapeHtml(p.message)}</p>` +
      `<p><strong>Último código:</strong> ${escapeHtml(p.ref)}</p>` +
      `<p>Detalle: <code>node scripts/errores-recientes.mjs ${escapeHtml(p.ref)}</code></p>` +
      `<p>No se vuelve a avisar de este error por ${ALERTA_SILENCIO_MS / 3600000} horas.</p>`,
  })
}
