/**
 * Normaliza un número tipeado con formato argentino ("1.250,50", "1300,5", "1.250") al decimal
 * con punto que acepta el servidor ("1250.50"). Pura. Un texto sin coma ni miles con punto
 * ("1250.5", "") se devuelve igual.
 */
export function normalizarNumeroAR(texto: string): string {
  const t = texto.trim()
  if (t.includes(",")) return t.replace(/\./g, "").replace(",", ".")
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) return t.replace(/\./g, "")
  return t
}
