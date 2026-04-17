import Link from "next/link"
import { Plus, Store, AlertTriangle, Landmark } from "lucide-react"
import { Badge } from "@/components/ui/badge"

interface QuickActionsProps {
  cobrosPendientesCount: number
}

export function QuickActions({ cobrosPendientesCount }: QuickActionsProps) {
  const actions = [
    {
      label: "Nueva Orden",
      href: "/ordenes?nueva=1",
      icon: Plus,
      className: "bg-primary text-primary-foreground hover:bg-primary/90",
    },
    {
      label: "Ir al POS",
      href: "/pos",
      icon: Store,
      className: "bg-green-600 text-white hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600",
    },
    {
      label: "Ver Cobros Pendientes",
      href: "/ordenes?estado_cobro=PENDIENTE",
      icon: AlertTriangle,
      className: "bg-amber-500 text-amber-950 hover:bg-amber-600 dark:bg-amber-600 dark:hover:bg-amber-500",
      badge: cobrosPendientesCount > 0 ? cobrosPendientesCount : undefined,
    },
    {
      label: "Abrir Caja del Día",
      href: "/caja",
      icon: Landmark,
      className: "bg-muted text-foreground hover:bg-muted/80 border border-border",
    },
  ]

  return (
    <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-thin">
      {actions.map((action) => {
        const Icon = action.icon
        return (
          <Link
            key={action.href}
            href={action.href}
            className={`
              inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium
              whitespace-nowrap transition-all duration-200 shrink-0
              ${action.className}
            `}
          >
            <Icon className="h-4 w-4" />
            {action.label}
            {action.badge !== undefined && (
              <Badge variant="secondary" className="ml-1 bg-white/20 text-inherit text-[10px] px-1.5 py-0">
                {action.badge}
              </Badge>
            )}
          </Link>
        )
      })}
    </div>
  )
}
