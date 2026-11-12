import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { CheckCircle, XCircle, AlertTriangle, Info } from "lucide-react"
import { cn } from "@/lib/utils"
import { ESTADO_ORDEN_UI, getEstadoOrdenUi } from "@/lib/estado-orden-ui"
import { statusToneClasses } from "@/components/ui/status-pill"

const ordenVariant = (estado: keyof typeof ESTADO_ORDEN_UI) =>
  statusToneClasses(ESTADO_ORDEN_UI[estado].tone)

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
        outline: "text-foreground border-border",
        success:
          "border-transparent bg-success text-success-foreground hover:bg-success/80",
        warning:
          "border-transparent bg-warning text-warning-foreground hover:bg-warning/80",
        info: "border-transparent bg-info text-info-foreground hover:bg-info/80",
        // Variantes soft (fondo tintado y texto 700): las que van en píldoras de
        // estado. Los tokens -50/-200/-700 ya se invierten en `.dark`.
        successSoft: statusToneClasses("success"),
        warningSoft: statusToneClasses("warning"),
        infoSoft: statusToneClasses("info"),
        destructiveSoft: statusToneClasses("danger"),
        // Estados de órdenes: salen de lib/estado-orden-ui.ts (fuente única).
        recibido: ordenVariant("RECIBIDO"),
        en_diagnostico: ordenVariant("EN_DIAGNOSTICO"),
        presupuestado: ordenVariant("PRESUPUESTADO"),
        aprobado: ordenVariant("APROBADO"),
        en_reparacion: ordenVariant("EN_REPARACION"),
        esperando_repuesto: ordenVariant("ESPERANDO_REPUESTO"),
        reparado: ordenVariant("REPARADO"),
        entregado: ordenVariant("ENTREGADO"),
        entregado_sin_reparacion: ordenVariant("ENTREGADO_SIN_REPARACION"),
        entregado_sin_cobro: ordenVariant("ENTREGADO_SIN_COBRO"),
        cancelado: ordenVariant("CANCELADO"),
        sin_reparacion: ordenVariant("SIN_REPARACION"),
        sin_falla_detectada: ordenVariant("SIN_FALLA_DETECTADA"),
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

// Iconos por variante para accesibilidad
const variantIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  success: CheckCircle,
  warning: AlertTriangle,
  destructive: XCircle,
  info: Info,
  successSoft: CheckCircle,
  warningSoft: AlertTriangle,
  infoSoft: Info,
  destructiveSoft: XCircle,
  ...Object.fromEntries(
    Object.entries(ESTADO_ORDEN_UI).map(([estado, ui]) => [estado.toLowerCase(), ui.icon])
  ),
}

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {
  /**
   * Show icon for the badge variant
   * Improves accessibility by not relying solely on color
   */
  showIcon?: boolean
  /**
   * Custom icon to display instead of the default variant icon
   */
  icon?: React.ComponentType<{ className?: string }>
}

function Badge({
  className,
  variant,
  showIcon = false,
  icon: CustomIcon,
  children,
  ...props
}: BadgeProps) {
  const Icon = CustomIcon || (variant ? variantIcons[variant] : undefined)
  const shouldShowIcon = showIcon && Icon

  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props}>
      {shouldShowIcon && <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />}
      {children}
    </div>
  )
}

// Variante de Badge para un estado de orden ("EN_REPARACION" → "en_reparacion").
function getOrderStatusVariant(status: string): BadgeProps["variant"] {
  const key = (status || "").trim().toUpperCase()
  return key in ESTADO_ORDEN_UI
    ? (key.toLowerCase() as BadgeProps["variant"])
    : "default"
}

// Etiqueta legible de un estado de orden (fuente: lib/estado-orden-ui.ts).
function getOrderStatusLabel(status: string): string {
  return getEstadoOrdenUi(status).label
}

// Convenience component for order status badges
interface OrderStatusBadgeProps extends Omit<BadgeProps, "variant"> {
  status: string
}

function OrderStatusBadge({ status, showIcon = true, ...props }: OrderStatusBadgeProps) {
  return (
    <Badge variant={getOrderStatusVariant(status)} showIcon={showIcon} {...props}>
      {getOrderStatusLabel(status)}
    </Badge>
  )
}

// Payment status badge
function PaymentStatusBadge({
  status,
  showIcon = true,
  ...props
}: {
  status: string
  showIcon?: boolean
} & Omit<BadgeProps, "variant">) {
  const variantMap: Record<string, BadgeProps["variant"]> = {
    PENDIENTE: "warningSoft",
    PAGADO: "successSoft",
    PAGADO_PARCIAL: "infoSoft",
    PARCIAL: "infoSoft",
    COBRADO: "successSoft",
    ANULADA: "destructiveSoft",
  }
  const labelMap: Record<string, string> = {
    PENDIENTE: "Pendiente",
    PAGADO: "Pagado",
    PAGADO_PARCIAL: "Pago parcial",
    PARCIAL: "Cobro parcial",
    COBRADO: "Cobrado",
    ANULADA: "Anulada",
  }

  return (
    <Badge
      variant={variantMap[status] || "default"}
      showIcon={showIcon}
      {...props}
    >
      {labelMap[status] || status}
    </Badge>
  )
}

export {
  Badge,
  badgeVariants,
  OrderStatusBadge,
  PaymentStatusBadge,
  getOrderStatusVariant,
  getOrderStatusLabel,
}
