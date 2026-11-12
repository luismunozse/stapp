"use client"

import { useEffect, useState } from "react"
import { Search } from "lucide-react"

/** Evento que abre la paleta de comandos (montada una sola vez en el Navbar). */
export const ABRIR_PALETA_EVENT = "stapp:abrir-paleta"

export function abrirPaleta() {
  window.dispatchEvent(new Event(ABRIR_PALETA_EVENT))
}

const PLACEHOLDER_EXAMPLES = [
  "Buscar o ir a…",
  "Buscar por número: CEL040",
  "Buscar por cliente: Diego Alanis",
  "Nueva orden, Caja, Reportes…",
]

/**
 * Disparador de la paleta. Hay uno por barra (escritorio y mobile) pero no
 * escuchan el teclado: el atajo Ctrl/Cmd+K vive en la paleta, que es una sola.
 */
export function CommandPaletteTrigger({ variant }: { variant: "pill" | "icon" }) {
  const [placeholderIdx, setPlaceholderIdx] = useState(0)

  useEffect(() => {
    if (variant !== "pill") return
    const interval = setInterval(() => {
      setPlaceholderIdx((prev) => (prev + 1) % PLACEHOLDER_EXAMPLES.length)
    }, 3000)
    return () => clearInterval(interval)
  }, [variant])

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={abrirPaleta}
        className="lg:hidden inline-flex items-center justify-center h-10 w-10 rounded-md text-muted-foreground hover:bg-accent active:bg-accent/80 transition-colors"
        aria-label="Buscar o ir a"
        data-touch-icon=""
      >
        <Search className="h-5 w-5" />
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={abrirPaleta}
      aria-label="Buscar o ir a (Ctrl+K)"
      className="hidden lg:flex items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground bg-muted/50 border rounded-md hover:bg-muted transition-colors"
    >
      <Search className="h-4 w-4" />
      <span className="max-w-[160px] truncate">{PLACEHOLDER_EXAMPLES[placeholderIdx]}</span>
      <kbd className="ml-2 px-1.5 py-0.5 text-xs bg-background border rounded font-mono">Ctrl+K</kbd>
    </button>
  )
}
