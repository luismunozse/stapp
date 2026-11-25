import { NextResponse } from "next/server"
import { z } from "zod"
import { safeParseBody } from "@/lib/api-utils"
import { getAuthSession } from "@/lib/auth-utils"
import { esRefValido, registrarError } from "@/lib/error-log"

/**
 * Recibe los errores que reportan las pantallas de error del navegador
 * (app/error.tsx, app/(dashboard)/error.tsx, app/global-error.tsx).
 *
 * Es pública a propósito: una pantalla puede romperse antes de que haya
 * sesión (login, seguimiento público). Por eso todo lo que llega se trata como
 * texto no confiable: tamaños acotados, sin HTML, y el límite de requests por
 * IP de /api/public lo aplica el proxy. Si hay sesión se anota el taller.
 */
const schema = z.object({
  ref: z.string().max(16).optional(),
  origen: z.string().max(60),
  message: z.string().min(1).max(2000),
  stack: z.string().max(8000).optional(),
  digest: z.string().max(100).optional(),
  url: z.string().max(500).optional(),
})

export async function POST(request: Request) {
  const parsed = await safeParseBody(request, schema)
  if ("error" in parsed) return parsed.error
  const { ref, origen, message, stack, digest, url } = parsed.data

  let organizationId: string | null = null
  let userId: string | null = null
  try {
    const s = await getAuthSession()
    organizationId = s.organizationId ?? null
    userId = s.userId ?? null
  } catch {
    // sin sesión se registra igual
  }

  const error = new Error(message)
  error.stack = stack

  const guardado = await registrarError({
    source: "CLIENT",
    error,
    ref: esRefValido(ref) ? ref : undefined,
    route: url ?? null,
    digest: digest ?? null,
    organizationId,
    userId,
    tenantSlug: request.headers.get("x-tenant-slug"),
    userAgent: request.headers.get("user-agent"),
    context: { origen },
  })

  return NextResponse.json({ ok: true, ref: guardado })
}
