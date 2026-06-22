"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"
// Reutilizamos Header/Footer/Title/Description del Dialog estándar: misma API.
import {
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"

/**
 * ResponsiveDialog — bottom-sheet en móvil (<sm), diálogo centrado en desktop.
 * Construido sobre Radix Dialog (misma primitiva que <Dialog>) para no duplicar
 * focus-trap ni introducir otra dependencia. Opt-in: <Dialog> queda intacto.
 *
 * Móvil: la animación slide-up/down la maneja `.responsive-sheet` vía media query
 * en globals.css. Desktop: animación zoom/fade de tailwindcss-animate, prefijada
 * con `sm:` para que no colisione con la del móvil.
 */

const ResponsiveDialog = DialogPrimitive.Root
const ResponsiveDialogTrigger = DialogPrimitive.Trigger
const ResponsiveDialogClose = DialogPrimitive.Close
const ResponsiveDialogPortal = DialogPrimitive.Portal

// Workaround Radix: body queda con pointer-events:none al cerrar rápido.
// Mismo patrón que en dialog.tsx.
function useUnstickBodyPointerEvents() {
  React.useEffect(() => {
    return () => {
      if (typeof document !== "undefined") {
        requestAnimationFrame(() => {
          if (document.body.style.pointerEvents === "none") {
            document.body.style.pointerEvents = ""
          }
        })
      }
    }
  }, [])
}

const ResponsiveDialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-[70] bg-black/80 ease-snappy data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
))
ResponsiveDialogOverlay.displayName = "ResponsiveDialogOverlay"

const ResponsiveDialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    /** Oculta la barra de arrastre (grab handle) en móvil. */
    hideHandle?: boolean
  }
>(({ className, children, hideHandle, onCloseAutoFocus, ...props }, ref) => {
  useUnstickBodyPointerEvents()
  return (
    <ResponsiveDialogPortal>
      <ResponsiveDialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          "responsive-sheet fixed z-[70] grid gap-4 border bg-card text-card-foreground shadow-lg outline-none overflow-y-auto overscroll-contain duration-200 ease-snappy",
          // Móvil: hoja anclada al fondo, full-width, esquinas superiores redondeadas
          "inset-x-0 bottom-0 max-h-[90dvh] rounded-t-2xl border-x-0 border-b-0 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom,0px))]",
          // Desktop: diálogo centrado clásico
          "sm:inset-x-auto sm:bottom-auto sm:left-[50%] sm:top-[50%] sm:w-full sm:max-w-lg sm:max-h-[calc(100dvh-2rem)] sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-lg sm:border sm:p-6",
          // Animación desktop (la de móvil vive en globals.css → .responsive-sheet)
          "sm:data-[state=open]:animate-in sm:data-[state=closed]:animate-out sm:data-[state=closed]:fade-out-0 sm:data-[state=open]:fade-in-0 sm:data-[state=closed]:zoom-out-95 sm:data-[state=open]:zoom-in-95",
          className
        )}
        onCloseAutoFocus={(e) => {
          onCloseAutoFocus?.(e)
          if (typeof document !== "undefined" && document.body.style.pointerEvents === "none") {
            document.body.style.pointerEvents = ""
          }
        }}
        {...props}
      >
        {/* Grab handle: afordancia de hoja, solo móvil */}
        {!hideHandle && (
          <div
            className="sm:hidden mx-auto -mt-1 mb-1 h-1.5 w-10 shrink-0 rounded-full bg-muted-foreground/30"
            aria-hidden="true"
          />
        )}
        {children}
        <DialogPrimitive.Close className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-md opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11">
          <X className="h-4 w-4" />
          <span className="sr-only">Cerrar</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </ResponsiveDialogPortal>
  )
})
ResponsiveDialogContent.displayName = "ResponsiveDialogContent"

export {
  ResponsiveDialog,
  ResponsiveDialogPortal,
  ResponsiveDialogOverlay,
  ResponsiveDialogClose,
  ResponsiveDialogTrigger,
  ResponsiveDialogContent,
  // Re-export para API completa equivalente a <Dialog>
  DialogHeader as ResponsiveDialogHeader,
  DialogFooter as ResponsiveDialogFooter,
  DialogTitle as ResponsiveDialogTitle,
  DialogDescription as ResponsiveDialogDescription,
}
