// Rutas que no requieren autenticación. Vive acá y no dentro de middleware.ts
// porque el middleware no se puede importar en tests. Edge-safe: sin imports.
export const PUBLIC_PATHS = [
  "/login",
  "/registro",
  "/forgot-password",
  "/reset-password",
  "/verificar-email",
  "/tenant-not-found",
  "/api/auth",
  "/api/public",
  "/api/cron",
  "/api/mercadopago/webhook",
  "/api/rebill/webhook",
  "/api/creem/webhook",
  "/_next",
  "/favicon.ico",
  "/manifest.json",
  "/sw.js",
  "/logo.png",
  "/icons",
  "/seguimiento",
  "/cotizacion",
  "/kiosco",
  "/api/whatsapp/webhook",
  "/api/v1",
  "/api/health",
  "/app-entry",
  "/ayuda",
  "/descargar",
  "/google-auth",
] as const

// Páginas legales, incluida /legal/eliminar-cuenta (URL declarada en Play Console).
// Con límite de segmento: /legal y /legal/..., no /legalizar.
const LEGAL_PREFIX = "/legal"

export function isPublicPath(pathname: string): boolean {
  if (pathname === LEGAL_PREFIX || pathname.startsWith(`${LEGAL_PREFIX}/`)) return true
  return PUBLIC_PATHS.some((path) => pathname.startsWith(path))
}
