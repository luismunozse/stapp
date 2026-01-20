"use client"

import { useSession, signOut, signIn } from "next-auth/react"
import { useEffect, useCallback, useRef, useState } from "react"
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

// Claves de localStorage para PWA
const PWA_REFRESH_TOKEN_KEY = "pwa_refresh_token"
const PWA_REFRESH_TOKEN_EXPIRES_KEY = "pwa_refresh_token_expires"

export function SessionRefresher({ children }: { children: React.ReactNode }) {
  const { data: session, status, update } = useSession()
  const pathname = usePathname()
  const router = useRouter()
  const lastActivityRef = useRef(Date.now())
  const [isRestoring, setIsRestoring] = useState(false)
  const restorationAttemptedRef = useRef(false)

  // Verificar si es ruta pública
  const isPublicPath = PUBLIC_PATHS.some(
    (path) => pathname === path || pathname?.startsWith("/api/")
  )

  // Actualizar timestamp de última actividad
  const updateActivity = useCallback(() => {
    lastActivityRef.current = Date.now()
  }, [])

  // Limpiar tokens de localStorage
  const clearPWATokens = useCallback(() => {
    if (typeof window !== "undefined") {
      localStorage.removeItem(PWA_REFRESH_TOKEN_KEY)
      localStorage.removeItem(PWA_REFRESH_TOKEN_EXPIRES_KEY)
    }
  }, [])

  // Intentar restaurar sesión usando refresh token de localStorage (para PWA)
  const tryRestoreSession = useCallback(async () => {
    if (typeof window === "undefined") return false
    if (restorationAttemptedRef.current) return false

    const refreshToken = localStorage.getItem(PWA_REFRESH_TOKEN_KEY)
    const expiresAt = localStorage.getItem(PWA_REFRESH_TOKEN_EXPIRES_KEY)

    if (!refreshToken) return false

    // Verificar si el token no ha expirado
    if (expiresAt) {
      const expires = new Date(expiresAt)
      if (expires < new Date()) {
        console.log("[SessionRefresher] PWA refresh token expired, clearing")
        clearPWATokens()
        return false
      }
    }

    console.log("[SessionRefresher] Attempting to restore session from PWA token")
    restorationAttemptedRef.current = true
    setIsRestoring(true)

    try {
      // Usar signIn con el refresh token
      const result = await signIn("credentials", {
        pwaRefreshToken: refreshToken,
        redirect: false,
      })

      if (result?.ok && !result?.error) {
        console.log("[SessionRefresher] Session restored successfully")

        // Obtener el nuevo refresh token y guardarlo
        try {
          const tokenRes = await fetch("/api/auth/get-refresh-token")
          if (tokenRes.ok) {
            const { refreshToken: newToken, expiresAt: newExpires } = await tokenRes.json()
            localStorage.setItem(PWA_REFRESH_TOKEN_KEY, newToken)
            localStorage.setItem(PWA_REFRESH_TOKEN_EXPIRES_KEY, newExpires)
          }
        } catch (e) {
          console.error("[SessionRefresher] Error updating stored refresh token:", e)
        }

        // Recargar la página para aplicar la sesión completamente
        window.location.reload()
        return true
      } else {
        console.log("[SessionRefresher] Failed to restore session, clearing tokens")
        clearPWATokens()
        return false
      }
    } catch (error) {
      console.error("[SessionRefresher] Error restoring session:", error)
      clearPWATokens()
      return false
    } finally {
      setIsRestoring(false)
    }
  }, [clearPWATokens])

  // Manejar error de sesión expirada
  const handleSessionError = useCallback(async () => {
    console.log("[SessionRefresher] Session expired, clearing PWA tokens")
    clearPWATokens()
    await signOut({ redirect: false })
    router.push("/login?expired=true")
  }, [router, clearPWATokens])

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

  // Intentar restaurar sesión si no hay sesión activa (para PWA)
  useEffect(() => {
    // Solo intentar si:
    // - El estado de sesión ya se cargó (no está "loading")
    // - No hay sesión autenticada
    // - No estamos en una ruta pública
    // - No estamos ya intentando restaurar
    if (
      status === "unauthenticated" &&
      !isPublicPath &&
      !isRestoring &&
      !restorationAttemptedRef.current
    ) {
      tryRestoreSession()
    }
  }, [status, isPublicPath, isRestoring, tryRestoreSession])

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
      if (document.visibilityState === "visible") {
        if (status === "authenticated") {
          checkSession()
        } else if (status === "unauthenticated" && !isPublicPath && !restorationAttemptedRef.current) {
          // Intentar restaurar sesión si no hay sesión al volver al foco
          restorationAttemptedRef.current = false // Reset para permitir nuevo intento
          tryRestoreSession()
        }
      }
    }

    const handleFocus = () => {
      if (status === "authenticated") {
        checkSession()
      } else if (status === "unauthenticated" && !isPublicPath && !restorationAttemptedRef.current) {
        restorationAttemptedRef.current = false
        tryRestoreSession()
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange)
    window.addEventListener("focus", handleFocus)

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange)
      window.removeEventListener("focus", handleFocus)
    }
  }, [status, isPublicPath, checkSession, tryRestoreSession])

  // Mostrar indicador de carga mientras restaura
  if (isRestoring) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Restaurando sesión...</p>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
