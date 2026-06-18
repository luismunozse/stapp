export type ParseResult =
  | { ok: true; value: number | null }
  | { ok: false }

/** Stock: entero >= 0. Vacío => null (sin tracking). */
export function parseStock(raw: string): ParseResult {
  const t = raw.trim()
  if (t === "") return { ok: true, value: null }
  if (!/^\d+$/.test(t)) return { ok: false }
  return { ok: true, value: Number(t) }
}

/** Precio: número >= 0 con hasta 2 decimales. Vacío => null (Consultar). Acepta coma decimal. */
export function parsePrecio(raw: string): ParseResult {
  const t = raw.trim()
  if (t === "") return { ok: true, value: null }
  const normalized = t.replaceAll(",", ".")
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return { ok: false }
  return { ok: true, value: Number(normalized) }
}
