import { describe, it, expect } from "vitest"
import { COUNTRIES } from "@/lib/countries"

// Un regex "acepta letras" si, quitadas las secuencias de escape (\d, \.), su
// fuente todavia contiene alguna letra (ej: [A-Z0-9], [0-9kK], [0-9PE-]).
function acceptsLetters(re: RegExp): boolean {
  return /[A-Za-z]/.test(re.source.replace(/\\[A-Za-z]/g, ""))
}

describe("countries — el teclado de cada ID es coherente con su regex", () => {
  const entries = Object.values(COUNTRIES)

  it.each(entries.map((c) => [c.code, c] as const))(
    "%s: personalId y taxId usan teclado de texto si su regex acepta letras",
    (_code, c) => {
      expect(c.personalIdInputMode).toBe(acceptsLetters(c.personalIdRegex) ? "text" : "numeric")
      expect(c.taxIdInputMode).toBe(acceptsLetters(c.taxIdRegex) ? "text" : "numeric")
    }
  )
})
