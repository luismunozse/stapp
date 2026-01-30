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
      if (event.key === "Escape") {
        event.preventDefault()
        callback()
      }
    }

    document.addEventListener("keydown", handleEscape)

    return () => {
      document.removeEventListener("keydown", handleEscape)
    }
  }, [callback, enabled])
}
