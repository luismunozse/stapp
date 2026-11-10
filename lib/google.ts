/**
 * Server-side Google ID token verification
 * Uses Google's tokeninfo endpoint to validate tokens
 */

interface GoogleUserInfo {
  email: string
  name: string
  picture?: string
  emailVerified: boolean
}

/**
 * Verifies a Google ID token and returns the user's info.
 * Uses Google's tokeninfo endpoint for validation.
 */
export async function verifyGoogleIdToken(idToken: string): Promise<GoogleUserInfo> {
  const response = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`
  )

  if (!response.ok) {
    throw new Error("Token de Google inválido")
  }

  const payload = await response.json()

  // Verify the audience matches our client ID. Sin client id configurado no
  // hay forma de saber para quién se emitió el token: falla cerrado.
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID
  if (!clientId) {
    throw new Error("El login con Google no está configurado")
  }
  if (payload.aud !== clientId) {
    throw new Error("Token de Google no corresponde a esta aplicación")
  }

  // Verify the issuer
  if (payload.iss !== "accounts.google.com" && payload.iss !== "https://accounts.google.com") {
    throw new Error("Emisor de token inválido")
  }

  // Una cuenta de Google puede tener un email que Google no verificó (cuentas
  // con email de otro dominio). Ese email no prueba nada: no se acepta.
  const emailVerified = payload.email_verified === "true" || payload.email_verified === true
  if (!emailVerified) {
    throw new Error("El email de la cuenta de Google no está verificado")
  }

  return {
    email: payload.email,
    name: payload.name || payload.email.split("@")[0],
    picture: payload.picture,
    emailVerified,
  }
}
