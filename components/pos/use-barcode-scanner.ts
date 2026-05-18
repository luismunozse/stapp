import { useEffect, useRef } from "react"

interface UseBarcodeScannerOptions {
  onScan: (barcode: string) => void
  enabled?: boolean
}

/**
 * Detects barcode scanner input by measuring keystroke speed.
 * Scanners type at < 50ms per character, humans at > 100ms.
 * Only fires when no input/textarea is focused (global scan mode).
 */
export function useBarcodeScanner({ onScan, enabled = true }: UseBarcodeScannerOptions) {
  const buffer = useRef("")
  const lastKeyTime = useRef(0)

  useEffect(() => {
    if (!enabled) return

    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
        // User typing en input — descartar buffer global para que próximo
        // scan post-blur arranque limpio.
        buffer.current = ""
        lastKeyTime.current = 0
        return
      }

      const now = Date.now()

      if (e.key === "Enter" && buffer.current.length >= 3) {
        e.preventDefault()
        onScan(buffer.current)
        buffer.current = ""
        return
      }

      // Resolve char. Para teclas de dígito usamos e.code (Digit0..9 / Numpad0..9)
      // independiente del layout: en ES/Latam Shift+1..0 emite "!\"·$%&/()=", lo
      // que rompe el match de EAN13 en la búsqueda posterior.
      let ch: string | null = null
      const digitMatch = e.code.match(/^Digit(\d)$/) || e.code.match(/^Numpad(\d)$/)
      if (digitMatch) ch = digitMatch[1]
      else if (e.key.length === 1) ch = e.key

      if (ch) {
        if (now - lastKeyTime.current > 150) {
          buffer.current = ""
        }
        buffer.current += ch
        lastKeyTime.current = now
      }
    }

    const clearTimer = setInterval(() => {
      if (Date.now() - lastKeyTime.current > 500) {
        buffer.current = ""
      }
    }, 500)

    window.addEventListener("keydown", handleKeyDown)
    return () => {
      window.removeEventListener("keydown", handleKeyDown)
      clearInterval(clearTimer)
    }
  }, [onScan, enabled])
}
