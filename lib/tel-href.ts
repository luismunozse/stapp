// Keep only digits and a leading "+" so spaces/dashes/parentheses don't leak into the tel: URI.
export const telHref = (raw: string) => {
  const trimmed = raw.trim()
  return (trimmed.startsWith("+") ? "+" : "") + trimmed.replace(/\D/g, "")
}
