/**
 * Una sola direccion, sin nombre visible, sin espacios ni separadores. El valor
 * termina en un header de correo: aceptar CR/LF, comas o "<...>" abriria la
 * puerta a inyectar headers o a mandar las respuestas a varios destinos.
 */
const DIRECCION_SIMPLE =
  /^[^\s@,;<>"()[\]\\]+@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/

/** Largo maximo de una direccion segun RFC 5321. */
const LARGO_MAXIMO = 254

// eslint-disable-next-line no-control-regex -- justamente se buscan caracteres de control
const CONTROL = /[\x00-\x1f\x7f]/

/**
 * Convierte `organizations.email` en un reply-to usable, o `undefined` si el
 * taller no cargo uno valido. Un reply-to invalido se descarta en silencio a
 * proposito: el correo igual debe salir, solo que sin direccion de respuesta.
 */
export function replyToDelTaller(email: string | null | undefined): string | undefined {
  if (!email) return undefined
  const limpio = email.trim()
  if (!limpio) return undefined
  if (limpio.length > LARGO_MAXIMO || CONTROL.test(limpio)) return undefined
  return DIRECCION_SIMPLE.test(limpio) ? limpio : undefined
}
