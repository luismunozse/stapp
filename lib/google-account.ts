/**
 * Qué cambiar en un usuario cuando entra con Google por primera vez sin haber
 * verificado su email.
 *
 * Una cuenta sin verificar pudo haberla creado cualquiera con ese email y una
 * contraseña elegida por él. Google prueba que quien entra ahora es el dueño
 * del email, así que esa contraseña y cualquier sesión previa dejan de servir:
 * si el dueño quiere contraseña, la define con "olvidé mi contraseña".
 *
 * Devuelve null si no hay nada que cambiar (cuenta ya verificada).
 */
export function cambiosAlVerificarConGoogle(user: {
  email_verified?: boolean | null
  password?: string | null
}): Record<string, unknown> | null {
  if (user.email_verified) return null
  return {
    email_verified: true,
    email_verification_token: null,
    email_verification_expires: null,
    password: null,
    refresh_token: null,
    refresh_token_expires: null,
    provider: "google",
  }
}
