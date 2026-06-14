import type React from "react"
import { cn } from "@/lib/utils"

interface ContactRowProps {
  icon: React.ComponentType<{ className?: string }>
  /** When present renders an <a>; otherwise a <div>. */
  href?: string
  children: React.ReactNode
  className?: string
  /** Extra classes applied to the icon element only (e.g. brand color). */
  iconClassName?: string
  /** Appends target="_blank" rel="noopener noreferrer". */
  external?: boolean
  /** Icon size variant: "sm" = h-4 w-4 (default), "xs" = h-3 w-3. */
  iconSize?: "sm" | "xs"
}

export function ContactRow({
  icon: Icon,
  href,
  children,
  className,
  iconClassName,
  external = false,
  iconSize = "sm",
}: ContactRowProps) {
  const iconCls = cn(
    iconSize === "xs" ? "h-3 w-3" : "h-4 w-4",
    "shrink-0",
    iconClassName ?? "text-muted-foreground",
  )

  const content = (
    <>
      <Icon className={iconCls} />
      {children}
    </>
  )

  const sharedCls = cn("flex items-center gap-2", className)

  if (href) {
    return (
      <a
        href={href}
        className={sharedCls}
        {...(external
          ? { target: "_blank", rel: "noopener noreferrer" }
          : {})}
      >
        {content}
      </a>
    )
  }

  return <div className={sharedCls}>{content}</div>
}
