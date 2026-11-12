/**
 * ¿El evento sale de un lugar donde se escribe? Un atajo global no tiene que
 * pisar lo que hace la tecla dentro de un campo (Ctrl+B es negrita en un
 * editor, por ejemplo).
 */
export function esCampoEditable(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== "function") return false
  const el = target as HTMLElement
  if (el.isContentEditable) return true
  return el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]') !== null
}
