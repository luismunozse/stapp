import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import {
  CheckCircle,
  XCircle,
  AlertTriangle,
  Info,
  Clock,
  Wrench,
  Package,
  FileCheck,
  Truck,
  Ban,
  CircleDot,
  HandCoins,
} from "lucide-react"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
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
        // Soft (tinted) variants — the light bg + colored text/border look used
        // for status pills, replacing scattered `bg-X-50 text-X-700 border-X-200`.
        successSoft:
          "border-success/30 bg-success-50 text-success-700 dark:bg-success/15 dark:text-success-400",
        warningSoft:
          "border-warning/30 bg-warning-50 text-warning-700 dark:bg-warning/15 dark:text-warning-500",
        infoSoft:
          "border-info/30 bg-info-50 text-info-700 dark:bg-info/15 dark:text-info-400",
        destructiveSoft:
          "border-destructive/30 bg-destructive/10 text-destructive",
        // Estados de órdenes con colores semánticos
        recibido:
          "border-transparent bg-slate-500 text-white",
        en_diagnostico:
          "border-transparent bg-purple-500 text-white",
        presupuestado:
          "border-transparent bg-amber-500 text-white",
        aprobado:
          "border-transparent bg-info text-info-foreground",
        en_reparacion:
          "border-transparent bg-warning text-warning-foreground",
        esperando_repuesto:
          "border-transparent bg-orange-500 text-white",
        reparado:
          "border-transparent bg-cyan-500 text-white",
        entregado:
          "border-transparent bg-success text-success-foreground",
        entregado_sin_reparacion:
          "border-transparent bg-amber-500 text-white",
        entregado_sin_cobro:
          "border-transparent bg-emerald-500 text-white",
        cancelado:
          "border-transparent bg-muted text-muted-foreground",
        sin_reparacion:
          "border-transparent bg-destructive text-destructive-foreground",
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
  recibido: Clock,
  en_diagnostico: Wrench,
  presupuestado: FileCheck,
  aprobado: CheckCircle,
  en_reparacion: Wrench,
  esperando_repuesto: Package,
  reparado: CheckCircle,
  entregado: Truck,
  entregado_sin_reparacion: Package,
  entregado_sin_cobro: HandCoins,
  cancelado: Ban,
  sin_reparacion: XCircle,
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

// Helper function to get badge variant from order status
function getOrderStatusVariant(status: string): BadgeProps["variant"] {
  const statusMap: Record<string, BadgeProps["variant"]> = {
    RECIBIDO: "recibido",
    EN_DIAGNOSTICO: "en_diagnostico",
    PRESUPUESTADO: "presupuestado",
    APROBADO: "aprobado",
    EN_REPARACION: "en_reparacion",
    ESPERANDO_REPUESTO: "esperando_repuesto",
    REPARADO: "reparado",
    ENTREGADO: "entregado",
    ENTREGADO_SIN_REPARACION: "entregado_sin_reparacion",
    ENTREGADO_SIN_COBRO: "entregado_sin_cobro",
    CANCELADO: "cancelado",
    SIN_REPARACION: "sin_reparacion",
  }
  return statusMap[status] || "default"
}

// Helper function to get readable status label
function getOrderStatusLabel(status: string): string {
  const labelMap: Record<string, string> = {
    RECIBIDO: "Recibido",
    EN_DIAGNOSTICO: "En Diagnóstico",
    PRESUPUESTADO: "Presupuestado",
    APROBADO: "Aprobado",
    EN_REPARACION: "En Reparación",
    ESPERANDO_REPUESTO: "Esperando Repuesto",
    REPARADO: "Reparado",
    ENTREGADO: "Entregado",
    ENTREGADO_SIN_REPARACION: "Retirado sin Reparación",
    ENTREGADO_SIN_COBRO: "Entregado sin Cobro",
    CANCELADO: "Cancelado",
    SIN_REPARACION: "Sin Reparación",
  }
  return labelMap[status] || status
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
    PENDIENTE: "warning",
    PAGADO: "success",
    PAGADO_PARCIAL: "info",
    ANULADA: "destructive",
  }
  const labelMap: Record<string, string> = {
    PENDIENTE: "Pendiente",
    PAGADO: "Pagado",
    PAGADO_PARCIAL: "Pago Parcial",
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
