"use client"

import { cn } from "@/lib/utils"

interface FormActionBarProps {
  children: React.ReactNode
  className?: string
  /** When true, the bar is sticky on all screens. Default: sticky on mobile only. */
  alwaysSticky?: boolean
}

export function FormActionBar({ children, className, alwaysSticky = false }: FormActionBarProps) {
  return (
    <div
      className={cn(
        "flex gap-2 justify-end",
        alwaysSticky
          ? "sticky bottom-0 -mx-4 px-4 py-3 bg-background/95 backdrop-blur-sm border-t pb-[max(0.75rem,env(safe-area-inset-bottom))] z-10"
          : "sticky bottom-0 -mx-4 px-4 py-3 bg-background/95 backdrop-blur-sm border-t pb-[max(0.75rem,env(safe-area-inset-bottom))] z-10 sm:static sm:bg-transparent sm:border-0 sm:mx-0 sm:px-0 sm:py-0 sm:pb-0 sm:backdrop-blur-none",
        className
      )}
    >
      {children}
    </div>
  )
}
