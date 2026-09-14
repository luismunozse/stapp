import { useEffect } from "react"

/**
 * Hook para cerrar elementos (modales, menús) con la tecla ESC
 *
 * @param callback - Función a ejecutar al presionar ESC
 * @param enabled - Si el listener está activo (default: true)
 *
 * @example
 * ```tsx
 * useEscapeKey(() => setModalOpen(false), modalOpen)
 * ```
 */
export function useEscapeKey(callback: () => void, enabled: boolean = true) {
  useEffect(() => {
    if (!enabled) return

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return

      // Un dismissable anidado (un dropdown de Radix, por ejemplo) ya atendio
      // este Escape: Radix escucha en captura, o sea antes que nosotros, y
      // marca el evento con preventDefault() —pero NO corta la propagacion, asi
      // que igual nos llega. Sin este guard, un solo Escape cierra el dropdown
      // Y el contenedor que lo envuelve, cuando deberia cerrar solo la capa de
      // adentro.
      if (event.defaultPrevented) return

      event.preventDefault()
      callback()
    }

    document.addEventListener("keydown", handleEscape)

    return () => {
      document.removeEventListener("keydown", handleEscape)
    }
  }, [callback, enabled])
}
