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
