import { supabaseAdmin } from "@/lib/supabase"

/** Lo mínimo que hace falta para saber si una fila es una revisión y de quién. */
export interface RevisionRef {
  id: string
  revision_de?: string | null
}

/**
 * `cotizaciones.reemplazada_por` (migración 311) es un puntero, no un estado:
 * NULL = vigente, con valor = esta fila fue reemplazada por esa revisión. El
 * presupuesto de la orden excluye a las reemplazadas, así que el puntero decide
 * qué se le cobra al cliente — y por eso tiene que ser verdad en todo momento.
 *
 * Estas dos funciones son las ÚNICAS que lo escriben. Vivían sueltas en
 * `enviar/route.ts`, pero la revisión también se envía por PUT (el botón
 * "Enviar y compartir" de la lista manda `estado: "ENVIADA"`, no pasa por el
 * mail), y muere por tres puertas distintas: rechazo del staff, rechazo del
 * cliente desde el link público y borrado. Copiar el UPDATE en cada una es
 * exactamente cómo se pierde una.
 */

/**
 * La revisión pasó a ENVIADA: desde ahora reemplaza a la original.
 *
 * Antes de eso es un borrador que se puede abandonar sin dejar huérfana a la
 * aceptada, por eso la marca no se escribe al crearla. Tiene que correr ANTES
 * de cualquier recálculo de presupuesto: si queda después, la suma cuenta la
 * aceptada Y su revisión, y la orden cobra dos veces el mismo trabajo.
 *
 * Devuelve `true` si marcó algo (es decir, si la fila era una revisión).
 */
export async function marcarOriginalReemplazada(
  revision: RevisionRef,
  organizationId: string
): Promise<boolean> {
  if (!revision.revision_de) return false

  const { error } = await supabaseAdmin
    .from("cotizaciones")
    .update({ reemplazada_por: revision.id })
    .eq("id", revision.revision_de)
    .eq("organization_id", organizationId)

  // No se traga: si la marca no entra, la orden empieza a contar las dos
  // versiones y nadie se entera hasta que el cliente ve el total inflado.
  if (error) {
    throw new Error(
      `No se pudo marcar la cotización ${revision.revision_de} como reemplazada por ${revision.id}: ${error.message}`
    )
  }
  return true
}

/**
 * La revisión dejó de ser un documento vivo (rechazada o eliminada): la
 * original vuelve a ser la vigente.
 *
 * Sin esto, la original queda excluida del presupuesto para siempre —la
 * revisión por RECHAZADA y la original por reemplazada— y el próximo recálculo,
 * venga de donde venga, deja `presupuesto`/`costo_final` de la orden en 0 o
 * NULL mientras la firma de la original sigue siendo el acuerdo vigente y su
 * stock sigue reservado.
 *
 * El filtro `reemplazada_por = revision.id` es deliberado: sólo se limpia el
 * puntero si apunta a ESTA revisión. Si la original ya fue reemplazada por otra
 * revisión posterior, esta muerte no la resucita.
 *
 * Devuelve el id de la cotización restaurada, o `null` si no había nada que
 * restaurar. Quien llame tiene que recalcular el presupuesto de la orden cuando
 * devuelve un id: la cifra restaurada no aparece sola.
 */
export async function restaurarOriginalDeRevision(
  revision: RevisionRef,
  organizationId: string
): Promise<string | null> {
  if (!revision.revision_de) return null

  const { data, error } = await supabaseAdmin
    .from("cotizaciones")
    .update({ reemplazada_por: null })
    .eq("id", revision.revision_de)
    .eq("organization_id", organizationId)
    .eq("reemplazada_por", revision.id)
    .select("id")

  if (error) {
    throw new Error(
      `No se pudo restaurar la cotización ${revision.revision_de} tras la baja de su revisión ${revision.id}: ${error.message}`
    )
  }

  return data && data.length > 0 ? revision.revision_de : null
}
