import { useEffect, RefObject } from "react"

/**
 * Hook para trap focus dentro de un elemento (útil para modales y menús móviles)
 *
 * @param ref - Referencia al elemento contenedor
 * @param active - Si el focus trap está activo
 *
 * @example
 * ```tsx
 * const menuRef = useRef<HTMLDivElement>(null)
 * useFocusTrap(menuRef, isMenuOpen)
 *
 * <div ref={menuRef}>...</div>
 * ```
 */
// El ref admite null porque eso es lo que devuelve `useRef<T>(null)` desde los
// tipos de React 19, y porque es la verdad: el efecto corre antes de que el
// elemento exista. La guarda de abajo ya contemplaba ese caso; el tipo viejo
// (`RefObject<HTMLElement>`) era el que mentía.
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    if (!active || !ref.current) return

    const element = ref.current

    // Guardar el elemento que tenía focus antes de abrir el trap
    const previouslyFocused = document.activeElement as HTMLElement

    // Encontrar todos los elementos focuseables
    const focusableSelector =
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

    const getFocusableElements = () => {
      return Array.from(
        element.querySelectorAll<HTMLElement>(focusableSelector)
      ).filter((el) => !el.hasAttribute("disabled") && !el.getAttribute("aria-hidden"))
    }

    const handleTabKey = (e: KeyboardEvent) => {
      const focusableElements = getFocusableElements()

      if (focusableElements.length === 0) return

      const firstElement = focusableElements[0]
      const lastElement = focusableElements[focusableElements.length - 1]

      // Tab normal
      if (e.key === "Tab" && !e.shiftKey) {
        if (document.activeElement === lastElement) {
          e.preventDefault()
          firstElement.focus()
        }
      }

      // Shift + Tab
      if (e.key === "Tab" && e.shiftKey) {
        if (document.activeElement === firstElement) {
          e.preventDefault()
          lastElement.focus()
        }
      }
    }

    // Dar focus al primer elemento focuseable
    const focusableElements = getFocusableElements()
    if (focusableElements.length > 0) {
      focusableElements[0].focus()
    }

    // Escuchar eventos de teclado
    element.addEventListener("keydown", handleTabKey)

    // Cleanup
    return () => {
      element.removeEventListener("keydown", handleTabKey)
      // Restaurar focus al elemento anterior
      if (previouslyFocused && previouslyFocused.focus) {
        previouslyFocused.focus()
      }
    }
  }, [ref, active])
}
