import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export function SectionEyebrow({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <p
      className={cn(
        "mb-3 text-xs sm:text-sm font-semibold uppercase tracking-wider text-primary",
        className
      )}
    >
      {children}
    </p>
  )
}
