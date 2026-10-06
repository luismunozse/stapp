// @vitest-environment node
import { describe, it, expect } from "vitest"
import { isPublicPath } from "@/lib/public-paths"

// Las rutas que eran públicas ANTES de este cambio no pueden dejar de serlo.
const HISTORICAS = [
  "/login", "/registro", "/forgot-password", "/reset-password", "/verificar-email", "/tenant-not-found",
  "/api/auth/session", "/api/public/catalogo/x", "/api/cron/x", "/api/mercadopago/webhook", "/api/rebill/webhook",
  "/api/creem/webhook", "/_next/static/a.js", "/favicon.ico", "/manifest.json", "/sw.js", "/logo.png", "/icons/a.png",
  "/seguimiento/abc", "/cotizacion/abc", "/kiosco", "/api/whatsapp/webhook", "/api/v1/x", "/api/health",
  "/app-entry", "/ayuda", "/descargar", "/google-auth",
]

describe("isPublicPath", () => {
  it.each(HISTORICAS)("%s sigue siendo pública", (p) => expect(isPublicPath(p)).toBe(true))

  it.each(["/legal", "/legal/eliminar-cuenta", "/legal/privacidad", "/legal/terminos"])(
    "%s es pública (la URL de Play Console tiene que abrir sin sesión, también desde un subdominio)",
    (p) => expect(isPublicPath(p)).toBe(true)
  )

  it.each(["/legalizar", "/legales-internos", "/legal-admin"])(
    "%s NO es pública (/legal respeta el límite de segmento)",
    (p) => expect(isPublicPath(p)).toBe(false)
  )

  it.each(["/dashboard", "/perfil", "/ordenes", "/api/account/export", "/api/account/delete-user", "/api/users/profile"])(
    "%s sigue protegida",
    (p) => expect(isPublicPath(p)).toBe(false)
  )
})
