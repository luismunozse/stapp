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
 * Normaliza una direccion antes de tocar la tabla. Unica fuente de la regla:
 * tanto la lectura como la escritura pasan por aca, igual que
 * `proveedorCliente()` centraliza la decision del kill switch. La tabla
 * ademas la hace cumplir con `email_suprimidos_email_normalizado_check`.
 */
function normalizar(email: string): string {
  return email.trim().toLowerCase()
}

/**
 * Devuelve el motivo de supresion, o null si la direccion puede recibir correo.
 *
 * Consulta por igualdad sobre la columna normalizada: el unique index de la
 * migracion 321 es sobre `email` (no sobre `lower(email)`), asi que un `.eq`
 * usa ese indice. Un `.ilike` haria seq scan en cada envio, sobre el path
 * caliente y una tabla que solo crece.
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
      .eq("email", normalizar(email))
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
 * Da de baja una direccion. Idempotente ante reintentos del webhook: el
 * unique index sobre `email` (columna, normalizada) absorbe el duplicado via
 * `ignoreDuplicates`, en un solo round trip atomico. Dos webhooks concurrentes
 * para la misma direccion (ej. bounce y queja llegando juntos) no compiten por
 * un lookup-then-insert: el conflicto lo resuelve la base.
 */
export async function suprimirEmail(params: {
  email: string
  motivo: MotivoSupresion
  proveedor?: string
  organizationId?: string | null
  notificationLogId?: string | null
}): Promise<void> {
  const { error } = await supabaseAdmin
    .from("email_suprimidos")
    .upsert(
      {
        email: normalizar(params.email),
        motivo: params.motivo,
        proveedor: params.proveedor ?? null,
        organization_id: params.organizationId ?? null,
        notification_log_id: params.notificationLogId ?? null,
      },
      { onConflict: "email", ignoreDuplicates: true }
    )

  if (error) {
    console.error("suprimirEmail: no se pudo suprimir", params.email, error.message)
  }
}
