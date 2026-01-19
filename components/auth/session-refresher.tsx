"use client"

import { useSession, signOut } from "next-auth/react"
import { useEffect, useCallback, useRef } from "react"
import { usePathname, useRouter } from "next/navigation"

// Intervalo de verificación de sesión (cada 5 minutos)
const SESSION_CHECK_INTERVAL = 5 * 60 * 1000

// Rutas públicas que no requieren sesión
const PUBLIC_PATHS = [
  "/login",
  "/registro",
  "/forgot-password",
  "/reset-password",
  "/verificar-email",
  "/",
  "/pricing",
]

export function SessionRefresher({ children }: { children: React.ReactNode }) {
  const { data: session, status, update } = useSession()
  const pathname = usePathname()
  const router = useRouter()
  const lastActivityRef = useRef(Date.now())

  // Verificar si es ruta pública
  const isPublicPath = PUBLIC_PATHS.some(
    (path) => pathname === path || pathname?.startsWith("/api/")
  )

  // Actualizar timestamp de última actividad
  const updateActivity = useCallback(() => {
    lastActivityRef.current = Date.now()
  }, [])

  // Manejar error de sesión expirada
  const handleSessionError = useCallback(async () => {
    console.log("[SessionRefresher] Session expired, redirecting to login")
    await signOut({ redirect: false })
    router.push("/login?expired=true")
  }, [router])

  // Verificar y refrescar sesión
  const checkSession = useCallback(async () => {
    if (status !== "authenticated" || isPublicPath) return

    try {
      // Forzar actualización del token
      await update()
    } catch (error) {
      console.error("[SessionRefresher] Error updating session:", error)
    }
  }, [status, isPublicPath, update])

  // Detectar errores en la sesión
  useEffect(() => {
    if (session?.error === "RefreshTokenExpired") {
      handleSessionError()
    }
  }, [session?.error, handleSessionError])

  // Polling periódico para mantener sesión activa
  useEffect(() => {
    if (status !== "authenticated" || isPublicPath) return

    const interval = setInterval(() => {
      // Solo refrescar si hubo actividad reciente (últimos 30 minutos)
      const timeSinceActivity = Date.now() - lastActivityRef.current
      if (timeSinceActivity < 30 * 60 * 1000) {
        checkSession()
      }
    }, SESSION_CHECK_INTERVAL)

    return () => clearInterval(interval)
  }, [status, isPublicPath, checkSession])

  // Detectar actividad del usuario
  useEffect(() => {
    if (typeof window === "undefined") return

    const events = ["mousedown", "keydown", "touchstart", "scroll"]
    events.forEach((event) => {
      window.addEventListener(event, updateActivity, { passive: true })
    })

    return () => {
      events.forEach((event) => {
        window.removeEventListener(event, updateActivity)
      })
    }
  }, [updateActivity])

  // Refrescar sesión cuando la app vuelve al foco (importante para PWA)
  useEffect(() => {
    if (typeof window === "undefined") return

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && status === "authenticated") {
        checkSession()
      }
    }

    const handleFocus = () => {
      if (status === "authenticated") {
        checkSession()
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange)
    window.addEventListener("focus", handleFocus)

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange)
      window.removeEventListener("focus", handleFocus)
    }
  }, [status, checkSession])

  return <>{children}</>
}
