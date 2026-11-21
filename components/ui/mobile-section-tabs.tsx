"use client"

import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

export interface MobileSection<K extends string> {
  key: K
  label: string
  icon?: LucideIcon
  /** Shows an attention dot (pending balance, open session…). */
  alert?: boolean
}

interface MobileSectionTabsProps<K extends string> {
  sections: MobileSection<K>[]
  value: K
  onChange: (key: K) => void
  /** Accessible name of the tab list. */
  label: string
  /** Breakpoint from which the switcher disappears (content shows all at once). */
  hideFrom?: "md" | "lg"
  className?: string
}

/**
 * Segmented section switcher for the mobile/app layout: long screens are split
 * into sections instead of one endless scroll. Pair it with
 * `mobileSectionClass(active, key, hideFrom)` on each section so wider screens
 * keep showing everything.
 */
export function MobileSectionTabs<K extends string>({
  sections,
  value,
  onChange,
  label,
  hideFrom = "lg",
  className,
}: MobileSectionTabsProps<K>) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn(
        "grid gap-1 rounded-lg bg-muted p-1",
        hideFrom === "md" ? "md:hidden" : "lg:hidden",
        className
      )}
      style={{ gridTemplateColumns: `repeat(${sections.length}, minmax(0, 1fr))` }}
    >
      {sections.map((s) => {
        const Icon = s.icon
        const active = value === s.key
        return (
          <button
            key={s.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(s.key)}
            className={cn(
              "relative flex items-center justify-center rounded-md text-xs font-medium transition-colors",
              Icon ? "flex-col gap-0.5 py-1.5" : "py-2",
              active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
            )}
          >
            {Icon && <Icon className="h-4 w-4" aria-hidden />}
            <span className="truncate">{s.label}</span>
            {s.alert && (
              <span className="absolute right-2 top-1 h-2 w-2 rounded-full bg-amber-500" aria-hidden />
            )}
          </button>
        )
      })}
    </div>
  )
}

/** Class that hides a section below `hideFrom` unless it is the active one. */
export function mobileSectionClass<K extends string>(active: K, key: K, hideFrom: "md" | "lg" = "lg"): string {
  if (active === key) return ""
  return hideFrom === "md" ? "max-md:hidden" : "max-lg:hidden"
}
