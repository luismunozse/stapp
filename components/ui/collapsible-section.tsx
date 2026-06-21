"use client"

import { useState } from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

interface CollapsibleSectionProps {
  title: string
  /** Ícono opcional a la izquierda del título. */
  icon?: React.ComponentType<{ className?: string }>
  /** Estado inicial. Default abierto (no oculta campos por defecto). */
  defaultOpen?: boolean
  /** Resumen breve a la derecha del título (ej: cantidad de ítems). */
  badge?: React.ReactNode
  children: React.ReactNode
  className?: string
}

/**
 * Sección plegable para agrupar formularios largos. type="button" en el header
 * para no disparar el submit del <form> contenedor. Render condicional (no
 * animación de altura) para evitar saltos de layout con campos complejos.
 */
export function CollapsibleSection({
  title,
  icon: Icon,
  defaultOpen = true,
  badge,
  children,
  className,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={cn("rounded-lg border bg-card", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left transition-colors hover:bg-accent/40 rounded-lg"
      >
        <span className="flex items-center gap-2 text-sm font-semibold">
          {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
          {title}
        </span>
        <span className="flex items-center gap-2">
          {badge}
          <ChevronDown
            className={cn("h-4 w-4 text-muted-foreground transition-transform duration-200", !open && "-rotate-90")}
          />
        </span>
      </button>
      {open && <div className="px-4 pb-4 pt-1 space-y-4 border-t">{children}</div>}
    </div>
  )
}
