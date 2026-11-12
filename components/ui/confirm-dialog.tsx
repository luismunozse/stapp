"use client"

import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"
import { AlertTriangle, CheckCircle, HelpCircle, Info, Trash2, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog"
import { cn } from "@/lib/utils"

/**
 * ConfirmDialog — el único diálogo de "¿seguro?" / "aviso" de la app.
 *
 * Montado sobre ResponsiveDialog: bottom-sheet en móvil (PRODUCT.md pide que
 * las confirmaciones sean hojas) y diálogo centrado en desktop.
 *
 * - `mode="confirm"` (default): dos botones, cancelar y confirmar.
 * - `mode="alert"`: un solo botón que cierra el diálogo. Reemplaza al viejo
 *   `AlertDialogCustom`.
 *
 * Los tonos usan los tokens de color del design system (`destructive`,
 * `warning-*`, `success-*`, `info-*`, `primary-*`), que ya se invierten en modo
 * oscuro: nada de `bg-red-100` crudo.
 */

export type ConfirmTone = "default" | "danger" | "warning" | "success" | "info"
/** `error` es el nombre que usaba AlertDialogCustom: equivale a `danger`. */
export type ConfirmVariant = ConfirmTone | "error"
export type ConfirmMode = "confirm" | "alert"

export interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: ReactNode
  /** `confirm` (dos botones) o `alert` (un botón que cierra). */
  mode?: ConfirmMode
  /** Tono visual. Default: `danger` en confirm, `info` en alert. */
  variant?: ConfirmVariant
  /** Texto del botón principal. Default: "Confirmar" / "Aceptar". */
  confirmText?: string
  /** Texto del botón secundario (solo en confirm). Pasá "" para ocultarlo. */
  cancelText?: string
  loading?: boolean
  /** En confirm es obligatorio en la práctica; en alert, el botón ya cierra. */
  onConfirm?: () => void
  onCancel?: () => void
  /** Reemplaza el ícono del tono. */
  icon?: LucideIcon
  /** Contenido extra entre el encabezado y los botones (por ejemplo, un resumen de datos). */
  children?: ReactNode
}

interface ToneConfig {
  icon: LucideIcon
  /** Ícono distinto cuando el diálogo es un aviso (p. ej. error ≠ borrar). */
  alertIcon?: LucideIcon
  badgeClass: string
  buttonVariant: "default" | "destructive"
}

const TONES: Record<ConfirmTone, ToneConfig> = {
  default: {
    icon: HelpCircle,
    badgeClass: "bg-primary-100 text-primary-600",
    buttonVariant: "default",
  },
  danger: {
    icon: Trash2,
    alertIcon: XCircle,
    badgeClass: "bg-destructive/10 text-destructive dark:bg-destructive/20",
    buttonVariant: "destructive",
  },
  warning: {
    icon: AlertTriangle,
    badgeClass: "bg-warning-100 text-warning-700",
    buttonVariant: "default",
  },
  success: {
    icon: CheckCircle,
    badgeClass: "bg-success-100 text-success-700",
    buttonVariant: "default",
  },
  info: {
    icon: Info,
    badgeClass: "bg-info-100 text-info-700",
    buttonVariant: "default",
  },
}

function toTone(variant: ConfirmVariant): ConfirmTone {
  return variant === "error" ? "danger" : variant
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  mode = "confirm",
  variant,
  confirmText,
  cancelText = "Cancelar",
  loading = false,
  onConfirm,
  onCancel,
  icon,
  children,
}: ConfirmDialogProps) {
  const isAlert = mode === "alert"
  const tone = toTone(variant ?? (isAlert ? "info" : "danger"))
  const config = TONES[tone]
  const Icon = icon ?? (isAlert && config.alertIcon ? config.alertIcon : config.icon)
  const primaryText = confirmText || (isAlert ? "Aceptar" : "Confirmar")

  const handleCancel = () => {
    onCancel?.()
    onOpenChange(false)
  }

  const handlePrimary = () => {
    onConfirm?.()
    if (isAlert) onOpenChange(false)
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-md" data-mode={mode}>
        <ResponsiveDialogHeader className="pr-8 text-left">
          <div className="flex items-start gap-4">
            <div
              className={cn("shrink-0 rounded-full p-3", config.badgeClass)}
              data-tone={tone}
              aria-hidden="true"
            >
              <Icon className="h-6 w-6" />
            </div>
            <div className="min-w-0 space-y-1.5 pt-1">
              <ResponsiveDialogTitle className="leading-snug">{title}</ResponsiveDialogTitle>
              {/* overflow-wrap: un link o un código largo no rompe el ancho de la hoja. */}
              <ResponsiveDialogDescription className="[overflow-wrap:anywhere]">
                {description}
              </ResponsiveDialogDescription>
            </div>
          </div>
        </ResponsiveDialogHeader>
        {children}
        <ResponsiveDialogFooter className="gap-2 sm:gap-0">
          {!isAlert && cancelText && (
            <Button variant="outline" onClick={handleCancel} disabled={loading}>
              {cancelText}
            </Button>
          )}
          <Button
            variant={config.buttonVariant}
            onClick={handlePrimary}
            disabled={loading}
          >
            {loading ? "Procesando..." : primaryText}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
