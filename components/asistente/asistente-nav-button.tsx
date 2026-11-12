"use client"

import Link from "next/link"
import { Sparkles, Lock } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { useAsistente } from "./asistente-context"

interface AsistenteNavButtonProps {
  /** "pill" muestra el texto (barra de escritorio); "icon" solo el ícono (header móvil). */
  variant?: "pill" | "icon"
}

export function AsistenteNavButton({ variant = "pill" }: AsistenteNavButtonProps) {
  const asistente = useAsistente()
  if (!asistente) return null
  const { enabled, open, toggle } = asistente

  const base = cn(
    "inline-flex items-center justify-center gap-1.5 rounded-full text-sm font-medium transition-colors",
    "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
    variant === "pill" ? "h-9 px-3" : "h-11 w-11"
  )

  if (!enabled) {
    return (
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Asistente de STApp (disponible en plan Profesional)"
            className={cn(base, "text-muted-foreground hover:bg-accent")}
          >
            <span className="relative">
              <Sparkles className="h-5 w-5" aria-hidden />
              <Lock className="absolute -bottom-1 -right-1.5 h-3 w-3 rounded-full bg-background" aria-hidden />
            </span>
            {variant === "pill" && <span>Asistente</span>}
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" sideOffset={8} className="w-72 text-sm">
          <p className="font-medium mb-1">Asistente de STApp</p>
          <p className="text-muted-foreground mb-2">
            Disponible en el plan Profesional: respondé tus dudas sobre cómo usar el sistema al instante.
          </p>
          <Link href="/configuracion/billing" className="text-primary font-medium hover:underline">
            Ver planes
          </Link>
        </PopoverContent>
      </Popover>
    )
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={open ? "Cerrar asistente de STApp" : "Abrir asistente de STApp"}
      aria-expanded={open}
      aria-controls="asistente-panel"
      className={cn(
        base,
        open
          ? "bg-primary text-primary-foreground"
          : "bg-primary/10 text-primary hover:bg-primary/15"
      )}
    >
      <Sparkles className="h-5 w-5" aria-hidden />
      {variant === "pill" && <span>Asistente</span>}
    </button>
  )
}
