"use client"

import * as React from "react"
import Link from "next/link"
import { Plus } from "lucide-react"
import { cn } from "@/lib/utils"

interface FabProps {
  href?: string
  onClick?: () => void
  icon?: React.ReactNode
  label: string
  className?: string
}

export function Fab({ href, onClick, icon, label, className }: FabProps) {
  const inner = (
    <span
      className={cn(
        "fixed right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 active:scale-95 transition-transform",
        "bottom-[calc(5rem+env(safe-area-inset-bottom,0px))] lg:hidden",
        className
      )}
      aria-label={label}
    >
      {icon ?? <Plus className="h-6 w-6" />}
    </span>
  )

  if (href) return <Link href={href}>{inner}</Link>
  return (
    <button type="button" onClick={onClick} className="contents">
      {inner}
    </button>
  )
}
