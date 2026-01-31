"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Loader2, Play } from "lucide-react"

interface DemoButtonProps {
  variant?: "default" | "outline" | "ghost"
  size?: "default" | "sm" | "lg"
  className?: string
}

export function DemoButton({ variant = "outline", size = "default", className }: DemoButtonProps) {
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()

  const handleDemoLogin = async () => {
    try {
      setIsLoading(true)

      const response = await fetch("/api/auth/demo-login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      })

      const data = await response.json()

      if (response.ok && data.success) {
        // Redirigir al dashboard
        router.push(data.redirectUrl || "/dashboard")
      } else {
        // Mostrar error
        alert(data.error || "No se pudo iniciar la sesión demo")
        setIsLoading(false)
      }
    } catch (error) {
      console.error("Error al iniciar demo:", error)
      alert("Error al iniciar la sesión demo")
      setIsLoading(false)
    }
  }

  return (
    <Button
      variant={variant}
      size={size}
      onClick={handleDemoLogin}
      disabled={isLoading}
      className={className}
    >
      {isLoading ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Iniciando demo...
        </>
      ) : (
        <>
          <Play className="mr-2 h-4 w-4" />
          Probar Demo
        </>
      )}
    </Button>
  )
}
