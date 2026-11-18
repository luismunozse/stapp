import { supabaseAdmin } from "@/lib/supabase"

/**
 * Registro de quién cambia el total (costo_final) de una orden y desde qué
 * monto. El total es la base de la comisión del técnico y del saldo que se
 * carga a cuenta corriente al entregar; quien lo toca puede ser el mismo que
 * cobra la comisión. No se bloquea nada: queda en el historial interno de la
 * orden para que el dueño lo vea.
 *
 * El tipo no está en EVENTOS_PUBLICOS, así que no aparece en el seguimiento
 * que ve el cliente.
 */
export const TIPO_EVENTO_CAMBIO_TOTAL = "TOTAL_MODIFICADO"

export type OrigenCambioTotal = "EDICION" | "ENTREGA"

function aNumero(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function monto(n: number | null): string {
  if (n === null || n === 0) return "sin total"
  return `$${n.toLocaleString("es-AR", { maximumFractionDigits: 2 })}`
}

/** null si el total no cambió (o los dos lados están vacíos / en cero). */
export function describirCambioTotal(
  antesRaw: unknown,
  despuesRaw: unknown,
  origen: OrigenCambioTotal
): { antes: number | null; despues: number | null; descripcion: string } | null {
  const antes = aNumero(antesRaw)
  const despues = aNumero(despuesRaw)
  if ((antes ?? 0) === (despues ?? 0)) return null
  const donde = origen === "ENTREGA" ? " al entregar" : ""
  return {
    antes,
    despues,
    descripcion: `Total cambiado${donde}: de ${monto(antes)} a ${monto(despues)}`,
  }
}

/**
 * Inserta el evento si el total cambió. Nunca tira: la operación que cambió el
 * total ya se hizo y no debe fallar por el registro.
 */
export async function registrarCambioTotal(params: {
  ordenId: string
  organizationId: string
  userId: string
  rol: string | null | undefined
  antes: unknown
  despues: unknown
  origen: OrigenCambioTotal
}): Promise<void> {
  const cambio = describirCambioTotal(params.antes, params.despues, params.origen)
  if (!cambio) return
  try {
    const { error } = await supabaseAdmin.from("orden_eventos").insert({
      orden_id: params.ordenId,
      organization_id: params.organizationId,
      tipo: TIPO_EVENTO_CAMBIO_TOTAL,
      descripcion: cambio.descripcion,
      metadata: {
        antes: cambio.antes,
        despues: cambio.despues,
        origen: params.origen,
        rol: params.rol ?? null,
      },
      created_by: params.userId,
    })
    if (error) console.error("Error registrando cambio de total:", error)
  } catch (err) {
    console.error("Error registrando cambio de total:", err)
  }
}
