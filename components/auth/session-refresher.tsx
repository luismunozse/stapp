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

// IndexedDB como backup para iOS PWA (localStorage puede limpiarse)
const IDB_NAME = "stapp_auth"
const IDB_STORE = "tokens"

async function idbGet(key: string): Promise<string | null> {
  try {
    return await new Promise((resolve) => {
      const req = indexedDB.open(IDB_NAME, 1)
      req.onupgradeneeded = () => {
        req.result.createObjectStore(IDB_STORE)
      }
      req.onsuccess = () => {
        const tx = req.result.transaction(IDB_STORE, "readonly")
        const store = tx.objectStore(IDB_STORE)
        const get = store.get(key)
        get.onsuccess = () => resolve(get.result ?? null)
        get.onerror = () => resolve(null)
        tx.oncomplete = () => req.result.close()
      }
      req.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

async function idbSet(key: string, value: string): Promise<void> {
  try {
    await new Promise<void>((resolve) => {
      const req = indexedDB.open(IDB_NAME, 1)
      req.onupgradeneeded = () => {
        req.result.createObjectStore(IDB_STORE)
      }
      req.onsuccess = () => {
        const tx = req.result.transaction(IDB_STORE, "readwrite")
        tx.objectStore(IDB_STORE).put(value, key)
        tx.oncomplete = () => {
          req.result.close()
          resolve()
        }
        tx.onerror = () => {
          req.result.close()
          resolve()
        }
      }
      req.onerror = () => resolve()
    })
  } catch {
    // silenciar
  }
}

async function idbDelete(key: string): Promise<void> {
  try {
    await new Promise<void>((resolve) => {
      const req = indexedDB.open(IDB_NAME, 1)
      req.onupgradeneeded = () => {
        req.result.createObjectStore(IDB_STORE)
      }
      req.onsuccess = () => {
        const tx = req.result.transaction(IDB_STORE, "readwrite")
        tx.objectStore(IDB_STORE).delete(key)
        tx.oncomplete = () => {
          req.result.close()
          resolve()
        }
        tx.onerror = () => {
          req.result.close()
          resolve()
        }
      }
      req.onerror = () => resolve()
    })
  } catch {
    // silenciar
  }
}

/**
 * Guardar refresh token en localStorage + IndexedDB (dual write)
 */
export async function savePWATokens(refreshToken: string, expiresAt: string) {
  if (typeof window === "undefined") return
  localStorage.setItem(PWA_REFRESH_TOKEN_KEY, refreshToken)
  localStorage.setItem(PWA_REFRESH_TOKEN_EXPIRES_KEY, expiresAt)
  await idbSet(PWA_REFRESH_TOKEN_KEY, refreshToken)
  await idbSet(PWA_REFRESH_TOKEN_EXPIRES_KEY, expiresAt)
}

/**
 * Leer refresh token (localStorage primero, IndexedDB como fallback)
 */
async function readPWATokens(): Promise<{ refreshToken: string | null; expiresAt: string | null }> {
  if (typeof window === "undefined") return { refreshToken: null, expiresAt: null }

  let refreshToken = localStorage.getItem(PWA_REFRESH_TOKEN_KEY)
  let expiresAt = localStorage.getItem(PWA_REFRESH_TOKEN_EXPIRES_KEY)

  // Fallback a IndexedDB (iOS PWA puede borrar localStorage)
  if (!refreshToken) {
    refreshToken = await idbGet(PWA_REFRESH_TOKEN_KEY)
    expiresAt = await idbGet(PWA_REFRESH_TOKEN_EXPIRES_KEY)

    // Re-sync a localStorage si encontramos en IDB
    if (refreshToken) {
      localStorage.setItem(PWA_REFRESH_TOKEN_KEY, refreshToken)
      if (expiresAt) localStorage.setItem(PWA_REFRESH_TOKEN_EXPIRES_KEY, expiresAt)
    }
  }

  return { refreshToken, expiresAt }
}

/**
 * Limpiar tokens de ambos storages
 */
async function clearPWATokens() {
  if (typeof window === "undefined") return
  localStorage.removeItem(PWA_REFRESH_TOKEN_KEY)
  localStorage.removeItem(PWA_REFRESH_TOKEN_EXPIRES_KEY)
  await idbDelete(PWA_REFRESH_TOKEN_KEY)
  await idbDelete(PWA_REFRESH_TOKEN_EXPIRES_KEY)
}

export function SessionRefresher({ children }: { children: React.ReactNode }) {
  const { data: session, status, update } = useSession()
  const pathname = usePathname()
  const router = useRouter()
  const lastActivityRef = useRef(Date.now())
  const [isRestoring, setIsRestoring] = useState(false)
  const isRestoringRef = useRef(false)

  // Verificar si es ruta pública
  const isPublicPath = PUBLIC_PATHS.some(
    (path) => pathname === path || pathname?.startsWith("/api/")
  )

  // Actualizar timestamp de última actividad
  const updateActivity = useCallback(() => {
    lastActivityRef.current = Date.now()
  }, [])

  // Intentar restaurar sesión usando refresh token (para PWA)
  const tryRestoreSession = useCallback(async () => {
    if (typeof window === "undefined") return false
    if (isRestoringRef.current) return false
    isRestoringRef.current = true
    setIsRestoring(true)

    try {
      const { refreshToken, expiresAt } = await readPWATokens()

      if (!refreshToken) {
        return false
      }

      // Verificar si el token no ha expirado
      if (expiresAt) {
        const expires = new Date(expiresAt)
        if (expires < new Date()) {
          console.log("[SessionRefresher] PWA refresh token expired, clearing")
          await clearPWATokens()
          return false
        }
      }

      console.log("[SessionRefresher] Attempting to restore session from PWA token")

      // Usar signIn con el refresh token
      const result = await signIn("credentials", {
        pwaRefreshToken: refreshToken,
        redirect: false,
      })

      if (result?.ok && !result?.error) {
        console.log("[SessionRefresher] Session restored successfully")

        // Obtener el nuevo refresh token (se rotó en authorize) y guardarlo
        try {
          const tokenRes = await fetch("/api/auth/get-refresh-token")
          if (tokenRes.ok) {
            const { refreshToken: newToken, expiresAt: newExpires } = await tokenRes.json()
            await savePWATokens(newToken, newExpires)
          }
        } catch (e) {
          console.error("[SessionRefresher] Error updating stored refresh token:", e)
        }

        // Recargar la página para aplicar la sesión completamente
        window.location.reload()
        return true
      } else {
        console.log("[SessionRefresher] Failed to restore session, clearing tokens")
        await clearPWATokens()
        return false
      }
    } catch (error) {
      console.error("[SessionRefresher] Error restoring session:", error)
      await clearPWATokens()
      return false
    } finally {
      isRestoringRef.current = false
      setIsRestoring(false)
    }
  }, [])

  // Manejar error de sesión expirada
  const handleSessionError = useCallback(async () => {
    console.log("[SessionRefresher] Session expired, clearing PWA tokens")
    await clearPWATokens()
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

  // Intentar restaurar sesión si no hay sesión activa (para PWA)
  useEffect(() => {
    if (
      status === "unauthenticated" &&
      !isPublicPath &&
      !isRestoringRef.current
    ) {
      tryRestoreSession()
    }
  }, [status, isPublicPath, tryRestoreSession])

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
        } else if (status === "unauthenticated" && !isPublicPath && !isRestoringRef.current) {
          tryRestoreSession()
        }
      }
    }

    const handleFocus = () => {
      if (status === "authenticated") {
        checkSession()
      } else if (status === "unauthenticated" && !isPublicPath && !isRestoringRef.current) {
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
