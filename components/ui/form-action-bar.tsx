"use client"

import { cn } from "@/lib/utils"

interface FormActionBarProps {
  children: React.ReactNode
  className?: string
  /** When true, the bar is sticky on all screens. Default: sticky on mobile only. */
  alwaysSticky?: boolean
  /**
   * Set to true when the form is rendered inside a Dialog/Sheet (DialogContent
   * scroll container). The sticky bar then anchors to the bottom of the
   * dialog instead of clearing the page-level bottom-nav. Default false ⇒
   * assumes a full-page form, so sticky-bottom shifts up by the mobile
   * bottom-nav height (4rem + safe-area).
   */
  inDialog?: boolean
}

export function FormActionBar({ children, className, alwaysSticky = false, inDialog = false }: FormActionBarProps) {
  // Mobile sticky bottom offset: clears the fixed bottom-nav (h-16 + safe-area)
  // on full-page forms; sits flush with the dialog bottom when inDialog is on.
  // In a dialog the bar spans the sheet edge to edge (DialogContent has p-6;
  // -bottom-6 because sticky stops at the scroll box's padding edge)
  // and, on phones, its buttons share the width like an app's bottom actions.
  const mobileSticky = inDialog
    ? "sticky -bottom-6 -mx-6 -mb-6 px-6 py-3 bg-background/95 backdrop-blur-sm border-t pb-[max(0.75rem,env(safe-area-inset-bottom))] z-10 max-sm:[&>button]:h-11 max-sm:[&>button]:flex-1"
    : "sticky bottom-[calc(4rem+env(safe-area-inset-bottom,0px))] -mx-4 px-4 py-3 bg-background/95 backdrop-blur-sm border-t pb-3 z-10"

  return (
    <div
      className={cn(
        "flex gap-2 justify-end",
        alwaysSticky
          ? mobileSticky
          : `${mobileSticky} sm:static sm:bg-transparent sm:border-0 sm:mx-0 sm:mb-0 sm:bottom-0 sm:px-0 sm:py-0 sm:pb-0 sm:backdrop-blur-none`,
        className
      )}
    >
      {children}
    </div>
  )
}
