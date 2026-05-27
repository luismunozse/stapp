import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { revalidateCatalogo } from "@/lib/catalogo/revalidate"

/**
 * Endpoint manual para forzar invalidación de todo el cache del catálogo
 * público de la org. Útil cuando hay sospecha de que la invalidación
 * automática (post-mutación) no propagó por algún motivo (Edge cache,
 * proxy intermedio, etc.).
 *
 * Uso: POST /api/catalogo/force-revalidate
 */
export async function POST() {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  await revalidateCatalogo(auth.organizationId!)
  return NextResponse.json({ ok: true, ts: new Date().toISOString() })
}
