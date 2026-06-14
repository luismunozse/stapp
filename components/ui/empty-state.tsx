import { LucideIcon } from "lucide-react"
import { Button } from "./button"
import { cn } from "@/lib/utils"

type EmptyStateVariant = "default" | "search" | "error" | "success"

interface EmptyStateAction {
  label: string
  onClick: () => void
}

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description?: string
  /** Primary action (filled button). */
  action?: EmptyStateAction
  /** Optional secondary action (ghost button). */
  secondaryAction?: EmptyStateAction
  /** Tints the icon chip and conveys intent. Defaults to "default" (neutral). */
  variant?: EmptyStateVariant
  /** Extra content rendered below the actions (e.g. a help link). */
  children?: React.ReactNode
  className?: string
}

// Icon-chip treatment per variant: a layered ring (soft outer + tinted inner)
// instead of the old flat gray disk, which read as a generic placeholder.
const VARIANT_CHIP: Record<EmptyStateVariant, string> = {
  default: "bg-accent text-primary ring-primary/10",
  search: "bg-muted text-muted-foreground ring-border",
  error: "bg-destructive/10 text-destructive ring-destructive/15",
  success: "bg-success-50 text-success-600 ring-success-200",
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
  variant = "default",
  children,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center px-4 py-12 text-center",
        className
      )}
    >
      <div
        className={cn(
          "mb-4 flex h-16 w-16 items-center justify-center rounded-2xl ring-8",
          VARIANT_CHIP[variant]
        )}
      >
        <Icon className="h-7 w-7" />
      </div>
      <h3 className="mb-1 text-base font-semibold text-foreground">{title}</h3>
      {description && (
        <p className="mb-5 max-w-sm text-pretty text-sm text-muted-foreground">
          {description}
        </p>
      )}
      {(action || secondaryAction) && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {action && (
            <Button onClick={action.onClick} variant="default">
              {action.label}
            </Button>
          )}
          {secondaryAction && (
            <Button onClick={secondaryAction.onClick} variant="ghost">
              {secondaryAction.label}
            </Button>
          )}
        </div>
      )}
      {children && <div className="mt-4">{children}</div>}
    </div>
  )
}
