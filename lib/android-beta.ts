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

/**
 * Tope de ids por PATCH del superadmin. El `.in("id", ids)` viaja en la URL de
 * PostgREST y miles de ids la revientan; la pantalla parte las selecciones
 * grandes en lotes de este tamaño.
 */
export const BETA_MAX_IDS_POR_LOTE = 200

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

/**
 * Correos a pegar en la lista de testers de Play Console: solo los PENDIENTE,
 * sin repetir (dos usuarios pueden haber cargado la misma cuenta de Google).
 */
export function emailsParaPlay(filas: { email: string; estado: string }[]): string[] {
  const vistos = new Set<string>()
  for (const f of filas) {
    if (f.estado === "PENDIENTE") vistos.add(f.email.trim().toLowerCase())
  }
  return [...vistos]
}

/**
 * Contacto del superadmin con un inscripto: abre (o reusa) una conversacion de
 * soporte con ese usuario, asi el mensaje le llega al chat de STApp y por mail.
 * El asunto fijo es lo que permite encontrar la conversacion ya abierta en vez
 * de crear una nueva cada vez.
 */
export const BETA_ASUNTO_CONTACTO = "Beta de Android: tu invitación"

export const BETA_MENSAJE_MAX = 2000

export const contactarSchema = z.object({
  id: z.string().min(1),
  mensaje: z.string().trim().min(1, "El mensaje no puede estar vacío").max(BETA_MENSAJE_MAX),
})

/** Texto sugerido; el superadmin lo edita antes de enviar. */
export function mensajeInvitacion(nombre: string | null | undefined, emailGoogle: string): string {
  const saludo = nombre?.trim() ? `Hola ${nombre.trim().split(/\s+/)[0]}` : "Hola"
  return [
    `${saludo}, ya te sumé a la beta de STApp para Android.`,
    "",
    `Abrí este enlace desde el celular con la cuenta de Google ${emailGoogle}, tocá "Convertirme en verificador" y después instalá la app desde Google Play:`,
    PLAY_TESTING_URL,
    "",
    "Te pido que la dejes instalada al menos 14 días. Cualquier problema, respondeme por acá.",
  ].join("\n")
}
