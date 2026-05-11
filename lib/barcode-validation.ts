// EAN/UPC checksum: suma posiciones impares + 3 × suma posiciones pares.
// Dígito verificador = (10 - suma % 10) % 10. Posición se cuenta desde la derecha
// excluyendo el propio dígito verificador (último char).

function computeChecksum(digits: string): number {
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    const d = digits.charCodeAt(i) - 48
    const fromRight = digits.length - i
    sum += fromRight % 2 === 0 ? d : d * 3
  }
  return (10 - (sum % 10)) % 10
}

export function isValidEAN13(code: string): boolean {
  if (!/^\d{13}$/.test(code)) return false
  return computeChecksum(code.slice(0, 12)) === code.charCodeAt(12) - 48
}

export function isValidEAN8(code: string): boolean {
  if (!/^\d{8}$/.test(code)) return false
  return computeChecksum(code.slice(0, 7)) === code.charCodeAt(7) - 48
}

export function isValidUPCA(code: string): boolean {
  if (!/^\d{12}$/.test(code)) return false
  return computeChecksum(code.slice(0, 11)) === code.charCodeAt(11) - 48
}

export function computeEAN13CheckDigit(prefix12: string): string | null {
  if (!/^\d{12}$/.test(prefix12)) return null
  return String(computeChecksum(prefix12))
}

export type BarcodeValidationError =
  | { kind: "invalid_ean13"; expected: string }
  | { kind: "invalid_ean8"; expected: string }
  | { kind: "invalid_upca"; expected: string }

// Retorna null si OK (incluye CODE128 / cualquier formato libre).
// Retorna error si parece EAN/UPC por longitud+dígitos pero checksum no cierra.
export function validateBarcode(code: string): BarcodeValidationError | null {
  if (/^\d{13}$/.test(code) && !isValidEAN13(code)) {
    return { kind: "invalid_ean13", expected: code.slice(0, 12) + computeChecksum(code.slice(0, 12)) }
  }
  if (/^\d{8}$/.test(code) && !isValidEAN8(code)) {
    return { kind: "invalid_ean8", expected: code.slice(0, 7) + computeChecksum(code.slice(0, 7)) }
  }
  if (/^\d{12}$/.test(code) && !isValidUPCA(code)) {
    return { kind: "invalid_upca", expected: code.slice(0, 11) + computeChecksum(code.slice(0, 11)) }
  }
  return null
}
