/**
 * Template resolver con KILL SWITCH.
 *
 * Reglas:
 *  - Si la fila DB existe, status='PUBLISHED' y html_body != '' → usa DB (interpolando vars).
 *  - Si la fila DB existe, status='PUBLISHED' pero html_body='' → llama fallback() si está provisto.
 *  - Si la fila NO existe, o status='DRAFT'/'ARCHIVED' → retorna null (BLOQUEA envío).
 *
 * El caller (cron) DEBE chequear `null` y skipear el envío, logueando con
 * status='SKIPPED_DRAFT' en lifecycle_emails. NO debe llamar a envialosimple
 * si esta función retorna null.
 */
import { supabaseAdmin } from "@/lib/supabase"

const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "stapp.com.ar"

export type ResolveTemplateData = {
  nombre?: string
  organizacion?: string
  slug?: string
  diasRestantes?: number
  milestone?: { tipo: string; valor: number }
  appUrl?: string
  reactivarUrl?: string
  billingUrl?: string
  accountAgeDays?: number
  // permite overrides ad-hoc
  [key: string]: unknown
}

export type ResolvedTemplate = {
  subject: string
  html: string
  source: "db" | "hardcoded"
}

export type ResolveResult = ResolvedTemplate | null

export type TemplateFallback = () => { subject: string; html: string }

/**
 * Interpola variables {{var}} en un string. Soporta nested dot-access
 * (ej: {{milestone.tipo}}).
 */
function interpolate(input: string, data: Record<string, unknown>): string {
  return input.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key: string) => {
    const parts = key.split(".")
    let cur: unknown = data
    for (const p of parts) {
      if (cur && typeof cur === "object" && p in (cur as Record<string, unknown>)) {
        cur = (cur as Record<string, unknown>)[p]
      } else {
        return ""
      }
    }
    if (cur === null || cur === undefined) return ""
    return String(cur)
  })
}

/**
 * Resuelve el template para `type`. Retorna null si está en DRAFT/ARCHIVED
 * o si no hay fila + no hay fallback.
 *
 * @param type   Tipo de email (matchea email_templates.type)
 * @param data   Datos para interpolar variables
 * @param fallback  Función que produce {subject, html} si la fila publicada
 *                  no tiene cuerpo (seed con html_body=''). Si no se provee
 *                  y el cuerpo está vacío → null (BLOQUEA).
 */
export async function resolveTemplate(
  type: string,
  data: ResolveTemplateData,
  fallback?: TemplateFallback
): Promise<ResolveResult> {
  // Calcular defaults derivados
  const slug = data.slug || ""
  const appUrl = data.appUrl || (slug ? `https://${slug}.${ROOT_DOMAIN}` : `https://${ROOT_DOMAIN}`)
  const reactivarUrl = data.reactivarUrl || `${appUrl}/reactivar`
  const billingUrl = data.billingUrl || `${appUrl}/configuracion/billing`

  const enrichedData: Record<string, unknown> = {
    ...data,
    appUrl,
    reactivarUrl,
    billingUrl,
  }

  try {
    const { data: row, error } = await supabaseAdmin
      .from("email_templates")
      .select("type,status,subject,html_body")
      .eq("type", type)
      .maybeSingle()

    if (error) {
      console.error(`[resolveTemplate] DB error reading ${type}:`, error.message)
      return null
    }

    // Sin fila en DB → BLOQUEAR
    if (!row) {
      console.warn(`[resolveTemplate] No row for type=${type} → BLOCKED (sin fila)`)
      return null
    }

    // Status NO PUBLISHED → BLOQUEAR
    if (row.status !== "PUBLISHED") {
      console.warn(`[resolveTemplate] type=${type} status=${row.status} → BLOCKED`)
      return null
    }

    // PUBLISHED con cuerpo → usar DB
    if (row.html_body && row.html_body.trim() !== "") {
      return {
        subject: interpolate(row.subject || "", enrichedData),
        html: interpolate(row.html_body, enrichedData),
        source: "db",
      }
    }

    // PUBLISHED con cuerpo vacío → fallback hardcoded (si existe)
    if (fallback) {
      const fb = fallback()
      return { subject: fb.subject, html: fb.html, source: "hardcoded" }
    }

    // Sin fallback y sin cuerpo → BLOQUEAR
    console.warn(`[resolveTemplate] type=${type} PUBLISHED pero html_body vacío y sin fallback → BLOCKED`)
    return null
  } catch (err) {
    console.error(`[resolveTemplate] Excepción resolviendo ${type}:`, err)
    return null
  }
}

/**
 * Helper para chequear el estado de un template sin renderizarlo.
 */
export async function getTemplateStatus(type: string): Promise<{
  exists: boolean
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED" | null
  hasBody: boolean
}> {
  try {
    const { data: row } = await supabaseAdmin
      .from("email_templates")
      .select("status,html_body")
      .eq("type", type)
      .maybeSingle()
    if (!row) return { exists: false, status: null, hasBody: false }
    return {
      exists: true,
      status: row.status as "DRAFT" | "PUBLISHED" | "ARCHIVED",
      hasBody: !!(row.html_body && row.html_body.trim() !== ""),
    }
  } catch {
    return { exists: false, status: null, hasBody: false }
  }
}
