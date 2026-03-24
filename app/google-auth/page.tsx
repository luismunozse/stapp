"use client"

import { useState, useEffect, Suspense } from "react"
import { signIn } from "next-auth/react"
import { useSearchParams } from "next/navigation"
import { GoogleLogin, GoogleOAuthProvider } from "@react-oauth/google"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ThemeToggle } from "@/components/ui/theme-toggle"
import { Loader2 } from "lucide-react"
import { BusinessLogo } from "@/components/shared/business-logo"

/**
 * Página de autenticación con Google en el dominio raíz.
 * Los subdominios redirigen aquí porque Google no acepta wildcards en orígenes.
 *
 * Params:
 * - action: "login" | "register"
 * - tenant: slug del tenant (para redirect post-auth)
 * - orgNombre, orgSlug: datos de org (solo para registro)
 * - userName: nombre del usuario (solo para registro)
 */

function GoogleAuthContent() {
  const searchParams = useSearchParams()
  const action = searchParams.get("action") || "login"
  const tenant = searchParams.get("tenant") || ""
  const orgNombre = searchParams.get("orgNombre") || ""
  const orgSlug = searchParams.get("orgSlug") || ""
  const userName = searchParams.get("userName") || ""

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "stapp.com.ar"
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID

  // Si no hay client ID, mostrar error
  if (!clientId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30 dark:bg-background px-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <p className="text-center text-destructive">Google Login no está configurado.</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const handleGoogleSuccess = async (credentialResponse: { credential?: string }) => {
    if (!credentialResponse.credential) {
      setError("Error al obtener credenciales de Google")
      return
    }

    setLoading(true)
    setError("")

    try {
      if (action === "register") {
        // Registro: llamar al API de registro con Google token
        const res = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            organizacion: {
              nombre: orgNombre,
              slug: orgSlug,
            },
            usuario: {
              nombre: userName,
              email: "",
            },
            googleIdToken: credentialResponse.credential,
          }),
        })

        const data = await res.json()

        if (!res.ok) {
          setError(data.error || "Error al registrar")
          setLoading(false)
          return
        }

        // Registro exitoso con Google → email ya verificado
        // Redirigir al login del subdominio
        window.location.href = `https://${orgSlug}.${rootDomain}/login?registered=true`
      } else {
        // Login: autenticar con Google token via NextAuth
        const result = await signIn("credentials", {
          googleIdToken: credentialResponse.credential,
          rememberMe: "true",
          redirect: false,
        })

        if (result?.error) {
          if (result.error.includes("GOOGLE_NO_ACCOUNT")) {
            setError("No existe una cuenta con este email de Google. Registrate primero.")
          } else if (result.error.includes("REQUIRES_2FA")) {
            // 2FA requerido - redirigir al login del tenant con indicación
            const targetUrl = tenant
              ? `https://${tenant}.${rootDomain}/login?needs2fa=true`
              : `/login?needs2fa=true`
            window.location.href = targetUrl
            return
          } else {
            setError("Error al iniciar sesión con Google")
          }
          setLoading(false)
          return
        }

        // Login exitoso - redirigir al tenant
        if (tenant) {
          window.location.href = `https://${tenant}.${rootDomain}/dashboard`
        } else {
          // Sin tenant específico, obtener la org del usuario
          const orgRes = await fetch("/api/auth/user-organization", {
            credentials: "include",
          })
          if (orgRes.ok) {
            const { organization } = await orgRes.json()
            window.location.href = `https://${organization.slug}.${rootDomain}/dashboard`
          } else {
            setError("No se pudo obtener la organización")
            setLoading(false)
          }
        }
      }
    } catch {
      setError("Error de conexión. Intentá de nuevo.")
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 dark:bg-background px-4">
      <div className="absolute top-4 right-4">
        <ThemeToggle variant="icon" />
      </div>

      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1 pb-4">
          <div className="flex justify-center py-4">
            <BusinessLogo size="xl" showText={false} />
          </div>
          <CardTitle className="text-xl text-center">
            {action === "register" ? "Registrarse con Google" : "Iniciar sesión con Google"}
          </CardTitle>
          <CardDescription className="text-center">
            {action === "register"
              ? `Registrando negocio: ${orgNombre}`
              : "Seleccioná tu cuenta de Google para continuar"}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {error && (
            <div className="bg-destructive/10 border border-destructive/30 text-destructive px-4 py-3 rounded text-sm">
              {error}
            </div>
          )}

          {loading ? (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">
                {action === "register" ? "Creando tu cuenta..." : "Iniciando sesión..."}
              </p>
            </div>
          ) : (
            <GoogleOAuthProvider clientId={clientId}>
              <div className="flex justify-center">
                <div className="w-full [&>div]:!w-full [&_iframe]:!w-full">
                  <GoogleLogin
                    onSuccess={handleGoogleSuccess}
                    onError={() => setError("Error al conectar con Google. Intentá de nuevo.")}
                    size="large"
                    width="400"
                    text={action === "register" ? "signup_with" : "continue_with"}
                    shape="rectangular"
                  />
                </div>
              </div>
            </GoogleOAuthProvider>
          )}

          <div className="text-center pt-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (tenant) {
                  window.location.href = `https://${tenant}.${rootDomain}/${action === "register" ? "registro" : "login"}`
                } else {
                  window.location.href = action === "register" ? "/registro" : "/login"
                }
              }}
            >
              Volver
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default function GoogleAuthPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-muted/30 dark:bg-background">
          <div className="animate-pulse text-muted-foreground">Cargando...</div>
        </div>
      }
    >
      <GoogleAuthContent />
    </Suspense>
  )
}
