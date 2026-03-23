import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

/**
 * Validates a public token and returns the order with the requested fields.
 * Use `select` to specify additional fields/relations needed.
 */
export async function getOrderByPublicToken(
  token: string,
  select: string = "id, organization_id"
): Promise<{ orden: any; error: null } | { orden: null; error: NextResponse }> {
  if (!token || token.length !== 32) {
    return {
      orden: null,
      error: NextResponse.json({ error: "Token inválido" }, { status: 400 }),
    }
  }

  const { data: orden, error: dbError } = await supabaseAdmin
    .from("ordenes_servicio")
    .select(select)
    .eq("public_token", token)
    .single()

  if (dbError || !orden) {
    return {
      orden: null,
      error: NextResponse.json({ error: "Orden no encontrada" }, { status: 404 }),
    }
  }

  // Verificar expiración del token público (columna puede no existir si migración 068 no se ejecutó)
  const expiresAt = (orden as any).public_token_expires_at
  if (expiresAt && new Date(expiresAt) < new Date()) {
    return {
      orden: null,
      error: NextResponse.json({ error: "El enlace de seguimiento ha expirado" }, { status: 410 }),
    }
  }

  return { orden, error: null }
}
