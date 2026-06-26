/**
 * Términos y condiciones de recepción del equipo.
 *
 * Fuente única de verdad para el comprobante PDF (lib/pdf.ts) y la página
 * pública de seguimiento. La org puede configurar los suyos en
 * `organizations.recepcion_terminos`; si están vacíos, se usan los por defecto.
 */
export const DEFAULT_RECEPCION_TERMINOS = [
  "1. Conserve este comprobante para retirar su equipo. El plazo de retiro es de 30 días.",
  "2. No nos hacemos responsables por datos perdidos. Realice backup antes de entregar el equipo.",
  "3. Al firmar, el cliente declara haber revisado el estado del equipo al momento de la entrega.",
  "4. El presupuesto puede variar según el diagnóstico final del equipo.",
]

/**
 * Devuelve los términos de recepción como lista de líneas: los custom de la org
 * (parseados por salto de línea, sin vacías ni `\r`) o los por defecto si no hay.
 * Comportamiento idéntico al que tenía inline lib/pdf.ts (no rompe comprobantes).
 */
export function parseRecepcionTerminos(custom?: string | null): string[] {
  return custom
    ? custom.replace(/\r/g, "").split("\n").filter((l) => l.trim() !== "")
    : DEFAULT_RECEPCION_TERMINOS
}
