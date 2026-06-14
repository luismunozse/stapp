import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { PageHeader } from "./page-header"

interface PageShellProps {
  /** Page title — forwarded to PageHeader. Omit when passing a custom `header`. */
  title?: string
  /** Supporting line under the title. */
  description?: string
  /** Right-aligned action slot in the header. */
  actions?: React.ReactNode
  /** Optional leading icon chip in the header. */
  icon?: LucideIcon
  /** When set, the header shows a ghost back button (←) linking here. */
  backHref?: string
  /** Accessible label for the back button. Defaults to "Volver". */
  backLabel?: string
  /** Escape hatch: render a fully custom header instead of the title/description props. */
  header?: React.ReactNode
  children: React.ReactNode
  className?: string
}

/**
 * Page-level wrapper that standardizes vertical rhythm and the header.
 * The dashboard layout (SidebarMain) already supplies page padding, so this
 * only owns the `space-y-6` stack + a consistent PageHeader.
 *
 *   <PageShell title="Órdenes de Servicio" description="…" actions={<Button…/>}>
 *     <OrdenesList />
 *   </PageShell>
 */
export function PageShell({
  title,
  description,
  actions,
  icon,
  backHref,
  backLabel,
  header,
  children,
  className,
}: PageShellProps) {
  return (
    <div className={cn("space-y-6", className)}>
      {header ??
        (title && (
          <PageHeader
            title={title}
            description={description}
            actions={actions}
            icon={icon}
            backHref={backHref}
            backLabel={backLabel}
          />
        ))}
      {children}
    </div>
  )
}
