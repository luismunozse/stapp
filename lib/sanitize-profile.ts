/**
 * Sanitization helpers for user-supplied profile data written into the JWT.
 *
 * These are deliberately extracted from the jwt callback so they can be
 * unit-tested independently and reused wherever profile data is processed.
 */

const NAME_MAX_LENGTH = 100
const AVATAR_MAX_LENGTH = 500

/**
 * Coerce a raw value to a safe display name.
 *
 * - Strips `<` and `>` to prevent HTML injection in audit logs / UI.
 * - Trims whitespace.
 * - Caps length at NAME_MAX_LENGTH.
 * - Returns null when the result is empty.
 */
export function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const cleaned = raw.replace(/[<>]/g, "").trim().slice(0, NAME_MAX_LENGTH)
  return cleaned.length > 0 ? cleaned : null
}

/**
 * Validate and coerce a raw value to a safe avatar URL.
 *
 * - Only accepts http:// or https:// URLs.
 * - Rejects javascript:, data:, blob:, and any other scheme.
 * - Caps length at AVATAR_MAX_LENGTH.
 * - Returns null for anything that doesn't pass.
 */
export function sanitizeAvatarUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const trimmed = raw.trim()
  if (trimmed.length > AVATAR_MAX_LENGTH) return null
  if (!/^https?:\/\//i.test(trimmed)) return null
  return trimmed
}
