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

  // Verify the audience matches our client ID
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID
  if (clientId && payload.aud !== clientId) {
    throw new Error("Token de Google no corresponde a esta aplicación")
  }

  // Verify the issuer
  if (payload.iss !== "accounts.google.com" && payload.iss !== "https://accounts.google.com") {
    throw new Error("Emisor de token inválido")
  }

  return {
    email: payload.email,
    name: payload.name || payload.email.split("@")[0],
    picture: payload.picture,
    emailVerified: payload.email_verified === "true",
  }
}
