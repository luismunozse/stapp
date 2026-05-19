/**
 * ZPL/EPL thermal label rendering.
 *
 * Both languages use ASCII control characters to delimit fields. User-supplied
 * strings MUST be escaped before being inserted into a template to avoid
 * corrupting the spool stream:
 *
 *   ZPL:
 *     - `^` is the default Format Command Prefix (FCP). Inside a `^FD` field,
 *       a literal `^` is invalid; replace with `\5E` (hex escape). The default
 *       `~` (Delimiter) is fine inside field data.
 *     - `\` is the escape character. A literal backslash must be doubled (`\\`).
 *     - We do NOT escape `~` because it is only special outside `^FD` blocks
 *       and our placeholders are always inside data fields.
 *
 *   EPL (line-based, much simpler):
 *     - `"` ends a quoted string. Replace with `\"`.
 *     - `\` is the escape character. Replace with `\\`.
 *
 * NO external deps. Pure string manipulation.
 */

export interface LabelItem {
  codigo: string
  nombre: string
  barcode: string | null
  precioVenta: number
}

export interface LabelTemplate {
  id: string
  formato: "ZPL" | "EPL"
  ancho_mm: number
  alto_mm: number
  dpi: number
  template: string
}

/** Vars accepted by templates. Keys map 1:1 to `{{var}}` placeholders. */
export type LabelVars = Record<string, string>

/**
 * Escapes user-supplied text for safe insertion into a ZPL `^FD` field.
 * Order matters: backslash first so we don't double-escape the hex sequence
 * we introduce for `^`.
 */
export function escapeZpl(value: string): string {
  if (!value) return ""
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\^/g, "\\5E")
}

/**
 * Escapes user-supplied text for safe insertion into an EPL quoted string.
 * EPL uses double-quoted literals so we only need to escape `\` and `"`.
 */
export function escapeEpl(value: string): string {
  if (!value) return ""
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
}

/**
 * Replaces `{{var}}` tokens in a template with values from `vars`.
 *
 * Tokens are matched case-insensitive but vars are looked up lowercase.
 * Missing keys collapse to empty string (the spool would otherwise contain
 * a literal `{{foo}}` and print garbage).
 *
 * Pass already-escaped values (callers in this module do so via
 * `escapeZpl`/`escapeEpl` before invoking).
 */
export function renderTemplate(template: string, vars: LabelVars): string {
  return template.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (_, key: string) => {
    const v = vars[key.toLowerCase()]
    return v === undefined || v === null ? "" : v
  })
}

/**
 * Builds the var map for an item. Escape function is injected so the same
 * helper is reused for ZPL and EPL with the right escaping rules.
 */
function buildVars(
  item: LabelItem,
  orgName: string,
  escape: (s: string) => string,
): LabelVars {
  const code = (item.barcode || item.codigo || "").trim()
  return {
    codigo: escape(item.codigo || ""),
    nombre: escape(item.nombre || ""),
    barcode: escape(code),
    // Precio sin símbolo de moneda — el template suele anteponer `$`. Si el
    // usuario quiere otro formato puede customizar el template.
    precio: escape(
      typeof item.precioVenta === "number"
        ? item.precioVenta.toFixed(2)
        : String(item.precioVenta ?? ""),
    ),
    org_nombre: escape(orgName || ""),
  }
}

/**
 * Generates a ZPL spool string for a list of items using the given template.
 *
 * If the template does NOT already contain `^XA`/`^XZ` (the start/end-of-format
 * markers), each rendered item is wrapped. This lets users write either:
 *   - Full templates including `^XA...^XZ` (recommended; gives full control)
 *   - Bare field commands that we wrap
 *
 * Items are concatenated with a newline so the printer sees them as separate
 * labels.
 */
export function generateZpl(
  items: LabelItem[],
  template: LabelTemplate,
  orgName: string,
): string {
  const hasWrapper = /\^XA/.test(template.template) && /\^XZ/.test(template.template)
  const out: string[] = []
  for (const item of items) {
    const vars = buildVars(item, orgName, escapeZpl)
    const rendered = renderTemplate(template.template, vars)
    out.push(hasWrapper ? rendered : `^XA\n${rendered}\n^XZ`)
  }
  return out.join("\n")
}

/**
 * Generates an EPL spool string for a list of items. EPL uses `N` to clear
 * the buffer at the start of a label and `P1` to print 1 copy at the end.
 * Same wrapping logic as ZPL: if the template already includes `N` at start
 * and `P1` at end we don't add them.
 */
export function generateEpl(
  items: LabelItem[],
  template: LabelTemplate,
  orgName: string,
): string {
  const tpl = template.template
  const hasStart = /^\s*N\b/m.test(tpl)
  const hasPrint = /\bP\d+\b/.test(tpl)
  const out: string[] = []
  for (const item of items) {
    const vars = buildVars(item, orgName, escapeEpl)
    const rendered = renderTemplate(tpl, vars)
    const parts: string[] = []
    if (!hasStart) parts.push("N")
    parts.push(rendered)
    if (!hasPrint) parts.push("P1")
    out.push(parts.join("\n"))
  }
  return out.join("\n")
}

/**
 * Returns a sensible default ZPL template for 50x30mm @ 203dpi.
 * Mirrors the migration backfill so the UI can offer "reset to default"
 * without a DB round-trip.
 */
export function defaultZplTemplate50x30(): string {
  return [
    "^XA",
    "^PW400",
    "^LL240",
    "^CI28",
    "^FO20,15^A0N,28,28^FD{{nombre}}^FS",
    "^FO20,55^BY2,2,80^BCN,80,N,N,N^FD{{barcode}}^FS",
    "^FO20,150^A0N,22,22^FD{{codigo}}^FS",
    "^FO230,150^A0N,32,32^FD${{precio}}^FS",
    "^XZ",
  ].join("\n")
}

/**
 * Returns a sensible default EPL template for 50x30mm @ 203dpi.
 * EPL uses Y/X coords in dots and very different command names — kept here
 * as a fallback example for users new to EPL.
 */
export function defaultEplTemplate50x30(): string {
  return [
    "N",
    'A20,10,0,3,1,1,N,"{{nombre}}"',
    'B20,50,0,1,2,2,80,N,"{{barcode}}"',
    'A20,150,0,2,1,1,N,"{{codigo}}"',
    'A230,150,0,4,1,1,N,"${{precio}}"',
    "P1",
  ].join("\n")
}
