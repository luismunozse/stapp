import { createHash, randomBytes } from "crypto"

/**
 * Sesiones de carga de fotos desde el celular (migración 413): un enlace
 * temporal, sin login, que solo sirve para subir fotos a una orden.
 */

/** Cuánto vive el enlace desde que se genera el QR. */
export const SESION_CARGA_MINUTOS = 15
/** Tope de fotos por enlace. */
export const SESION_CARGA_MAX_FOTOS = 30

/** Lo que acepta el endpoint público: nada de SVG ni tipos arbitrarios. */
export const MIMES_FOTO_CELULAR = ["image/jpeg", "image/png", "image/webp"] as const

/** Token de 256 bits, apto para URL. Se muestra una sola vez (en el QR). */
export function generarTokenCarga(): string {
  return randomBytes(32).toString("base64url")
}

/** En la base solo vive el hash: leer la tabla no alcanza para subir. */
export function hashTokenCarga(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

/** Descarta de entrada lo que no puede ser un token nuestro (43 chars base64url). */
export function esTokenCargaValido(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token)
}
