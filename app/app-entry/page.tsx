"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { STAppLogo } from "@/components/shared/stapp-logo"
import { ThemeToggle } from "@/components/ui/theme-toggle"
import {
  ArrowRight,
  Building2,
  Trash2,
  Loader2,
  UserPlus,
  ArrowLeft,
  Eye,
  EyeOff,
  Globe,
  AlertCircle,
  CheckCircle2,
  CheckCircle,
  LogIn,
  Mail,
} from "lucide-react"

const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "stapp.com.ar"
const PROTOCOL = "https"
const STORAGE_KEY = "stapp-tenant-slug"
const RECENT_KEY = "stapp-recent-tenants"

type View = "select" | "register" | "register-success"

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

interface RegFormData {
  orgNombre: string
  orgSlug: string
  nombre: string
  email: string
  password: string
}

export default function AppEntryPage() {
  const [view, setView] = useState<View>("select")
  const [slug, setSlug] = useState("")
  const [recentTenants, setRecentTenants] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [navigating, setNavigating] = useState(false)
  const [error, setError] = useState("")

  // Registration state
  const [regLoading, setRegLoading] = useState(false)
  const [regError, setRegError] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [formData, setFormData] = useState<RegFormData>({
    orgNombre: "",
    orgSlug: "",
    nombre: "",
    email: "",
    password: "",
  })
  const [slugStatus, setSlugStatus] = useState<
    "idle" | "checking" | "available" | "taken" | "invalid"
  >("idle")
  const [slugError, setSlugError] = useState("")
  const [registeredSlug, setRegisteredSlug] = useState("")

  useEffect(() => {
    const savedSlug = localStorage.getItem(STORAGE_KEY)
    const recent = JSON.parse(
      localStorage.getItem(RECENT_KEY) || "[]"
    ) as string[]
    setRecentTenants(recent)

    if (savedSlug) {
      navigateToTenant(savedSlug)
    } else {
      setLoading(false)
    }
  }, [])

  const navigateToTenant = (tenantSlug: string) => {
    setNavigating(true)
    setError("")

    localStorage.setItem(STORAGE_KEY, tenantSlug)

    const recent = JSON.parse(
      localStorage.getItem(RECENT_KEY) || "[]"
    ) as string[]
    const updated = [tenantSlug, ...recent.filter((s) => s !== tenantSlug)].slice(
      0,
      5
    )
    localStorage.setItem(RECENT_KEY, JSON.stringify(updated))

    window.location.href = `${PROTOCOL}://${tenantSlug}.${ROOT_DOMAIN}/login`
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = slug.trim().toLowerCase()

    if (!trimmed) {
      setError("Ingresa el identificador de tu empresa")
      return
    }

    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(trimmed)) {
      setError("Solo letras, numeros y guiones (sin espacios)")
      return
    }

    navigateToTenant(trimmed)
  }

  const removeTenant = (tenantSlug: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const updated = recentTenants.filter((s) => s !== tenantSlug)
    setRecentTenants(updated)
    localStorage.setItem(RECENT_KEY, JSON.stringify(updated))

    if (localStorage.getItem(STORAGE_KEY) === tenantSlug) {
      localStorage.removeItem(STORAGE_KEY)
    }
  }

  // --- Registration handlers ---
  const updateForm = (field: keyof RegFormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
    setRegError("")
  }

  const generateSlugFromName = useCallback((nombre: string) => {
    const s = sanitizeSlug(nombre)
    setFormData((prev) => ({ ...prev, orgSlug: s }))
  }, [])

  const checkSlugAvailability = useCallback(async (s: string) => {
    if (!s || s.length < 3) {
      setSlugStatus("idle")
      return
    }
    setSlugStatus("checking")
    setSlugError("")
    try {
      const res = await fetch("/api/public/tenant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: s }),
      })
      const data = await res.json()
      if (data.available) {
        setSlugStatus("available")
      } else {
        setSlugStatus(
          data.error?.includes("reservado") ? "invalid" : "taken"
        )
        setSlugError(data.error || "No disponible")
      }
    } catch {
      setSlugStatus("idle")
    }
  }, [])

  useEffect(() => {
    const s = formData.orgSlug
    if (!s || s.length < 3) {
      setSlugStatus("idle")
      return
    }
    const timer = setTimeout(() => checkSlugAvailability(s), 500)
    return () => clearTimeout(timer)
  }, [formData.orgSlug, checkSlugAvailability])

  const handleNombreChange = (nombre: string) => {
    const prev = sanitizeSlug(formData.orgNombre)
    updateForm("orgNombre", nombre)
    if (!formData.orgSlug || formData.orgSlug === prev) {
      generateSlugFromName(nombre)
    }
  }

  const handleSlugChange = (value: string) => {
    const sanitized = value
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-/, "")
      .substring(0, 50)
    setFormData((prev) => ({ ...prev, orgSlug: sanitized }))
    setRegError("")
  }

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.orgNombre.trim() || formData.orgNombre.length < 2) {
      setRegError("Nombre del negocio requerido (min. 2 caracteres)")
      return
    }
    if (!formData.orgSlug.trim() || formData.orgSlug.length < 3) {
      setRegError("Subdominio requerido (min. 3 caracteres)")
      return
    }
    if (slugStatus === "taken" || slugStatus === "invalid") {
      setRegError(slugError || "Subdominio no disponible")
      return
    }
    if (slugStatus === "checking") {
      setRegError("Verificando subdominio...")
      return
    }
    if (!formData.nombre.trim()) {
      setRegError("Tu nombre es requerido")
      return
    }
    if (
      !formData.email.trim() ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)
    ) {
      setRegError("Email valido requerido")
      return
    }
    if (!formData.password || formData.password.length < 6) {
      setRegError("Contrasena minimo 6 caracteres")
      return
    }

    setRegLoading(true)
    setRegError("")
    const cleanSlug = formData.orgSlug.replace(/-$/, "")

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizacion: { nombre: formData.orgNombre, slug: cleanSlug },
          usuario: {
            nombre: formData.nombre,
            email: formData.email,
            password: formData.password,
          },
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setRegError(data.error || "Error al registrar")
        setRegLoading(false)
        return
      }

      setRegisteredSlug(cleanSlug)
      setView("register-success")
    } catch {
      setRegError("Error de conexion. Intenta de nuevo.")
    } finally {
      setRegLoading(false)
    }
  }

  const goToRegisteredLogin = () => {
    navigateToTenant(registeredSlug)
  }

  const resetToSelect = () => {
    setView("select")
    setRegError("")
    setFormData({
      orgNombre: "",
      orgSlug: "",
      nombre: "",
      email: "",
      password: "",
    })
    setSlugStatus("idle")
  }

  // --- Loading / Navigating screen ---
  if (loading || navigating) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-muted/30 dark:bg-background">
        <div className="text-center space-y-6">
          <STAppLogo size="xl" showText={false} className="justify-center" />
          <div className="space-y-2">
            <h1 className="text-2xl font-bold">
              <span className="text-primary">ST</span>
              <span className="text-foreground">App</span>
            </h1>
            <p className="text-sm text-muted-foreground">
              Gestion de Servicio Tecnico
            </p>
          </div>
          <Loader2 className="h-6 w-6 animate-spin mx-auto text-primary" />
          <p className="text-xs text-muted-foreground">
            {navigating ? "Conectando con tu empresa..." : "Cargando..."}
          </p>
        </div>
      </div>
    )
  }

  // --- Registration success screen ---
  if (view === "register-success") {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-muted/30 dark:bg-background p-4">
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-success/10 dark:bg-success/20 flex items-center justify-center mx-auto">
              <CheckCircle className="h-8 w-8 text-success" />
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-bold">
                Cuenta creada exitosamente
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Enviamos un email de verificacion a{" "}
                <span className="font-medium text-foreground">
                  {formData.email}
                </span>
              </p>
            </div>
          </div>

          <Card>
            <CardContent className="p-4 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Mail className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium">
                    Paso 1: Verifica tu email
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Revisa tu bandeja de entrada y haz clic en el enlace
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <LogIn className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium">
                    Paso 2: Inicia sesion
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Usa tus credenciales para acceder a{" "}
                    <span className="font-medium text-primary">
                      {registeredSlug}.{ROOT_DOMAIN}
                    </span>
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-3">
            <Button
              onClick={goToRegisteredLogin}
              className="w-full h-12"
            >
              Ir a iniciar sesion
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
            <button
              onClick={resetToSelect}
              className="w-full text-sm text-muted-foreground hover:text-primary transition-colors"
            >
              Volver al inicio
            </button>
          </div>
        </div>
      </div>
    )
  }

  // --- Registration form ---
  if (view === "register") {
    return (
      <div className="min-h-dvh bg-muted/30 dark:bg-background flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <button
            onClick={resetToSelect}
            className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
            <span className="text-sm">Volver</span>
          </button>
          <ThemeToggle variant="icon" />
        </div>

        <div className="flex-1 overflow-auto px-4 pb-8">
          <div className="w-full max-w-md mx-auto space-y-6">
            {/* Logo + Title */}
            <div className="text-center space-y-2 py-2">
              <STAppLogo size="lg" showText={false} className="justify-center" />
              <h2 className="text-2xl font-bold">Registra tu negocio</h2>
              <p className="text-sm text-muted-foreground">
                Crea tu cuenta en menos de 1 minuto
              </p>
            </div>

            {/* Form */}
            <form onSubmit={handleRegister} className="space-y-4">
              {regError && (
                <div className="bg-destructive/10 border border-destructive/30 text-destructive px-4 py-3 rounded-md text-sm">
                  {regError}
                </div>
              )}

              {/* Organization section */}
              <Card>
                <CardHeader className="pb-3">
                  <CardDescription className="text-xs font-medium uppercase tracking-wider">
                    Datos del negocio
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
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
                    <Label htmlFor="orgSlug">
                      <div className="flex items-center gap-2">
                        <Globe className="h-3.5 w-3.5" />
                        <span>URL de tu negocio</span>
                      </div>
                    </Label>
                    <div className="relative">
                      <Input
                        id="orgSlug"
                        value={formData.orgSlug}
                        onChange={(e) => handleSlugChange(e.target.value)}
                        placeholder="mi-negocio"
                        className={`pr-10 ${
                          slugStatus === "available"
                            ? "border-green-500 focus-visible:ring-green-500"
                            : slugStatus === "taken" || slugStatus === "invalid"
                            ? "border-red-500 focus-visible:ring-red-500"
                            : ""
                        }`}
                      />
                      <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        {slugStatus === "checking" && (
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        )}
                        {slugStatus === "available" && (
                          <CheckCircle2 className="h-4 w-4 text-green-500" />
                        )}
                        {(slugStatus === "taken" ||
                          slugStatus === "invalid") && (
                          <AlertCircle className="h-4 w-4 text-red-500" />
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium text-primary">
                        {formData.orgSlug || "tu-negocio"}.{ROOT_DOMAIN}
                      </span>
                    </p>
                    {(slugStatus === "taken" || slugStatus === "invalid") && slugError && (
                      <p className="text-xs text-destructive">{slugError}</p>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* User section */}
              <Card>
                <CardHeader className="pb-3">
                  <CardDescription className="text-xs font-medium uppercase tracking-wider">
                    Tu cuenta
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="nombre">Tu nombre</Label>
                    <Input
                      id="nombre"
                      value={formData.nombre}
                      onChange={(e) => updateForm("nombre", e.target.value)}
                      placeholder="Juan Perez"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="regEmail">Email</Label>
                    <Input
                      id="regEmail"
                      type="email"
                      value={formData.email}
                      onChange={(e) => updateForm("email", e.target.value)}
                      placeholder="tu@email.com"
                      autoComplete="email"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="regPassword">Contrasena</Label>
                    <div className="relative">
                      <Input
                        id="regPassword"
                        type={showPassword ? "text" : "password"}
                        value={formData.password}
                        onChange={(e) =>
                          updateForm("password", e.target.value)
                        }
                        placeholder="Minimo 6 caracteres"
                        className="pr-10"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                        onClick={() => setShowPassword(!showPassword)}
                        aria-label={showPassword ? "Ocultar contrasena" : "Mostrar contrasena"}
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <Eye className="h-4 w-4 text-muted-foreground" />
                        )}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Button
                type="submit"
                className="w-full h-12"
                disabled={regLoading}
              >
                {regLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creando cuenta...
                  </>
                ) : (
                  "Crear cuenta gratis"
                )}
              </Button>

              <p className="text-xs text-center text-muted-foreground">
                Al crear tu cuenta aceptas nuestros terminos de servicio
              </p>
            </form>
          </div>
        </div>
      </div>
    )
  }

  // --- Main: Organization selection ---
  return (
    <div className="min-h-dvh bg-muted/30 dark:bg-background flex flex-col">
      {/* Theme toggle */}
      <div className="absolute top-4 right-4">
        <ThemeToggle variant="icon" />
      </div>

      <div className="flex-1 flex flex-col px-4 pb-8">
        {/* Logo + branding */}
        <div className="text-center pt-12 pb-8 space-y-4">
          <STAppLogo size="xl" showText={false} className="justify-center" />
          <div className="space-y-1">
            <h1 className="text-2xl font-bold">
              <span className="text-primary">ST</span>
              <span className="text-foreground">App</span>
            </h1>
            <p className="text-sm text-muted-foreground">
              Gestion de Servicio Tecnico
            </p>
          </div>
        </div>

        <div className="w-full max-w-sm mx-auto flex-1 flex flex-col space-y-5">
          {/* Organization input */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Acceder a tu empresa</CardTitle>
              <CardDescription>
                Ingresa el identificador de tu empresa
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-3">
                <div className="flex items-center gap-0">
                  <Input
                    value={slug}
                    onChange={(e) => {
                      setSlug(
                        e.target.value.toLowerCase().replace(/\s/g, "-")
                      )
                      setError("")
                    }}
                    placeholder="mi-empresa"
                    className="rounded-r-none"
                    autoCapitalize="none"
                    autoCorrect="off"
                  />
                  <div className="h-10 px-3 flex items-center bg-muted border border-l-0 rounded-r-md text-xs text-muted-foreground whitespace-nowrap">
                    .{ROOT_DOMAIN}
                  </div>
                </div>
                {error && (
                  <p className="text-sm text-destructive">{error}</p>
                )}
                <Button type="submit" className="w-full h-11">
                  Acceder
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Recent tenants */}
          {recentTenants.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardDescription className="text-xs font-medium uppercase tracking-wider">
                  Empresas recientes
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-1">
                {recentTenants.map((tenant) => (
                  <div
                    key={tenant}
                    className="flex items-center justify-between group"
                  >
                    <button
                      onClick={() => navigateToTenant(tenant)}
                      className="flex items-center gap-3 py-2.5 px-3 rounded-lg hover:bg-accent flex-1 text-left transition-colors"
                    >
                      <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <Building2 className="h-4 w-4 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">
                          {tenant}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {tenant}.{ROOT_DOMAIN}
                        </div>
                      </div>
                    </button>
                    <button
                      className="p-2 rounded-lg text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 transition-colors"
                      onClick={(e) => removeTenant(tenant, e)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Spacer to push register to bottom */}
          <div className="flex-1" />

          {/* Register CTA */}
          <div className="text-center space-y-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-border" />
              <span className="text-muted-foreground text-xs">
                No tienes cuenta?
              </span>
              <div className="flex-1 h-px bg-border" />
            </div>
            <Button
              variant="outline"
              className="w-full h-11"
              onClick={() => setView("register")}
            >
              <UserPlus className="mr-2 h-4 w-4" />
              Registrar mi negocio
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
