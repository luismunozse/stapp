/**
 * Piezas que comparten las rutas que mueven una nota de crédito fiscal:
 * `comprobantes/[id]/anular` (la emite) y `comprobantes/[id]/verificar` (la concilia
 * con ARCA). Las dos confirman con el mismo RPC, releen la NC con las mismas columnas
 * y auditan la misma transición, así que viven una sola vez.
 *
 * Todo lo que escribe va por `supabaseAdmin` (no pasa por RLS): cada consulta se
 * filtra por la organización de la sesión.
 */

import { createAuditLogger } from "@/lib/audit"
import { supabaseAdmin } from "@/lib/supabase"
import { NC_COLUMNS, SAFE_COLUMNS } from "@/lib/facturacion/comprobante-columns"

/** Los ids son TEXT (cuid): una forma imposible no tiene nada que buscar. */
export const FORMA_ID = /^[A-Za-z0-9_-]{1,64}$/

export const MSG_NO_DISPONIBLE = "La anulación de facturas todavía no está disponible. Contactá a soporte."
export const MSG_NO_ENCONTRADO = "Comprobante no encontrado"

/** Lo que se devuelve de una NC: columnas seguras (nunca `provider_response`) + las de anulación. */
export const COLUMNAS_NC = `${SAFE_COLUMNS}, ${NC_COLUMNS}`

/** Relee una NC por id Y organización, con las columnas que se pueden devolver al cliente. */
export function leerNotaCredito(ncId: string, organizationId: string) {
  return supabaseAdmin
    .from("comprobantes_fiscales")
    .select(COLUMNAS_NC)
    .eq("id", ncId)
    .eq("organization_id", organizationId)
    .single()
}

export interface ConfirmacionNotaCredito {
  numero: string
  cae: string
  caeVencimiento: string
  /** Respuesta de ARCA tal cual (se guarda en `provider_response`, no se devuelve nunca). */
  raw: unknown
}

/**
 * La transición de éxito, atómica: la NC pasa a `emitido` y su factura a `anulado` en
 * una sola transacción (`confirmar_nota_credito_fiscal`, migración 371). Idempotente
 * con el mismo CAE: repetirla no cambia nada y, si la factura había quedado sin anular,
 * lo completa. Funciona para una NC `pendiente` o `rechazado`.
 */
export function confirmarNotaCredito(organizationId: string, ncId: string, datos: ConfirmacionNotaCredito) {
  return supabaseAdmin.rpc("confirmar_nota_credito_fiscal", {
    p_org_id: organizationId,
    p_nc_id: ncId,
    p_numero: datos.numero,
    p_cae: datos.cae,
    p_cae_vencimiento: datos.caeVencimiento,
    p_provider_response: datos.raw,
  })
}

export interface AnulacionAuditada {
  organizationId: string
  /** Sin usuario no hay a quién atribuirle el registro: no se audita. */
  userId: string | null | undefined
  /** La factura que quedó anulada. */
  facturaId: string
  notaCredito: string
  cae: string
  motivo: string | null
}

/** Deja constancia de quién anuló la factura. La auditoría nunca bloquea una anulación que ya salió bien. */
export async function auditarAnulacion(request: Request, datos: AnulacionAuditada): Promise<void> {
  if (!datos.userId) return
  try {
    await createAuditLogger(datos.organizationId, datos.userId, request).update(
      "comprobantes_fiscales",
      datos.facturaId,
      { estado: "emitido" },
      { estado: "anulado", notaCredito: datos.notaCredito, cae: datos.cae, motivo: datos.motivo }
    )
  } catch (e) {
    console.error("[facturacion] no se pudo auditar la anulación", e)
  }
}
