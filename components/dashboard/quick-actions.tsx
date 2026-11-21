import Link from "next/link"
import { Plus, Store, AlertTriangle, Landmark } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { ordenesHref } from "@/lib/ordenes/filtros-url"

interface QuickActionsProps {
  cobrosPendientesCount: number
}

export function QuickActions({ cobrosPendientesCount }: QuickActionsProps) {
  const actions = [
    {
      label: "Nueva orden",
      shortLabel: "Nueva orden",
      href: "/ordenes?nueva=1",
      icon: Plus,
      className: "bg-primary text-primary-foreground hover:bg-primary/90",
    },
    {
      label: "Ir al POS",
      shortLabel: "POS",
      href: "/pos",
      icon: Store,
      className: "bg-green-600 text-white hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600",
    },
    {
      label: "Ver cobros pendientes",
      shortLabel: "Cobros",
      href: ordenesHref({ filtro: "pendientesCobro" }),
      icon: AlertTriangle,
      className: "bg-amber-500 text-amber-950 hover:bg-amber-600 dark:bg-amber-600 dark:hover:bg-amber-500",
      badge: cobrosPendientesCount > 0 ? cobrosPendientesCount : undefined,
    },
    {
      label: "Abrir caja del día",
      shortLabel: "Caja",
      href: "/caja",
      icon: Landmark,
      className: "bg-muted text-foreground hover:bg-muted/80 border border-border",
    },
  ]

  return (
    <>
      {/* Mobile/app: a 4-up icon grid fits in one row, no sideways scroll */}
      <div className="grid grid-cols-4 gap-2 sm:hidden">
        {actions.map((action) => {
          const Icon = action.icon
          return (
            <Link
              key={action.href}
              href={action.href}
              aria-label={action.label}
              className={`
                relative flex flex-col items-center justify-center gap-1 rounded-xl px-1 py-2.5
                text-xs font-medium leading-tight text-center transition-colors
                active:scale-[0.97] motion-safe:transition-transform
                ${action.className}
              `}
            >
              <Icon className="h-5 w-5" aria-hidden />
              <span className="line-clamp-1">{action.shortLabel}</span>
              {action.badge !== undefined && (
                <span className="absolute -top-1.5 -right-1 min-w-5 rounded-full bg-destructive px-1 text-center text-xs font-semibold leading-5 text-white shadow">
                  {action.badge}
                </span>
              )}
            </Link>
          )
        })}
      </div>

      <div className="hidden sm:flex gap-3 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-thin">
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
                <Badge variant="secondary" className="ml-1 bg-white/20 text-inherit text-xs px-1.5 py-0">
                  {action.badge}
                </Badge>
              )}
            </Link>
          )
        })}
      </div>
    </>
  )
}
