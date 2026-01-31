"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"

export default function DemoPage() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const loginToDemo = async () => {
      try {
        const response = await fetch("/api/auth/demo-login", {
          method: "POST",
        })

        const data = await response.json()

        if (response.ok && data.success) {
          // Redirigir al dashboard
          router.push(data.redirectUrl || "/dashboard")
        } else {
          setError(data.message || "No se pudo iniciar sesión con la cuenta demo")
        }
      } catch (err) {
        console.error("Error al iniciar sesión demo:", err)
        setError("Error al conectar con el servidor")
      }
    }

    loginToDemo()
  }, [router])

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <div className="text-destructive text-lg font-semibold">{error}</div>
          <button
            onClick={() => router.push("/")}
            className="text-primary hover:underline"
          >
            Volver al inicio
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center space-y-4">
        <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
        <h2 className="text-xl font-semibold">Iniciando sesión demo...</h2>
        <p className="text-muted-foreground">Serás redirigido al dashboard en un momento</p>
      </div>
    </div>
  )
}
