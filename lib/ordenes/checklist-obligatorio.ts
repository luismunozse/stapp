/**
 * Cuándo los ítems obligatorios del checklist de recepción dejan de bloquear
 * la creación de la orden.
 *
 * La plantilla de recepción de computadoras es una sola para notebook y PC:
 * pide pantalla, batería, bisagras, touchpad, cargador... Para una PC de
 * escritorio casi nada de eso aplica, así que el checklist pasa a opcional:
 * se puede completar igual, pero no frena el alta.
 */

const ESCRITORIO = /escritorio|desktop/i

export function esPcDeEscritorio({
  tipoNombre,
  tipoPc,
}: {
  /** Nombre del tipo de equipo (una org puede tener un tipo propio "PC de escritorio"). */
  tipoNombre?: string | null
  /** Valor del campo extra "Tipo de PC" del tipo Computadora (Notebook / Desktop / All-in-One). */
  tipoPc?: unknown
}): boolean {
  if (tipoNombre && ESCRITORIO.test(tipoNombre)) return true
  return typeof tipoPc === "string" && ESCRITORIO.test(tipoPc)
}
