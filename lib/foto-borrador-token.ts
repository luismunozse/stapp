import { randomBytes, createHash } from "crypto"

/** Vida del token del QR. Corta a propósito: el QR queda expuesto en pantalla. */
export const FOTO_BORRADOR_TTL_MS = 5 * 60 * 1000
export const MAX_FOTOS_POR_BORRADOR = 6
export const MAX_BORRADORES_ACTIVOS = 3

export type BorradorEstado = {
  revokedAt: Date | string | null
  expiresAt: Date | string
}

export type MotivoRechazo = "REVOCADO" | "VENCIDO" | "TOPE_ALCANZADO"

export type ResultadoAceptacion = { ok: true } | { ok: false; motivo: MotivoRechazo }

export function hashBorradorToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex")
}

/**
 * 256 bits de entropía. El crudo viaja solo al QR; en la base queda el hash,
 * así que una filtración de la tabla no entrega tokens usables.
 */
export function generateBorradorToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("base64url")
  return { raw, hash: hashBorradorToken(raw) }
}

/**
 * Compuerta única de aceptación. `now` se inyecta para que el vencimiento sea
 * testeable sin reloj ambiente.
 *
 * A propósito no se expone un `isExpired` aparte: una sola compuerta evita que
 * un caller chequee vencimiento y se olvide de revocado o del tope.
 */
export function canAcceptFoto(
  borrador: BorradorEstado,
  cantidadActual: number,
  now: Date,
): ResultadoAceptacion {
  if (borrador.revokedAt) return { ok: false, motivo: "REVOCADO" }
  if (new Date(borrador.expiresAt).getTime() <= now.getTime()) {
    return { ok: false, motivo: "VENCIDO" }
  }
  if (cantidadActual >= MAX_FOTOS_POR_BORRADOR) {
    return { ok: false, motivo: "TOPE_ALCANZADO" }
  }
  return { ok: true }
}
