"use client"

import { cn } from "@/lib/utils"

interface STAppLogoProps {
  className?: string
  size?: "xs" | "sm" | "md" | "lg" | "xl"
  variant?: "full" | "icon"
  showText?: boolean
}

const sizeConfig = {
  xs: { icon: 20, text: "text-sm", gap: "gap-0.5" },
  sm: { icon: 28, text: "text-lg", gap: "gap-1" },
  md: { icon: 36, text: "text-xl", gap: "gap-1" },
  lg: { icon: 48, text: "text-2xl", gap: "gap-1.5" },
  xl: { icon: 64, text: "text-3xl", gap: "gap-2" },
}

export function STAppLogo({
  className,
  size = "md",
  variant = "full",
  showText = true
}: STAppLogoProps) {
  const { icon, text, gap } = sizeConfig[size]
  const displayText = variant === "full" && showText

  return (
    <div className={cn("flex items-center", gap, className)}>
      <svg
        width={icon}
        height={icon}
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="flex-shrink-0"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="stappDeviceGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" className="[stop-color:hsl(var(--primary))]" />
            <stop offset="100%" className="[stop-color:hsl(var(--primary)/0.7)]" />
          </linearGradient>
        </defs>
        {/* Phone body */}
        <rect
          x="10"
          y="4"
          width="28"
          height="40"
          rx="6"
          fill="url(#stappDeviceGradient)"
        />
        {/* Screen */}
        <rect
          x="14"
          y="10"
          width="20"
          height="28"
          rx="2"
          className="fill-background"
        />
        {/* Circuit lines on screen */}
        <path
          d="M18 18h4v4h6v-4h2M18 26h10M22 26v6"
          className="stroke-primary"
          strokeWidth="1.5"
          strokeLinecap="round"
          fill="none"
        />
        {/* Circuit nodes */}
        <circle cx="18" cy="18" r="1.5" className="fill-primary" />
        <circle cx="28" cy="26" r="1.5" className="fill-primary" />
        <circle cx="22" cy="32" r="1.5" className="fill-primary" />
        {/* Notch */}
        <rect x="20" y="6" width="8" height="2" rx="1" className="fill-background/50" />
        {/* Home bar */}
        <rect x="18" y="40" width="12" height="2" rx="1" className="fill-white/30" />
      </svg>
      {displayText && (
        <span className={cn("font-bold tracking-tight", text)}>
          <span className="text-primary">ST</span>
          <span className="text-foreground">App</span>
        </span>
      )}
    </div>
  )
}
