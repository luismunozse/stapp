"use client"

import { useState, useEffect, Suspense } from "react"
import { signIn, signOut } from "next-auth/react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ThemeToggle } from "@/components/ui/theme-toggle"
import { Eye, EyeOff, CheckCircle } from "lucide-react"
import { BusinessLogo } from "@/components/shared/business-logo"
import { savePWATokens } from "@/components/auth/session-refresher"
import { isNativePlatform } from "@/lib/capacitor"

interface TenantInfo {
  nombre: string
  logoUrl: string | null
}

// Extraer subdominio del hostname
function extractSubdomain(): string | null {
  if (typeof window === "undefined") return null

  const host = window.location.hostname
  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "stapp.com.ar"
  const rootParts = rootDomain.split(".").length

  // Soporte para desarrollo local con .local
  if (host.endsWith(".local")) {
    const parts = host.split(".")
    if (parts.length >= 2 && parts[0] !== "stapp" && parts[0] !== "www") {
      return parts[0]
    }
    return null
  }

  const parts = host.split(".")
  if (parts.length <= rootParts) return null

  const subdomain = parts[0]
  if (subdomain === "www") return null

  return subdomain
}

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [rememberMe, setRememberMe] = useState(false)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)
  const [showResendOption, setShowResendOption] = useState(false)
  const [resendLoading, setResendLoading] = useState(false)
  const [resendSuccess, setResendSuccess] = useState(false)

  // Estado para tenant/subdominio
  const [tenantSlug, setTenantSlug] = useState<string | null>(null)
  const [tenantInfo, setTenantInfo] = useState<TenantInfo | null>(null)
  const [tenantLoading, setTenantLoading] = useState(true)
  const [tenantError, setTenantError] = useState(false)

  // Detectar subdominio y cargar info del tenant
  useEffect(() => {
    const slug = extractSubdomain()
    setTenantSlug(slug)

    if (slug) {
      fetch(`/api/public/tenant?slug=${slug}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.tenant) {
            setTenantInfo(data.tenant)
          } else {
            setTenantError(true)
          }
          setTenantLoading(false)
        })
        .catch(() => {
          setTenantError(true)
          setTenantLoading(false)
        })
    } else {
      setTenantLoading(false)
    }
  }, [])

  // Estado para mensaje de verificación pendiente
  const [showVerifyMessage, setShowVerifyMessage] = useState(false)

  // Mostrar mensaje de éxito si viene del registro o pre-llenar email
  useEffect(() => {
    if (searchParams.get("registered") === "true") {
      setShowSuccess(true)
      // Si viene con verify=true, mostrar mensaje de verificación
      if (searchParams.get("verify") === "true") {
        setShowVerifyMessage(true)
      }
    }
    // Pre-llenar email si viene de redirección del dominio principal
    const emailParam = searchParams.get("email")
    if (emailParam) {
      setEmail(emailParam)
    }
    // Limpiar URL
    if (searchParams.get("registered") || searchParams.get("email") || searchParams.get("verify")) {
      window.history.replaceState({}, "", "/login")
    }
  }, [searchParams])

  // Redirigir si el tenant no existe
  useEffect(() => {
    if (tenantError && !tenantLoading) {
      router.push("/tenant-not-found")
    }
  }, [tenantError, tenantLoading, router])

  const handleResendVerification = async () => {
    if (!email) {
      setError("Ingresa tu email primero")
      return
    }

    setResendLoading(true)
    setResendSuccess(false)

    try {
      const res = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })

      const data = await res.json()

      if (res.ok) {
        setResendSuccess(true)
        setError("")
      } else {
        setError(data.error || "Error al reenviar el email")
      }
    } catch {
      setError("Error de conexión. Intenta de nuevo.")
    } finally {
      setResendLoading(false)
    }
  }

  // Guardar refresh token en localStorage + IndexedDB para PWA
  const saveRefreshTokenForPWA = async () => {
    try {
      const res = await fetch("/api/auth/get-refresh-token")
      if (res.ok) {
        const { refreshToken, expiresAt } = await res.json()
        await savePWATokens(refreshToken, expiresAt)
      }
    } catch (error) {
      console.error("Error saving refresh token for PWA:", error)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setLoading(true)

    try {
      const result = await signIn("credentials", {
        email,
        password,
        rememberMe: rememberMe.toString(),
        redirect: false,
      })

      if (result?.error) {
        if (result.error.includes("EMAIL_NOT_VERIFIED")) {
          setError("Tu email no ha sido verificado. Revisa tu bandeja de entrada.")
          setShowResendOption(true)
        } else {
          setError("Credenciales incorrectas")
          setShowResendOption(false)
        }
        setLoading(false)
        return
      }

      // Si estamos en un subdominio, verificar que el usuario pertenece a este tenant
      if (tenantSlug) {
        const verifyRes = await fetch("/api/auth/verify-tenant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug: tenantSlug }),
        })

        if (!verifyRes.ok) {
          // El usuario no pertenece a esta organización
          await signOut({ redirect: false })
          setError("No tienes acceso a esta organización")
          setLoading(false)
          return
        }

        // Guardar refresh token para PWA antes de redirigir
        await saveRefreshTokenForPWA()

        // Ya estamos en el subdominio correcto - usar window.location para navegación completa
        window.location.href = "/dashboard"
        return
      } else {
        // Login desde dominio principal: cerrar sesión aquí y redirigir al subdominio para login
        const orgRes = await fetch("/api/auth/user-organization", {
          credentials: "include",
        })

        if (orgRes.ok) {
          const { organization } = await orgRes.json()
          // Cerrar sesión en dominio principal (la cookie es solo para este dominio)
          await signOut({ redirect: false })
          // Redirigir al login del subdominio con el email pre-llenado
          const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "stapp.com.ar"
          const targetUrl = `https://${organization.slug}.${rootDomain}/login?email=${encodeURIComponent(email)}`
          window.location.href = targetUrl
          return
        } else {
          setError("No se pudo obtener la organización")
          setLoading(false)
        }
      }
    } catch (error) {
      console.error("Login error:", error)
      setError("Error al iniciar sesión")
      setLoading(false)
    } finally {
      // Asegurar que loading se desactive si no hay redirección externa
      setTimeout(() => setLoading(false), 5000)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 dark:bg-background px-4">
      {/* Theme toggle in corner */}
      <div className="absolute top-4 right-4">
        <ThemeToggle variant="icon" />
      </div>

      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1 pb-2">
          <div className="flex justify-center py-4">
            {tenantInfo?.logoUrl ? (
              <Image
                src={tenantInfo.logoUrl}
                alt={tenantInfo.nombre}
                width={192}
                height={64}
                className="h-16 w-auto object-contain"
                unoptimized
              />
            ) : (
              <BusinessLogo size="xl" showText={false} />
            )}
          </div>
          {tenantInfo && (
            <CardTitle className="text-center text-xl">
              {tenantInfo.nombre}
            </CardTitle>
          )}
          <CardDescription className="text-center">
            Ingresa tus credenciales para acceder
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {showSuccess && (
              <div className={`${showVerifyMessage ? "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-400" : "bg-success-50 dark:bg-success-100 border-success/30 text-success-700 dark:text-success-600"} border px-4 py-3 rounded flex items-center gap-2`}>
                <CheckCircle className="h-5 w-5 flex-shrink-0" />
                <div>
                  <p className="font-medium">¡Cuenta creada exitosamente!</p>
                  <p className="text-sm opacity-90">
                    {showVerifyMessage
                      ? "Revisa tu email para verificar tu cuenta antes de iniciar sesión."
                      : "Ya puedes iniciar sesión con tus credenciales."}
                  </p>
                </div>
              </div>
            )}
            {resendSuccess && (
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-400 px-4 py-3 rounded">
                <p className="font-medium">Email enviado</p>
                <p className="text-sm opacity-90">Revisa tu bandeja de entrada para verificar tu cuenta.</p>
              </div>
            )}
            {error && (
              <div className="bg-destructive/10 border border-destructive/30 text-destructive px-4 py-3 rounded">
                <p>{error}</p>
                {showResendOption && (
                  <button
                    type="button"
                    onClick={handleResendVerification}
                    disabled={resendLoading}
                    className="mt-2 text-sm underline hover:no-underline disabled:opacity-50"
                  >
                    {resendLoading ? "Enviando..." : "Reenviar email de verificación"}
                  </button>
                )}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="tu@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Contraseña</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  className="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <Eye className="h-4 w-4 text-muted-foreground" />
                  )}
                </Button>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="h-4 w-4 rounded border-input text-primary focus:ring-primary"
                />
                <span className="text-sm text-muted-foreground">
                  Recordarme por 30 días
                </span>
              </label>
              <Link
                href="/forgot-password"
                className="text-sm text-primary hover:underline"
              >
                ¿Olvidaste tu contraseña?
              </Link>
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Iniciando sesión..." : "Iniciar Sesión"}
            </Button>
          </form>
          <div className="mt-6 text-center text-sm text-muted-foreground space-y-2">
            {/* Solo mostrar enlace de registro si no estamos en subdominio */}
            {!tenantSlug && (
              <div>
                ¿No tienes cuenta?{" "}
                <Link href="/registro" className="text-primary hover:underline font-medium">
                  Registra tu negocio
                </Link>
              </div>
            )}
            {isNativePlatform() ? (
              <div>
                <button
                  onClick={() => {
                    localStorage.removeItem("stapp-tenant-slug")
                    const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "stapp.com.ar"
                    window.location.href = `https://${rootDomain}/app-entry`
                  }}
                  className="text-muted-foreground hover:text-primary hover:underline"
                >
                  Cambiar de empresa
                </button>
              </div>
            ) : (
              <div>
                <Link href="/" className="text-muted-foreground hover:text-primary hover:underline">
                  Volver al inicio
                </Link>
              </div>
            )}
          </div>

        </CardContent>
      </Card>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-muted/30 dark:bg-background">
        <div className="animate-pulse text-muted-foreground">Cargando...</div>
      </div>
    }>
      <LoginForm />
    </Suspense>
  )
}
