"use client"

import { useState, useEffect, useCallback } from "react"
import { RubroPicker } from "@/components/registro/rubro-picker"
import { validarSeleccionRubro } from "@/lib/rubros/seleccion"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AuthSplitLayout } from "@/components/auth/auth-split-layout"
import { cn } from "@/lib/utils"
import {
  Eye,
  EyeOff,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Mail,
} from "lucide-react"
import { BusinessLogo } from "@/components/shared/business-logo"
import { trackAdsConversion, trackEvent } from "@/lib/gtag"
import { getStoredUtmParams } from "@/lib/utm"

interface FormData {
  orgNombre: string
  orgSlug: string
  rubro: string
  rubroDetalle: string
  nombre: string
  email: string
  password: string
}

// Sanitizar slug (solo letras minúsculas, números y guiones)
function sanitizeSlug(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 50)
}

function RegistroForm() {
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [formData, setFormData] = useState<FormData>({
    orgNombre: "",
    orgSlug: "",
    rubro: "",
    rubroDetalle: "",
    nombre: "",
    email: "",
    password: "",
  })

  // Estado para validación de slug
  const [slugStatus, setSlugStatus] = useState<"idle" | "checking" | "available" | "taken" | "invalid">("idle")
  const [slugError, setSlugError] = useState("")

  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "stapp.com.ar"

  const updateForm = (field: keyof FormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
    setError("")
  }

  // Generar slug automático desde el nombre
  const generateSlugFromName = useCallback((nombre: string) => {
    const slug = sanitizeSlug(nombre)
    setFormData((prev) => ({ ...prev, orgSlug: slug }))
    return slug
  }, [])

  // Verificar disponibilidad del slug
  const checkSlugAvailability = useCallback(async (slug: string) => {
    if (!slug || slug.length < 3) {
      setSlugStatus("idle")
      return
    }

    setSlugStatus("checking")
    setSlugError("")

    try {
      const res = await fetch("/api/public/tenant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
      })

      const data = await res.json()

      if (data.available) {
        setSlugStatus("available")
      } else {
        setSlugStatus(data.error?.includes("reservado") ? "invalid" : "taken")
        setSlugError(data.error || "Este subdominio no está disponible")
      }
    } catch {
      setSlugStatus("idle")
    }
  }, [])

  // Debounce para verificar slug
  useEffect(() => {
    const slug = formData.orgSlug
    if (!slug || slug.length < 3) {
      setSlugStatus("idle")
      return
    }

    const timer = setTimeout(() => {
      checkSlugAvailability(slug)
    }, 500)

    return () => clearTimeout(timer)
  }, [formData.orgSlug, checkSlugAvailability])

  // Auto-generar slug cuando cambia el nombre
  const handleNombreChange = (nombre: string) => {
    const previousSlugFromName = sanitizeSlug(formData.orgNombre)
    updateForm("orgNombre", nombre)

    if (!formData.orgSlug || formData.orgSlug === previousSlugFromName) {
      generateSlugFromName(nombre)
    }
  }

  const handleSlugChange = (value: string) => {
    // Sanitizar pero permitir guión al final mientras escribe
    const sanitized = value
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-/, "") // Solo quitar guión al inicio, no al final
      .substring(0, 50)
    setFormData((prev) => ({ ...prev, orgSlug: sanitized }))
    setError("")
  }

  const validateForm = () => {
    if (!formData.orgNombre.trim()) {
      setError("El nombre del negocio es requerido")
      return false
    }
    if (formData.orgNombre.length < 2) {
      setError("El nombre debe tener al menos 2 caracteres")
      return false
    }
    if (!formData.orgSlug.trim()) {
      setError("El subdominio es requerido")
      return false
    }
    if (formData.orgSlug.length < 3) {
      setError("El subdominio debe tener al menos 3 caracteres")
      return false
    }
    if (slugStatus === "taken" || slugStatus === "invalid") {
      setError(slugError || "El subdominio no está disponible")
      return false
    }
    if (slugStatus === "checking") {
      setError("Espera mientras verificamos el subdominio")
      return false
    }
    const errorRubro = validarSeleccionRubro(formData.rubro, formData.rubroDetalle)
    if (errorRubro) {
      setError(errorRubro)
      return false
    }
    if (!formData.nombre.trim()) {
      setError("Tu nombre es requerido")
      return false
    }
    if (!formData.email.trim()) {
      setError("El email es requerido")
      return false
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(formData.email)) {
      setError("Ingresa un email válido")
      return false
    }
    if (!formData.password) {
      setError("La contraseña es requerida")
      return false
    }
    if (formData.password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres")
      return false
    }
    return true
  }

  // Redirigir a Google auth en dominio raíz
  const handleGoogleRedirect = () => {
    // Validar campos de org antes de redirigir
    if (!formData.orgNombre.trim() || formData.orgNombre.length < 2) {
      setError("Completá el nombre del negocio antes de registrarte con Google")
      return
    }
    if (!formData.orgSlug.trim() || formData.orgSlug.length < 3) {
      setError("Completá el subdominio antes de registrarte con Google")
      return
    }
    if (slugStatus === "taken" || slugStatus === "invalid") {
      setError(slugError || "El subdominio no está disponible")
      return
    }
    if (slugStatus === "checking") {
      setError("Esperá mientras verificamos el subdominio")
      return
    }
    // El alta con Google se va del formulario y vuelve por /google-auth, asi
    // que el rubro tiene que quedar resuelto antes de salir.
    const errorRubro = validarSeleccionRubro(formData.rubro, formData.rubroDetalle)
    if (errorRubro) {
      setError(errorRubro)
      return
    }

    const cleanSlug = formData.orgSlug.replace(/-$/, "")
    const params = new URLSearchParams({
      action: "register",
      orgNombre: formData.orgNombre,
      orgSlug: cleanSlug,
      rubro: formData.rubro,
      rubroDetalle: formData.rubroDetalle.trim(),
      userName: formData.nombre || "",
    })
    // Pasar UTMs al flujo de Google auth
    const utm = getStoredUtmParams()
    if (utm) {
      Object.entries(utm).forEach(([k, v]) => { if (v) params.set(k, v) })
    }
    window.location.href = `https://${rootDomain}/google-auth?${params.toString()}`
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!validateForm()) return

    setLoading(true)
    setError("")

    // Limpiar guión final del slug antes de enviar
    const cleanSlug = formData.orgSlug.replace(/-$/, "")

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizacion: {
            nombre: formData.orgNombre,
            slug: cleanSlug,
            rubro: formData.rubro,
            rubroDetalle: formData.rubroDetalle.trim() || undefined,
          },
          usuario: {
            nombre: formData.nombre,
            email: formData.email,
            password: formData.password,
          },
          utm: getStoredUtmParams(),
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || "Error al registrar")
        setLoading(false)
        return
      }

      // Tracking de conversión Google Ads + GA4
      // Esperamos confirmación de Google antes de redirigir
      await trackAdsConversion()
      trackEvent("sign_up", {
        method: "email",
        organization: formData.orgNombre,
      })

      // Éxito - redirigir a pantalla intermedia con instrucciones y reenvío.
      // Va en el dominio raíz (no en el subdomain), así evita problemas de
      // propagación DNS justo después de crear la org.
      const params = new URLSearchParams({
        email: formData.email,
        slug: cleanSlug,
      })
      // Si el mail de verificación no llegó a enviarse, avisamos a la pantalla
      // siguiente para que muestre el estado real (y no un falso "revisá tu inbox").
      if (data.emailSent === false) {
        params.set("emailError", "1")
      }
      window.location.href = `/registro/verificar?${params.toString()}`
    } catch (err) {
      console.error("Error:", err)
      setError("Error de conexión. Intentá de nuevo.")
      setLoading(false)
    }
  }

  const slugBad = slugStatus === "taken" || slugStatus === "invalid"

  return (
    <AuthSplitLayout width="md">
      <div className="space-y-8">
        <div className="space-y-6">
          <div className="flex justify-center lg:justify-start">
            <BusinessLogo size="xl" showText={false} />
          </div>
          <div className="space-y-1.5 text-center lg:text-left">
            <h1 className="text-2xl font-bold tracking-tight">Creá tu cuenta</h1>
            <p className="text-sm text-muted-foreground">
              Registrá tu negocio en menos de 1 minuto
            </p>
          </div>
        </div>

        {error && (
          <div role="alert" className="bg-destructive/10 border border-destructive/30 text-destructive px-4 py-3 rounded-lg text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-8">
          {/* Paso 1: el negocio */}
          <section className="space-y-4" aria-labelledby="paso-negocio">
            <StepTitle id="paso-negocio" n={1}>Tu negocio</StepTitle>

            <div className="space-y-2">
              <Label htmlFor="orgNombre">Nombre del negocio</Label>
              <Input
                id="orgNombre"
                value={formData.orgNombre}
                onChange={(e) => handleNombreChange(e.target.value)}
                placeholder="Ej: TechFix Reparaciones"
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="orgSlug">Tu URL</Label>
              <div
                className={cn(
                  "flex h-10 items-center rounded-md border border-input bg-background text-sm ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
                  slugStatus === "available" && "border-success focus-within:ring-success",
                  slugBad && "border-destructive focus-within:ring-destructive",
                )}
              >
                <input
                  id="orgSlug"
                  value={formData.orgSlug}
                  onChange={(e) => handleSlugChange(e.target.value)}
                  placeholder="mi-negocio"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  aria-describedby="orgSlug-estado"
                  aria-invalid={slugBad || undefined}
                  className="h-full min-w-0 flex-1 rounded-l-md bg-transparent px-3 placeholder:text-muted-foreground focus:outline-none"
                />
                <span className="shrink-0 border-l border-input px-3 text-muted-foreground">
                  .{rootDomain}
                </span>
              </div>
              <p id="orgSlug-estado" className="flex min-h-4 items-center gap-1.5 text-xs" aria-live="polite">
                {slugStatus === "checking" && (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden="true" />
                    <span className="text-muted-foreground">Verificando disponibilidad…</span>
                  </>
                )}
                {slugStatus === "available" && (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden="true" />
                    <span className="text-success">Disponible</span>
                  </>
                )}
                {slugBad && (
                  <>
                    <AlertCircle className="h-3.5 w-3.5 text-destructive" aria-hidden="true" />
                    <span className="text-destructive">{slugError || "Este subdominio no está disponible"}</span>
                  </>
                )}
                {slugStatus === "idle" && (
                  <span className="text-muted-foreground">Así entran vos y tu equipo al sistema</span>
                )}
              </p>
            </div>

            <div className="space-y-2">
              <Label>¿Qué reparás?</Label>
              <RubroPicker
                value={formData.rubro}
                onChange={(rubro) => updateForm("rubro", rubro)}
                detalle={formData.rubroDetalle}
                onDetalleChange={(detalle) => updateForm("rubroDetalle", detalle)}
                disabled={loading}
              />
              <p className="text-xs text-muted-foreground">
                Preparamos tus tipos de equipo, el checklist de recepción y el
                vocabulario del sistema. Podés cambiar todo después.
              </p>
            </div>
          </section>

          {/* Paso 2: la cuenta. Google va primero: ya tiene los datos del negocio */}
          <section className="space-y-4" aria-labelledby="paso-cuenta">
            <StepTitle id="paso-cuenta" n={2}>Tu cuenta</StepTitle>

            {process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full h-11"
                  onClick={handleGoogleRedirect}
                  disabled={loading}
                >
                  <GoogleIcon className="mr-2 h-4 w-4" />
                  Registrarse con Google
                </Button>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-muted/30 lg:bg-background dark:bg-background px-2 text-muted-foreground">
                      o con tu email
                    </span>
                  </div>
                </div>
              </>
            )}

            <div className="space-y-2">
              <Label htmlFor="nombre">Tu nombre</Label>
              <Input
                id="nombre"
                autoComplete="name"
                value={formData.nombre}
                onChange={(e) => updateForm("nombre", e.target.value)}
                placeholder="Juan Pérez"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                inputMode="email"
                value={formData.email}
                onChange={(e) => updateForm("email", e.target.value)}
                placeholder="tu@email.com"
                autoComplete="email"
              />
              <p className="text-xs text-muted-foreground flex items-start gap-1.5">
                <Mail className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" aria-hidden="true" />
                <span>Te enviamos un email para activar la cuenta. Si no llega, revisá spam.</span>
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Contraseña</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  value={formData.password}
                  onChange={(e) => updateForm("password", e.target.value)}
                  placeholder="Mínimo 8 caracteres"
                  className="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
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

            <Button type="submit" className="w-full h-11" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creando cuenta...
                </>
              ) : (
                "Crear cuenta gratis"
              )}
            </Button>
          </section>
        </form>

        <div className="space-y-3 text-center text-sm text-muted-foreground">
          <p className="text-xs">
            Al crear tu cuenta aceptás nuestros{" "}
            <Link href="/legal/terminos" target="_blank" className="text-primary hover:underline">
              términos de servicio
            </Link>
          </p>
          <p>
            ¿Ya tenés cuenta?{" "}
            <Link href="/login" className="text-primary hover:underline font-medium">
              Iniciá sesión
            </Link>
          </p>
          <p>
            <Link href="/" className="hover:text-primary hover:underline">
              Volver al inicio
            </Link>
          </p>
        </div>
      </div>
    </AuthSplitLayout>
  )
}

function StepTitle({ id, n, children }: { id: string; n: number; children: React.ReactNode }) {
  return (
    <h2 id={id} className="flex items-center gap-2.5 text-sm font-semibold">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">
        {n}
      </span>
      {children}
    </h2>
  )
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  )
}

export default function RegistroPage() {
  return <RegistroForm />
}
