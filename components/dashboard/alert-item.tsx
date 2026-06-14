import Link from "next/link"
import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

export type AlertTone = "info" | "warning" | "danger" | "success"

interface AlertItemProps {
  icon: LucideIcon
  tone: AlertTone
  /** Header line of the alert. */
  title: React.ReactNode
  /** Optional sub-list (links / detail rows). Styled in the tone's muted ink. */
  children?: React.ReactNode
  /** When set, the whole alert becomes a link with a hover state. */
  href?: string
}

// One semantic scheme for every dashboard alert, replacing the per-alert
// rainbow of hardcoded purple/orange/amber/red blocks.
const TONE: Record<
  AlertTone,
  { box: string; hover: string; head: string; sub: string }
> = {
  info: {
    box: "bg-info-50 border-info/30 dark:bg-info-100/40 dark:border-info/20",
    hover: "hover:bg-info-100 dark:hover:bg-info-200/40",
    head: "text-info-700 dark:text-info-500",
    sub: "text-info-600 dark:text-info-500",
  },
  warning: {
    box: "bg-warning-50 border-warning/30 dark:bg-warning-100/40 dark:border-warning/20",
    hover: "hover:bg-warning-100 dark:hover:bg-warning-200/40",
    head: "text-warning-700 dark:text-warning-600",
    sub: "text-warning-700/80 dark:text-warning-600/80",
  },
  danger: {
    box: "bg-destructive/10 border-destructive/25",
    hover: "hover:bg-destructive/15",
    head: "text-destructive",
    sub: "text-destructive/85",
  },
  success: {
    box: "bg-success-50 border-success/30 dark:bg-success-100/40 dark:border-success/20",
    hover: "hover:bg-success-100 dark:hover:bg-success-200/40",
    head: "text-success-700 dark:text-success-500",
    sub: "text-success-600 dark:text-success-500",
  },
}

export function AlertItem({
  icon: Icon,
  tone,
  title,
  children,
  href,
}: AlertItemProps) {
  const t = TONE[tone]
  const inner = (
    <>
      <div className={cn("flex items-center gap-2 text-sm font-medium", t.head)}>
        <Icon className="h-4 w-4 flex-shrink-0" />
        <span>{title}</span>
      </div>
      {children && (
        <div className={cn("mt-2 space-y-1 text-sm", t.sub)}>{children}</div>
      )}
    </>
  )

  if (href) {
    return (
      <Link
        href={href}
        className={cn(
          "block rounded-lg border p-3 transition-colors",
          t.box,
          t.hover
        )}
      >
        {inner}
      </Link>
    )
  }

  return <div className={cn("rounded-lg border p-3", t.box)}>{inner}</div>
}
