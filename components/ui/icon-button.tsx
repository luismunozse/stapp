"use client"

import * as React from "react"
import { Button, type ButtonProps } from "./button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip"
import { cn } from "@/lib/utils"

export interface IconButtonProps
  extends Omit<ButtonProps, "size" | "aria-label" | "asChild"> {
  /**
   * Nombre accesible obligatorio (en castellano, con verbo: "Eliminar foto",
   * "Página siguiente"). Se usa como `aria-label` y como texto del tooltip.
   */
  label: string
  /** El ícono. Se marca `aria-hidden` porque el nombre sale de `label`. */
  children: React.ReactNode
  /** Mostrar el tooltip con el `label` al pasar el mouse o enfocar (default `true`). */
  tooltip?: boolean
  tooltipSide?: "top" | "right" | "bottom" | "left"
}

/**
 * Botón de solo ícono con nombre accesible obligatorio.
 *
 * - `label` → `aria-label` + tooltip (Radix), así el ícono se entiende con mouse y con lector.
 * - Tamaño `icon` (40 px); en pantallas táctiles crece a 44 px como mínimo.
 * - Acepta `loading` y todo lo demás de `Button`, y funciona dentro de un
 *   `*Trigger asChild` (reenvía ref y props).
 */
const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    { label, tooltip = true, tooltipSide, className, variant = "ghost", children, ...props },
    ref,
  ) => {
    const button = (
      <Button
        ref={ref}
        size="icon"
        variant={variant}
        aria-label={label}
        className={cn(
          "[@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11",
          className,
        )}
        {...props}
      >
        {React.isValidElement<{ "aria-hidden"?: boolean | "true" | "false" }>(children)
          ? React.cloneElement(children, { "aria-hidden": true })
          : children}
      </Button>
    )

    if (!tooltip) return button

    return (
      <TooltipProvider delayDuration={400}>
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent side={tooltipSide}>{label}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  },
)
IconButton.displayName = "IconButton"

export { IconButton }
