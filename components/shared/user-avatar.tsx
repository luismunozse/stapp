"use client"

import Image from "next/image"
import { cn } from "@/lib/utils"
import { User } from "lucide-react"

interface UserAvatarProps {
  src?: string | null
  nombre?: string | null
  size?: "sm" | "md" | "lg"
  className?: string
}

const sizeMap = {
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-16 w-16 text-lg",
}

const imgSizeMap = {
  sm: 32,
  md: 40,
  lg: 64,
}

function getInitials(nombre: string): string {
  return nombre
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join("")
}

export function UserAvatar({ src, nombre, size = "md", className }: UserAvatarProps) {
  const initials = nombre ? getInitials(nombre) : ""

  if (src) {
    return (
      <div
        className={cn(
          "relative rounded-full overflow-hidden shrink-0 bg-muted",
          sizeMap[size],
          className
        )}
      >
        <Image
          src={src}
          alt={nombre || "Avatar"}
          width={imgSizeMap[size]}
          height={imgSizeMap[size]}
          className="object-cover w-full h-full"
          unoptimized
        />
      </div>
    )
  }

  return (
    <div
      className={cn(
        "rounded-full shrink-0 flex items-center justify-center bg-primary/10 text-primary font-medium",
        sizeMap[size],
        className
      )}
    >
      {initials || <User className="h-4 w-4" />}
    </div>
  )
}
