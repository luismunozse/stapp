import { NextResponse } from "next/server"
import { timingSafeEqual } from "crypto"
import { supabaseAdmin } from "@/lib/supabase"

/**
 * Longitud esperada del public_token (16 bytes -> 32 hex chars).
 * Centralizada acá para que todos los endpoints públicos usen la misma
 * regla en vez de hardcodearla.
 */
export const PUBLIC_TOKEN_LENGTH = 32

/**
 * Verifica si dos tokens son iguales en tiempo constante.
 * Usado para defensa contra timing attacks cuando comparamos un token
 * provisto por el usuario con uno almacenado.
 */
export function publicTokensMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b))
  } catch {
    return false
  }
}

/**
 * Valida un public_token y devuelve la orden con los campos pedidos.
 *
 * Garantías de seguridad de este helper (todos los endpoints públicos
 * `/api/public/ordenes/[token]/...` deberían pasar por acá):
 *
 *  1. Valida formato del token (longitud fija). Tokens más cortos o
 *     vacíos se rechazan antes de tocar la BD.
 *  2. Busca por `public_token` con `.not("public_token", "is", null)`
 *     para asegurar que ningún registro con token null pueda ser
 *     accidentalmente accedido (ej. orden vieja sin token migrado).
 *  3. Valida `public_token_expires_at` SIEMPRE, agregando la columna
 *     al select internamente. Antes el helper leía la columna pero
 *     dependía del caller para incluirla en el select — y ningún caller
 *     lo hacía, por lo que la verificación de expiración nunca corría.
 *
 * Use `select` para especificar campos/relaciones adicionales a pedir.
 * NO hace falta incluir `id`, `organization_id`, `public_token` ni
 * `public_token_expires_at` — se agregan automáticamente.
 */
export async function getOrderByPublicToken(
  token: string,
  select: string = ""
): Promise<{ orden: any; error: null } | { orden: null; error: NextResponse }> {
  if (!token || token.length !== PUBLIC_TOKEN_LENGTH) {
    return {
      orden: null,
      error: NextResponse.json({ error: "Token inválido" }, { status: 400 }),
    }
  }

  // Garantizar que las columnas de seguridad SIEMPRE estén presentes,
  // independientemente de lo que el caller haya pedido. Si el caller ya
  // las incluyó, no es problema (Supabase deduplica).
  const requiredCols = "id, organization_id, public_token, public_token_expires_at"
  const finalSelect = select.trim() ? `${requiredCols}, ${select.trim()}` : requiredCols

  const { data: orden, error: dbError } = await supabaseAdmin
    .from("ordenes_servicio")
    .select(finalSelect)
    .eq("public_token", token)
    .not("public_token", "is", null)
    .single()

  if (dbError || !orden) {
    return {
      orden: null,
      error: NextResponse.json({ error: "Orden no encontrada" }, { status: 404 }),
    }
  }

  // Defensa adicional: comparar el token devuelto con el provisto en
  // tiempo constante. Si por alguna razón Postgres devolvió otro registro
  // (no debería pasar con `.eq` + `.single`), abortamos.
  const ordenRecord = orden as unknown as Record<string, unknown>
  const storedToken = ordenRecord.public_token as string | null
  if (!storedToken || !publicTokensMatch(storedToken, token)) {
    return {
      orden: null,
      error: NextResponse.json({ error: "Orden no encontrada" }, { status: 404 }),
    }
  }

  // Verificar expiración del token público.
  const expiresAt = ordenRecord.public_token_expires_at as string | null
  if (expiresAt && new Date(expiresAt) < new Date()) {
    return {
      orden: null,
      error: NextResponse.json({ error: "El enlace de seguimiento ha expirado" }, { status: 410 }),
    }
  }

  return { orden, error: null }
}
