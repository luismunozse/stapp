/**
 * Escapes HTML special characters to prevent XSS injection.
 * Handles null/undefined input gracefully by coercing to "".
 */
export function escapeHtml(str: string | null | undefined): string {
  if (str == null) return ""
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}
