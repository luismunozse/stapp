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
