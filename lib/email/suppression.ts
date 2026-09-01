import { supabaseAdmin } from "@/lib/supabase"

export type MotivoSupresion = "HARD_BOUNCE" | "QUEJA" | "MANUAL"

/** El destinatario esta en la lista de supresion y no se le envia. */
export class EmailSuprimidoError extends Error {
  constructor(public readonly motivo: string) {
    super(`email suprimido: ${motivo}`)
    this.name = "EmailSuprimidoError"
  }
}

/**
 * Devuelve el motivo de supresion, o null si la direccion puede recibir correo.
 *
 * FAIL OPEN: si la consulta falla, devuelve null y el envio sigue. Fallar
 * cerrado dejaria mudas a todas las organizaciones ante un hipo transitorio de
 * la base. El costo de un envio de mas a una casilla muerta es acotado; el de
 * silenciar a todos, no.
 */
export async function estaSuprimido(email: string): Promise<string | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from("email_suprimidos")
      .select("motivo")
      .ilike("email", email)
      .maybeSingle()

    if (error) {
      console.error("estaSuprimido: fallo el lookup, se envia igual", error.message)
      return null
    }

    return (data as { motivo?: string } | null)?.motivo ?? null
  } catch (err) {
    console.error("estaSuprimido: excepcion en el lookup, se envia igual", err)
    return null
  }
}

/**
 * Da de baja una direccion. Idempotente ante reintentos del webhook: si ya
 * esta suprimida, es un no-op.
 *
 * No usamos `.upsert(..., { onConflict: "email" })`: el indice unico de la
 * migracion 321 es sobre la EXPRESION `lower(email)`, no sobre la columna
 * `email`. Un ON CONFLICT que no matchea un indice real hace fallar TODOS los
 * inserts (no solo los duplicados), no solamente los que colisionan. Mismo
 * patron de lookup manual que
 * `app/api/public/catalogo/[slug]/abandono/route.ts` usa para su indice
 * parcial: se busca primero y se inserta solo si no existe.
 */
export async function suprimirEmail(params: {
  email: string
  motivo: MotivoSupresion
  proveedor?: string
  organizationId?: string | null
  notificationLogId?: string | null
}): Promise<void> {
  const { data: existing, error: lookupError } = await supabaseAdmin
    .from("email_suprimidos")
    .select("id")
    .ilike("email", params.email)
    .maybeSingle()

  if (lookupError) {
    console.error("suprimirEmail: fallo el lookup previo", params.email, lookupError.message)
    return
  }

  if (existing) {
    return
  }

  const { error } = await supabaseAdmin.from("email_suprimidos").insert({
    email: params.email,
    motivo: params.motivo,
    proveedor: params.proveedor ?? null,
    organization_id: params.organizationId ?? null,
    notification_log_id: params.notificationLogId ?? null,
  })

  if (error) {
    console.error("suprimirEmail: no se pudo suprimir", params.email, error.message)
  }
}
