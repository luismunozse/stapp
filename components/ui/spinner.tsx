import * as React from "react"
import { Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

const SIZE_CLASSES = {
  xs: "h-3 w-3",
  sm: "h-4 w-4",
  md: "h-5 w-5",
  lg: "h-8 w-8",
} as const

export type SpinnerSize = keyof typeof SIZE_CLASSES

export interface SpinnerProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Tamaño del ícono (default `sm`, 16 px). */
  size?: SpinnerSize
  /** Texto para lectores de pantalla (default "Cargando…"). */
  label?: string
}

/**
 * Indicador de carga accesible: `role="status"` y un texto sr-only.
 * Usa `currentColor`, así que funciona en claro, en oscuro y sobre
 * cualquier variante de botón.
 */
const Spinner = React.forwardRef<HTMLSpanElement, SpinnerProps>(
  ({ size = "sm", label = "Cargando…", className, ...props }, ref) => (
    <span
      ref={ref}
      role="status"
      className={cn("inline-flex items-center justify-center", className)}
      {...props}
    >
      <Loader2 aria-hidden="true" className={cn("animate-spin", SIZE_CLASSES[size])} />
      <span className="sr-only">{label}</span>
    </span>
  ),
)
Spinner.displayName = "Spinner"

export { Spinner }
