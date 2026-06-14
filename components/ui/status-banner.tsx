import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

export type BannerTone = "info" | "warning" | "success" | "danger"

interface StatusBannerProps {
  tone: BannerTone
  icon: LucideIcon
  children: React.ReactNode
  className?: string
}

// Single-line contextual banner with semantic tone, replacing repeated
// hardcoded `bg-{color}-50 border-{color}-200 text-{color}-600` strips.
const TONE: Record<BannerTone, string> = {
  info: "bg-info-50 border-info/30 text-info-700 dark:bg-info-100/40 dark:border-info/20 dark:text-info-500",
  warning:
    "bg-warning-50 border-warning/30 text-warning-700 dark:bg-warning-100/40 dark:border-warning/20 dark:text-warning-600",
  success:
    "bg-success-50 border-success/30 text-success-700 dark:bg-success-100/40 dark:border-success/20 dark:text-success-500",
  danger: "bg-destructive/10 border-destructive/25 text-destructive",
}

export function StatusBanner({
  tone,
  icon: Icon,
  children,
  className,
}: StatusBannerProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg border p-3 text-sm font-medium",
        TONE[tone],
        className
      )}
    >
      <Icon className="h-4 w-4 flex-shrink-0" />
      <span>{children}</span>
    </div>
  )
}
