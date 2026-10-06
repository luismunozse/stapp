const BASE = "https://x.invalid"
const UNSAFE_CHARS = /[\u0000-\u0020\u007f-\u009f\\]/
const BLOCKED_PATHS = ["/", "/login", "/registro", "/api"]

function isBlockedPath(pathname: string): boolean {
  return BLOCKED_PATHS.some(
    (p) => pathname === p || (p !== "/" && (pathname.startsWith(`${p}/`))),
  )
}

/**
 * Destino post-login a partir del `callbackUrl` de la query. Solo rutas
 * relativas del mismo origen: `//host`, `/\host`, esquemas (`https:`,
 * `javascript:`), espacios y caracteres de control (tambien codificados) son
 * open redirect y caen al fallback. `/`, `/login*`, `/registro*` y `/api/*`
 * tampoco sirven como destino de un login (bucles de auth).
 *
 * Se valida el valor tal cual y su decodificacion (una sola vez) para que
 * variantes como `/%2F%2Fevil.com` o `/%5Cevil.com` no se cuelen.
 */
export function safeCallbackPath(raw: string | null | undefined, fallback = "/dashboard"): string {
  if (!raw) return fallback

  let decoded: string
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    return fallback
  }

  for (const candidate of [raw, decoded]) {
    if (!candidate.startsWith("/") || candidate.startsWith("//")) return fallback
    if (UNSAFE_CHARS.test(candidate)) return fallback
  }

  let url: URL
  try {
    url = new URL(raw, BASE)
  } catch {
    return fallback
  }
  if (url.origin !== BASE) return fallback

  let pathname = url.pathname
  try {
    pathname = decodeURIComponent(pathname)
  } catch {
    return fallback
  }
  if (isBlockedPath(pathname)) return fallback

  return raw
}
