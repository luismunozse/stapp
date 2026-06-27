/**
 * Validates an IMEI: exactly 15 numeric digits.
 * Empty/null/undefined = valid (IMEI is optional; only validated when provided).
 */
export function isValidImei(value: string | null | undefined): boolean {
  if (value == null || value === "") return true
  return /^\d{15}$/.test(value)
}

/** Strips non-digits and truncates to 15 (for sanitizing input/paste). */
export function sanitizeImei(value: string): string {
  return value.replace(/\D/g, "").slice(0, 15)
}

/**
 * Valida el identificador del equipo según el modo configurado por tipo.
 * Vacío = válido (campo opcional). "imei" = 15 dígitos. "pattern" = matchea el
 * regex (regex inválido => válido, fail-safe). "none"/ausente = sin validar.
 */
export function validarSerie(
  value: string | null | undefined,
  cfg?: { validacion?: "imei" | "pattern" | "none"; pattern?: string }
): boolean {
  if (value == null || value === "") return true
  const modo = cfg?.validacion ?? "none"
  if (modo === "imei") return isValidImei(value)
  if (modo === "pattern") {
    if (!cfg?.pattern) return true
    try {
      return new RegExp(cfg.pattern).test(value)
    } catch {
      return true
    }
  }
  return true
}
