// CSV para el respaldo del taller. Propio y no `arrayToCSV` (lib/csv-export.ts):
// aquél prefija con `'` también los números negativos, y en un respaldo fiscal
// los negativos son notas de crédito y devoluciones.

const BOM = "﻿"

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "number" || typeof value === "bigint") return String(value)
  if (typeof value === "boolean") return value ? "true" : "false"
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString()

  let text = typeof value === "string" ? value : (JSON.stringify(value) ?? "")
  // Fórmulas: Excel/Sheets ejecutan celdas que empiezan con = + - @ TAB CR.
  // Solo se aplica a strings: un número negativo no es una fórmula.
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = "'" + text
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function rowsToCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return BOM

  const columns: string[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key)
        columns.push(key)
      }
    }
  }

  const lines = [columns.map(escapeCell).join(",")]
  for (const row of rows) lines.push(columns.map((c) => escapeCell(row[c])).join(","))
  return BOM + lines.join("\r\n") + "\r\n"
}
