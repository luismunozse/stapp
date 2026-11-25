import { NextResponse, after } from "next/server"
import { headers } from "next/headers"
import { generarRef, registrarError, registroDeshabilitado, type ErrorSource } from "@/lib/error-log"

/**
 * Errores inesperados en rutas de API.
 *
 * Dos usos:
 *
 *   } catch (error) {
 *     return respuestaError(error, { ruta: "/api/ordenes", mensaje: "Error al crear la orden" })
 *   }
 *
 * devuelve `{ error, ref }` con status 500, sin filtrar el mensaje interno
 * (el de Postgres, el de un SDK), y registra el detalle en `error_logs`.
 *
 *   reportarError(error, { ruta: "/api/ordenes" })
 *
 * solo registra, para las rutas que ya arman su propia respuesta.
 *
 * El registro corre DESPUÉS de responder (`after`): no le suma latencia al
 * usuario, y en serverless no se corta al devolver la respuesta.
 */

export interface ContextoError {
  /** Ruta de la API, como en el filesystem: "/api/ordenes/[id]". */
  ruta: string
  source?: ErrorSource
  metodo?: string
  organizationId?: string | null
  userId?: string | null
  context?: Record<string, unknown>
}

async function datosDeRequest(): Promise<{ tenantSlug: string | null; userAgent: string | null }> {
  try {
    const h = await headers()
    return { tenantSlug: h.get("x-tenant-slug"), userAgent: h.get("user-agent") }
  } catch {
    return { tenantSlug: null, userAgent: null }
  }
}

/** Registra el error sin bloquear la respuesta. Devuelve el código de referencia. */
export function reportarError(error: unknown, ctx: ContextoError): string {
  const ref = generarRef()
  if (registroDeshabilitado()) return ref
  const tarea = async () => {
    const req = await datosDeRequest()
    await registrarError({
      source: ctx.source ?? "API",
      error,
      ref,
      route: ctx.ruta,
      method: ctx.metodo ?? null,
      status: 500,
      organizationId: ctx.organizationId ?? null,
      userId: ctx.userId ?? null,
      tenantSlug: req.tenantSlug,
      userAgent: req.userAgent,
      context: ctx.context ?? null,
    })
  }
  try {
    after(tarea)
  } catch {
    // Fuera del scope de una request (tests, scripts): se registra igual.
    void tarea().catch(() => {})
  }
  return ref
}

/** Mensaje que ve el usuario cuando no hay uno más específico. */
export const MENSAJE_ERROR_GENERICO = "Tuvimos un problema procesando la solicitud. Intentá de nuevo."

/**
 * Respuesta 500 segura: mensaje entendible + código de referencia. El detalle
 * técnico va a `error_logs`, nunca al cliente.
 */
export function respuestaError(
  error: unknown,
  ctx: ContextoError & { mensaje?: string; status?: number }
): NextResponse {
  const ref = reportarError(error, ctx)
  return NextResponse.json(
    { error: ctx.mensaje ?? MENSAJE_ERROR_GENERICO, ref },
    { status: ctx.status ?? 500 }
  )
}
