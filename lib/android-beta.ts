import { z } from "zod"

/**
 * Beta de Android: el usuario deja el correo de su cuenta de Google desde la
 * app, el superadmin lo carga a mano en la lista de testers de Play Console y
 * marca la fila como AGREGADO. Recien ahi el usuario puede aceptar la
 * invitacion (PLAY_TESTING_URL) e instalar STApp desde Play Store.
 *
 * Este modulo lo comparten la API del usuario, la del superadmin, el banner y
 * la pantalla del superadmin.
 */

/** Pagina donde el tester acepta la invitacion a la prueba. */
export const PLAY_TESTING_URL = "https://play.google.com/apps/testing/ar.com.stapp.app"

export const BETA_ESTADOS = ["PENDIENTE", "AGREGADO", "DESCARTADO"] as const
export type BetaEstado = (typeof BETA_ESTADOS)[number]

/**
 * Cualquier dominio: una cuenta de Google puede ser @gmail.com o un correo
 * propio asociado a una cuenta de Google. Se guarda en minusculas y sin
 * espacios para poder comparar y copiar a Play Console sin sorpresas.
 */
export const inscripcionSchema = z.object({
  email: z.string().trim().toLowerCase().min(1).max(254).email(),
})

/** Lo que ve el usuario de su propia inscripcion. */
export interface Inscripcion {
  email: string
  estado: BetaEstado
  /** Solo cuando ya lo agregaron a la lista de Play. */
  linkInvitacion?: string
}

export function toInscripcion(row: { email: string; estado: string }): Inscripcion {
  const estado = row.estado as BetaEstado
  return estado === "AGREGADO"
    ? { email: row.email, estado, linkInvitacion: PLAY_TESTING_URL }
    : { email: row.email, estado }
}
