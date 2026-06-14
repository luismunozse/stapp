import Link from "next/link"
import { ArrowLeft, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "./button"

interface PageHeaderProps {
  /** Page title. Rendered with the system `text-headline` scale. */
  title: string
  /** Optional supporting line under the title. */
  description?: string
  /** Right-aligned action slot (buttons, filters). Wraps below the title on mobile. */
  actions?: React.ReactNode
  /** Optional leading icon chip, keyed to the page domain. */
  icon?: LucideIcon
  /** When set, renders a ghost back button (←) linking here, before the title. */
  backHref?: string
  /** Accessible label for the back button. Defaults to "Volver". */
  backLabel?: string
  className?: string
}

/**
 * Standard page title block. Replaces the hand-rolled
 * `<div><h1 class="text-2xl sm:text-3xl font-bold">…</h1><p>…</p></div>`
 * that every screen wrote slightly differently. Uses the canonical
 * `.text-headline` scale so heading size/weight is identical app-wide.
 */
export function PageHeader({
  title,
  description,
  actions,
  icon: Icon,
  backHref,
  backLabel = "Volver",
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between",
        className
      )}
    >
      <div className="min-w-0 space-y-1">
        <div className="flex items-center gap-2 sm:gap-3">
          {backHref && (
            <Button
              asChild
              variant="ghost"
              size="icon"
              className="-ml-2 flex-shrink-0"
            >
              <Link href={backHref} aria-label={backLabel}>
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
          )}
          {Icon && (
            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-accent text-primary">
              <Icon className="h-5 w-5" />
            </span>
          )}
          <h1 className="text-headline text-balance">{title}</h1>
        </div>
        {description && (
          <p className="max-w-2xl text-pretty text-sm text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      )}
    </div>
  )
}
