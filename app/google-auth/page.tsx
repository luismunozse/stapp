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
import { extractAuthCode, parseRequires2FA } from "@/lib/auth-client"
import { TwoFactorVerify } from "@/components/auth/two-factor-verify"

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
  const rubro = searchParams.get("rubro") || ""
  const rubroDetalle = searchParams.get("rubroDetalle") || ""
  const orgSlug = searchParams.get("orgSlug") || ""
  const userName = searchParams.get("userName") || ""

  // UTM params pasados desde el registro
  const utmFromParams = {
    utm_source: searchParams.get("utm_source") || undefined,
    utm_medium: searchParams.get("utm_medium") || undefined,
    utm_campaign: searchParams.get("utm_campaign") || undefined,
    utm_content: searchParams.get("utm_content") || undefined,
    utm_term: searchParams.get("utm_term") || undefined,
  }
  const hasUtm = Object.values(utmFromParams).some(Boolean)
  const utm = hasUtm ? utmFromParams : null

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  // Login con Google + 2FA: guardamos el ID token de Google (vale ~1 h) para
  // reenviarlo junto con el código TOTP. Antes se redirigía a
  // /login?needs2fa=true, que nadie leía: el usuario quedaba en el login del
  // tenant sin forma de completar el segundo factor.
  const [pendingGoogleToken, setPendingGoogleToken] = useState<string | null>(null)
  const [twoFAError, setTwoFAError] = useState("")

  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "stapp.com.ar"
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID

  // Si no hay client ID, mostrar error
  if (!clientId) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-muted/30 dark:bg-background px-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <p className="text-center text-destructive">Google Login no está configurado.</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Login: autenticar con el ID token de Google via NextAuth. Si la cuenta
  // tiene 2FA, el primer intento devuelve REQUIRES_2FA y se reintenta con el
  // mismo token + el código TOTP.
  const loginWithGoogle = async (googleIdToken: string, totpCode?: string) => {
    const result = await signIn("credentials", {
      googleIdToken,
      rememberMe: "true",
      ...(totpCode ? { totpCode } : {}),
      redirect: false,
    })

    if (result?.error) {
      const code = extractAuthCode(result)
      if (totpCode && code.includes("INVALID_2FA_CODE")) {
        setTwoFAError("Código inválido. Verificá e intentá de nuevo.")
        setLoading(false)
        return
      }
      setPendingGoogleToken(null)
      if (code.includes("GOOGLE_NO_ACCOUNT")) {
        setError("No existe una cuenta con este email de Google. Registrate primero.")
      } else if (code.includes("SUPERADMIN_REQUIRES_2FA_SETUP")) {
        setError("Tu cuenta requiere tener 2FA configurado. Contactá al administrador del sistema.")
      } else if (code.includes("ORG_INACTIVE")) {
        setError("La cuenta de tu negocio está inactiva. Contactá a soporte.")
      } else if (parseRequires2FA(code)) {
        setTwoFAError("")
        setPendingGoogleToken(googleIdToken)
      } else {
        setError("Error al iniciar sesión con Google")
      }
      setLoading(false)
      return
    }

    setPendingGoogleToken(null)

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

  const handleGoogle2FA = async (totpCode: string) => {
    if (!pendingGoogleToken) return
    setLoading(true)
    setTwoFAError("")
    try {
      await loginWithGoogle(pendingGoogleToken, totpCode)
    } catch {
      setTwoFAError("Error de conexión. Intentá de nuevo.")
      setLoading(false)
    }
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
              ...(rubro ? { rubro } : {}),
              ...(rubroDetalle ? { rubroDetalle } : {}),
            },
            usuario: {
              nombre: userName,
              email: "",
            },
            googleIdToken: credentialResponse.credential,
            utm,
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
        await loginWithGoogle(credentialResponse.credential)
      }
    } catch {
      setError("Error de conexión. Intentá de nuevo.")
      setLoading(false)
    }
  }

  return (
    <div className="min-h-dvh flex items-center justify-center bg-muted/30 dark:bg-background px-4">
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

      {pendingGoogleToken && (
        <TwoFactorVerify
          onVerified={handleGoogle2FA}
          externalError={twoFAError}
          onCancel={() => {
            setPendingGoogleToken(null)
            setTwoFAError("")
          }}
        />
      )}
    </div>
  )
}

export default function GoogleAuthPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-dvh flex items-center justify-center bg-muted/30 dark:bg-background">
          <div className="animate-pulse text-muted-foreground">Cargando...</div>
        </div>
      }
    >
      <GoogleAuthContent />
    </Suspense>
  )
}
