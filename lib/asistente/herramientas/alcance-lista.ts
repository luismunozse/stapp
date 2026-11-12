import { resolveTecnicosTomanOrdenes } from "@/lib/auth-utils"
import { filtroListaTecnico } from "@/lib/sucursal-ordenes"
import type { ContextoHerramienta } from "./tipos"

/**
 * El alcance de la LISTA de órdenes (GET /api/ordenes), para las herramientas que listan o
 * cuentan órdenes. Misma regla que la pantalla Órdenes:
 *  - TECNICO: las asignadas a él, de cualquier sucursal; con `tecnicos_toman_ordenes`, además
 *    las sin asignar que atiende su sucursal. El filtro de sucursal no se le aplica.
 *  - ADMIN y VENDEDOR: el filtro de sucursal de la lectura (el ADMIN según su selector).
 *
 * Devuelve un `eq` a aplicar y/o un grupo `or` para combinar con `combinarOr` junto a los demás.
 */
export async function alcanceListaOrdenes(
  ctx: ContextoHerramienta
): Promise<{ eq?: [string, string]; or?: string }> {
  const { actor, filtroLectura } = ctx
  if (actor.role === "TECNICO") {
    const filtro = filtroListaTecnico(
      actor.userId,
      actor.sucursalId,
      await resolveTecnicosTomanOrdenes(actor.organizationId)
    )
    return filtro ? { or: filtro } : { eq: ["tecnico_id", actor.userId] }
  }
  if (!filtroLectura.verTodas && filtroLectura.sucursalId) {
    return { eq: ["sucursal_id", filtroLectura.sucursalId] }
  }
  return {}
}
