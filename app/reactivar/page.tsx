"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Loader2, CheckCircle2, AlertTriangle, CreditCard } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

export default function ReactivarPage() {
  const router = useRouter()
  const [state, setState] = useState<"loading" | "success" | "already_active" | "max_reached" | "error">("loading")
  const [days, setDays] = useState(7)

  useEffect(() => {
    const reactivar = async () => {
      try {
        const res = await fetch("/api/reactivar-trial", { method: "POST" })
        const data = await res.json()

        if (!res.ok) {
          setState("error")
          return
        }

        if (data.alreadyActive) {
          setState("already_active")
        } else if (data.maxReached) {
          setState("max_reached")
        } else if (data.success) {
          setDays(data.daysExtended || 7)
          setState("success")
        } else {
          setState("error")
        }
      } catch {
        setState("error")
      }
    }

    reactivar()
  }, [])

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/30 flex items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardContent className="pt-8 pb-8 text-center space-y-4">
          {state === "loading" && (
            <>
              <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
              <h2 className="text-xl font-bold">Reactivando tu cuenta...</h2>
              <p className="text-muted-foreground">Esto toma solo un momento</p>
            </>
          )}

          {state === "success" && (
            <>
              <div className="inline-flex p-4 rounded-full bg-green-100 dark:bg-green-950 mx-auto">
                <CheckCircle2 className="h-12 w-12 text-green-600" />
              </div>
              <h2 className="text-xl font-bold">¡Tu cuenta fue reactivada!</h2>
              <p className="text-muted-foreground">
                Tenés {days} días más para probar todas las funcionalidades de STApp.
              </p>
              <Button size="lg" className="w-full mt-4" onClick={() => router.push("/dashboard")}>
                Ir a mi taller
              </Button>
            </>
          )}

          {state === "already_active" && (
            <>
              <div className="inline-flex p-4 rounded-full bg-blue-100 dark:bg-blue-950 mx-auto">
                <CheckCircle2 className="h-12 w-12 text-blue-600" />
              </div>
              <h2 className="text-xl font-bold">Tu cuenta ya está activa</h2>
              <p className="text-muted-foreground">
                No necesitás hacer nada más. Entrá a tu taller y seguí trabajando.
              </p>
              <Button size="lg" className="w-full mt-4" onClick={() => router.push("/dashboard")}>
                Ir a mi taller
              </Button>
            </>
          )}

          {state === "max_reached" && (
            <>
              <div className="inline-flex p-4 rounded-full bg-amber-100 dark:bg-amber-950 mx-auto">
                <AlertTriangle className="h-12 w-12 text-amber-600" />
              </div>
              <h2 className="text-xl font-bold">Ya usaste tus extensiones</h2>
              <p className="text-muted-foreground">
                Suscribite al plan Premium para seguir usando STApp sin límites.
              </p>
              <Button size="lg" className="w-full mt-4" onClick={() => router.push("/suscripcion-requerida")}>
                <CreditCard className="h-4 w-4 mr-2" />
                Ver planes
              </Button>
            </>
          )}

          {state === "error" && (
            <>
              <div className="inline-flex p-4 rounded-full bg-red-100 dark:bg-red-950 mx-auto">
                <AlertTriangle className="h-12 w-12 text-red-600" />
              </div>
              <h2 className="text-xl font-bold">Algo salió mal</h2>
              <p className="text-muted-foreground">
                No pudimos reactivar tu cuenta. Intentá iniciar sesión primero.
              </p>
              <Button size="lg" variant="outline" className="w-full mt-4" onClick={() => router.push("/login")}>
                Ir a iniciar sesión
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
