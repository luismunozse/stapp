import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

interface FieldSectionLabelProps {
  icon?: LucideIcon
  children: React.ReactNode
  className?: string
}

/**
 * Small overline label for a field/section inside a detail panel
 * (e.g. "PROBLEMA", "DIAGNÓSTICO"). Standardizes the repeated
 * `text-xs font-medium uppercase tracking-wider text-muted-foreground`
 * + icon cluster.
 */
export function FieldSectionLabel({
  icon: Icon,
  children,
  className,
}: FieldSectionLabelProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground",
        className
      )}
    >
      {Icon && <Icon className="h-4 w-4" />}
      <span>{children}</span>
    </div>
  )
}
