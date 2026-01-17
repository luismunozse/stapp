"use client"

import { useState, useEffect } from "react"
import Image from "next/image"
import { cn } from "@/lib/utils"

interface BusinessLogoProps {
  className?: string
  textClassName?: string
  imageClassName?: string
  size?: "sm" | "md" | "lg" | "xl"
  showText?: boolean
}

interface LogoData {
  hasLogo: boolean
  logoUrl?: string
  nombreEmpresa: string
}

const sizeMap = {
  sm: { width: 32, height: 32, text: "text-lg" },
  md: { width: 48, height: 48, text: "text-xl" },
  lg: { width: 64, height: 64, text: "text-2xl" },
  xl: { width: 180, height: 60, text: "text-3xl" },
}

export function BusinessLogo({
  className,
  textClassName,
  imageClassName,
  size = "md",
  showText = true,
}: BusinessLogoProps) {
  const [logoData, setLogoData] = useState<LogoData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/logo")
      .then(res => res.json())
      .then(data => {
        setLogoData(data)
        setLoading(false)
      })
      .catch(() => {
        setLogoData({ hasLogo: false, nombreEmpresa: "STApp" })
        setLoading(false)
      })
  }, [])

  const { width, height, text } = sizeMap[size]

  if (loading) {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        <div
          className="animate-pulse bg-muted rounded"
          style={{ width, height }}
        />
        {showText && (
          <div className="animate-pulse bg-muted rounded h-6 w-32" />
        )}
      </div>
    )
  }

  // Si hay logo de organización, mostrarlo
  if (logoData?.hasLogo && logoData.logoUrl) {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        <Image
          src={logoData.logoUrl}
          alt={logoData.nombreEmpresa}
          width={width}
          height={height}
          className={cn("object-contain", imageClassName)}
          unoptimized
        />
        {showText && (
          <span className={cn("font-bold", text, textClassName)}>
            {logoData.nombreEmpresa}
          </span>
        )}
      </div>
    )
  }

  // Fallback: mostrar logo de STApp
  return (
    <div className={cn("flex items-center justify-center", className)}>
      <Image
        src="/logo.png"
        alt="STApp"
        width={size === "xl" ? 200 : size === "lg" ? 150 : 120}
        height={size === "xl" ? 60 : size === "lg" ? 45 : 36}
        className={cn("object-contain dark:invert", imageClassName)}
        priority
      />
    </div>
  )
}
