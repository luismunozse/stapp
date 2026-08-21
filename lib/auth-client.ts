// NextAuth v5: los códigos custom que authorize() tira vía AuthSigninError
// (lib/auth.ts) viajan en `result.code` — `result.error` es SIEMPRE
// "CredentialsSignin". Leer `result.error` directo hace que códigos como
// REQUIRES_2FA o ACCOUNT_LOCKED nunca matcheen y colapsen en el mensaje
// genérico. Mantenemos fallback a `error` por si el framework cambia.
export function extractAuthCode(
  result: { error?: string | null; code?: string | null } | undefined
): string {
  return result?.code || result?.error || ""
}

// Devuelve el userId si el código es exactamente "REQUIRES_2FA:<userId>",
// o null en cualquier otro caso. OJO: no usar `code.includes("REQUIRES_2FA")`
// para esto — "SUPERADMIN_REQUIRES_2FA_SETUP".includes("REQUIRES_2FA") es
// true y secuestra esa rama dejando el userId en undefined (pantalla muda).
export function parseRequires2FA(code: string): string | null {
  if (!code.startsWith("REQUIRES_2FA:")) return null
  const userId = code.slice("REQUIRES_2FA:".length)
  return userId || null
}
