"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

const Dialog = DialogPrimitive.Root

const DialogTrigger = DialogPrimitive.Trigger

const DialogPortal = DialogPrimitive.Portal

const DialogClose = DialogPrimitive.Close

// Overlay único para Dialog, ResponsiveDialog y Sheet: negro al 60 %, sin blur
// (el backdrop-filter traba la animación en los Android de gama baja del mostrador).
const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-[70] bg-black/60 ease-snappy data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

// Workaround Radix Dialog bug: body queda con pointer-events: none al cerrar
// rápido o con re-render durante cierre. Restauramos el estilo al desmontar
// el contenido y tras animación de cierre.
// Refs: github.com/radix-ui/primitives/issues/1241, /2122
function useUnstickBodyPointerEvents() {
  React.useEffect(() => {
    return () => {
      if (typeof document !== "undefined") {
        // Defer al siguiente frame: Radix limpia su propio state después del unmount
        requestAnimationFrame(() => {
          if (document.body.style.pointerEvents === "none") {
            document.body.style.pointerEvents = ""
          }
        })
      }
    }
  }, [])
}

// Centered dialog geometry. Callers' unprefixed overrides (max-w-2xl, p-0,
// max-h-[90vh]…) keep working on every breakpoint as before.
const BASE =
  "fixed left-[50%] top-[50%] z-[70] grid w-[calc(100%-2rem)] max-w-lg rounded-lg max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain translate-x-[-50%] translate-y-[-50%] gap-4 border bg-card text-card-foreground p-6 pb-[max(1.5rem,env(safe-area-inset-bottom,0px))] shadow-lg duration-200 ease-snappy"

const ZOOM_ANIMATION =
  "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]"

// Same zoom, sm+ only (literal: Tailwind can't see classes built at runtime).
const ZOOM_ANIMATION_SM =
  "sm:data-[state=open]:animate-in sm:data-[state=closed]:animate-out sm:data-[state=closed]:fade-out-0 sm:data-[state=open]:fade-in-0 sm:data-[state=closed]:zoom-out-95 sm:data-[state=open]:zoom-in-95 sm:data-[state=closed]:slide-out-to-left-1/2 sm:data-[state=closed]:slide-out-to-top-[48%] sm:data-[state=open]:slide-in-from-left-1/2 sm:data-[state=open]:slide-in-from-top-[48%]"

// Phones (<sm): turn it into a bottom sheet — full width, anchored to the
// bottom, within thumb reach. Applied AFTER the caller's className so it wins
// on phones only; the slide-up animation lives in `.responsive-sheet`
// (globals.css) and the zoom one is limited to sm+.
const PHONE_SHEET =
  "responsive-sheet max-sm:inset-x-0 max-sm:bottom-0 max-sm:top-auto max-sm:left-0 max-sm:translate-x-0 max-sm:translate-y-0 max-sm:w-full max-sm:max-w-none max-sm:max-h-[92dvh] max-sm:rounded-b-none max-sm:rounded-t-2xl max-sm:border-x-0 max-sm:border-b-0"

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    /**
     * Phones open dialogs as a bottom sheet (default). Pass `false` for
     * dialogs that position themselves (command palette anchored at the top).
     */
    mobileSheet?: boolean
  }
>(({ className, children, onCloseAutoFocus, mobileSheet = true, ...props }, ref) => {
  useUnstickBodyPointerEvents()
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={
          mobileSheet
            ? cn(BASE, ZOOM_ANIMATION_SM, className, PHONE_SHEET)
            : cn(BASE, ZOOM_ANIMATION, "sm:rounded-lg", className)
        }
        onCloseAutoFocus={(e) => {
          onCloseAutoFocus?.(e)
          if (typeof document !== "undefined" && document.body.style.pointerEvents === "none") {
            document.body.style.pointerEvents = ""
          }
        }}
        {...props}
      >
        {mobileSheet && (
          <div
            className="sm:hidden mx-auto -mt-2 -mb-2 h-1.5 w-10 shrink-0 rounded-full bg-muted-foreground/30"
            aria-hidden="true"
          />
        )}
        {children}
        <DialogPrimitive.Close className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-md opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11">
          <X className="h-4 w-4" />
          <span className="sr-only">Cerrar</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  )
})
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-1.5 text-center sm:text-left",
      className
    )}
    {...props}
  />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className
    )}
    {...props}
  />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-lg font-semibold leading-none tracking-tight",
      className
    )}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
