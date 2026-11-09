"use client"

import { useCallback, useState, useSyncExternalStore, Suspense } from "react"
import { signIn } from "next-auth/react"
import { useSearchParams } from "next/navigation"
import { GoogleLogin, GoogleOAuthProvider } from "@react-oauth/google"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { ArrowLeft, Loader2, Store } from "lucide-react"
import { BusinessLogo } from "@/components/shared/business-logo"
import { AuthSplitLayout } from "@/components/auth/auth-split-layout"
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

// El tema lo maneja ThemeToggle poniendo/quitando la clase `dark` en <html>
// (no hay contexto compartido), así que se observa esa clase directamente.
function subscribeDarkClass(onChange: () => void) {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
  return () => observer.disconnect()
}

function useIsDark() {
  return useSyncExternalStore(
    subscribeDarkClass,
    () => document.documentElement.classList.contains("dark"),
    () => false,
  )
}

/**
 * El botón de Google es un iframe de ancho fijo (entre 200 y 400 px): no se
 * adapta solo. Se mide el contenedor y se le pasa ese ancho; si no, en móvil
 * desborda la página a lo ancho.
 */
function useGoogleButtonWidth() {
  const [width, setWidth] = useState(0)
  const ref = useCallback((el: HTMLDivElement | null) => {
    if (!el) return
    const measure = () => {
      const w = Math.round(Math.min(400, Math.max(200, el.clientWidth)))
      setWidth((prev) => (prev === w ? prev : w))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return { ref, width }
}

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
  // Qué se está haciendo mientras `loading`: se muestra bajo el spinner
  const [loadingMsg, setLoadingMsg] = useState("")
  const [error, setError] = useState("")
  // El email de Google no tiene cuenta: se ofrece ir a registrarse
  const [noAccount, setNoAccount] = useState(false)
  const isDark = useIsDark()
  const { ref: googleButtonRef, width: googleButtonWidth } = useGoogleButtonWidth()
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
      <AuthSplitLayout>
        <p className="text-center text-destructive">Google Login no está configurado.</p>
      </AuthSplitLayout>
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
        setNoAccount(true)
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
    setLoadingMsg("Entrando a tu negocio…")

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
    setLoadingMsg("Verificando el código…")
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
    setNoAccount(false)
    setLoadingMsg(action === "register" ? "Creando tu cuenta…" : "Verificando tu cuenta…")

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

  const isRegister = action === "register"
  const backPath = isRegister ? "registro" : "login"
  const backHref = tenant ? `https://${tenant}.${rootDomain}/${backPath}` : `/${backPath}`

  // Con 2FA pendiente se muestra solo el paso del código, como en /login
  if (pendingGoogleToken) {
    return (
      <AuthSplitLayout>
        <TwoFactorVerify
          onVerified={handleGoogle2FA}
          externalError={twoFAError}
          onCancel={() => {
            setPendingGoogleToken(null)
            setTwoFAError("")
          }}
        />
      </AuthSplitLayout>
    )
  }

  return (
    <AuthSplitLayout>
      <div className="space-y-8">
        <a
          href={backHref}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {isRegister ? "Volver al registro" : "Volver al login"}
        </a>

        <div className="space-y-6">
          <div className="flex justify-center lg:justify-start">
            <BusinessLogo size="xl" showText={false} />
          </div>
          <div className="space-y-1.5 text-center lg:text-left">
            <h1 className="text-2xl font-bold tracking-tight">
              {isRegister ? "Crear tu cuenta con Google" : "Continuar con Google"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {isRegister
                ? "Elegí la cuenta de Google con la que vas a administrar tu negocio"
                : "Elegí la cuenta de Google con la que te registraste"}
            </p>
          </div>
        </div>

        {isRegister && orgNombre && (
          <div className="flex items-center gap-3 rounded-xl border bg-muted/40 px-4 py-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Store className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="truncate font-medium">{orgNombre}</p>
              {orgSlug && (
                <p className="truncate text-sm text-muted-foreground">
                  {orgSlug}.{rootDomain}
                </p>
              )}
            </div>
          </div>
        )}

        {error && (
          <div role="alert" className="bg-destructive/10 border border-destructive/30 text-destructive px-4 py-3 rounded-lg text-sm space-y-3">
            <p>{error}</p>
            {noAccount && (
              <Button asChild size="sm" variant="outline" className="border-destructive/30 bg-background">
                <Link href="/registro">Registrar mi negocio</Link>
              </Button>
            )}
          </div>
        )}

        {loading ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-8" aria-live="polite">
            <Loader2 className="h-7 w-7 animate-spin text-primary" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">{loadingMsg}</p>
          </div>
        ) : (
          <GoogleOAuthProvider clientId={clientId}>
            <div ref={googleButtonRef} className="w-full min-h-10 flex justify-center">
              {/* key: la librería no redibuja el iframe al cambiar tema o ancho; se remonta */}
              {googleButtonWidth > 0 && <GoogleLogin
                key={`${isDark ? "dark" : "light"}-${googleButtonWidth}`}
                onSuccess={handleGoogleSuccess}
                onError={() => setError("Error al conectar con Google. Intentá de nuevo.")}
                size="large"
                width={googleButtonWidth}
                theme={isDark ? "filled_black" : "outline"}
                text={isRegister ? "signup_with" : "continue_with"}
                shape="rectangular"
              />}
            </div>
          </GoogleOAuthProvider>
        )}
      </div>
    </AuthSplitLayout>
  )
}

export default function GoogleAuthPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-dvh flex items-center justify-center bg-background">
          <div className="animate-pulse text-muted-foreground">Cargando...</div>
        </div>
      }
    >
      <GoogleAuthContent />
    </Suspense>
  )
}
