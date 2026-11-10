// Keep only digits and a leading "+" so spaces/dashes/parentheses don't leak into the tel: URI.
// Returns "" when there is no digit at all, so callers can skip rendering a link.
export const telHref = (raw: string) => {
  const trimmed = raw.trim()
  const digits = trimmed.replace(/\D/g, "")
  if (!digits) return ""
  return (trimmed.startsWith("+") ? "+" : "") + digits
}
