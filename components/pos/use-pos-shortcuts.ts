import { useEffect } from "react"

interface PosShortcutHandlers {
  onNewSale: () => void
  onSearchFocus: () => void
  onHoldSale: () => void
  onRecallSale: () => void
  onCheckout: () => void
  onToggleClient: () => void
  enabled?: boolean
}

export function usePosShortcuts(handlers: PosShortcutHandlers) {
  useEffect(() => {
    if (handlers.enabled === false) return

    const handleKeyDown = (e: KeyboardEvent) => {
      const inDialog = (e.target as HTMLElement)?.closest('[role="dialog"]')

      switch (e.key) {
        case "F2":
          e.preventDefault()
          handlers.onNewSale()
          break
        case "F4":
          e.preventDefault()
          handlers.onSearchFocus()
          break
        case "F5":
          e.preventDefault()
          if (!inDialog) handlers.onHoldSale()
          break
        case "F6":
          e.preventDefault()
          handlers.onRecallSale()
          break
        case "F7":
          e.preventDefault()
          if (!inDialog) handlers.onToggleClient()
          break
        case "F8":
          e.preventDefault()
          handlers.onCheckout()
          break
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [handlers])
}
