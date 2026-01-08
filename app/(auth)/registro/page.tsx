"use client"

import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ThemeToggle } from "@/components/ui/theme-toggle"
import {
  Eye,
  EyeOff,
  Loader2,
  Globe,
  AlertCircle,
  CheckCircle2,
} from "lucide-react"
import { BusinessLogo } from "@/components/shared/business-logo"

interface FormData {
  orgNombre: string
  orgSlug: string
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

export default function RegistroPage() {
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [formData, setFormData] = useState<FormData>({
    orgNombre: "",
    orgSlug: "",
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
    const sanitized = sanitizeSlug(value)
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
    if (formData.password.length < 6) {
      setError("La contraseña debe tener al menos 6 caracteres")
      return false
    }
    return true
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!validateForm()) return

    setLoading(true)
    setError("")

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizacion: {
            nombre: formData.orgNombre,
            slug: formData.orgSlug,
          },
          usuario: {
            nombre: formData.nombre,
            email: formData.email,
            password: formData.password,
          },
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || "Error al registrar")
        setLoading(false)
        return
      }

      // Éxito - redirigir al login del subdominio con mensaje de verificación
      const targetUrl = `https://${formData.orgSlug}.${rootDomain}/login?registered=true&verify=true`
      window.location.href = targetUrl
    } catch (err) {
      console.error("Error:", err)
      setError("Error de conexión. Intenta de nuevo.")
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 dark:bg-background px-4 py-8">
      {/* Theme toggle in corner */}
      <div className="absolute top-4 right-4">
        <ThemeToggle variant="icon" />
      </div>

      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1 pb-4">
          <div className="flex justify-center py-4">
            <BusinessLogo size="xl" showText={false} />
          </div>
          <CardTitle className="text-2xl text-center">
            Crear cuenta
          </CardTitle>
          <CardDescription className="text-center">
            Registra tu negocio en menos de 1 minuto
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="bg-destructive/10 border border-destructive/30 text-destructive px-4 py-3 rounded text-sm">
                {error}
              </div>
            )}

            {/* Nombre del negocio */}
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

            {/* Subdominio */}
            <div className="space-y-2">
              <Label htmlFor="orgSlug">
                <div className="flex items-center gap-2">
                  <Globe className="h-4 w-4" />
                  <span>Tu URL</span>
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
                  {(slugStatus === "taken" || slugStatus === "invalid") && (
                    <AlertCircle className="h-4 w-4 text-red-500" />
                  )}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-primary">
                  {formData.orgSlug || "tu-negocio"}.{rootDomain}
                </span>
              </p>
            </div>

            <hr className="my-4" />

            {/* Nombre del usuario */}
            <div className="space-y-2">
              <Label htmlFor="nombre">Tu nombre</Label>
              <Input
                id="nombre"
                value={formData.nombre}
                onChange={(e) => updateForm("nombre", e.target.value)}
                placeholder="Juan Pérez"
              />
            </div>

            {/* Email */}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => updateForm("email", e.target.value)}
                placeholder="tu@email.com"
                autoComplete="email"
              />
            </div>

            {/* Contraseña */}
            <div className="space-y-2">
              <Label htmlFor="password">Contraseña</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={formData.password}
                  onChange={(e) => updateForm("password", e.target.value)}
                  placeholder="Mínimo 6 caracteres"
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

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creando cuenta...
                </>
              ) : (
                "Crear cuenta gratis"
              )}
            </Button>
          </form>

          <p className="mt-4 text-xs text-center text-muted-foreground">
            Al crear tu cuenta aceptas nuestros términos de servicio
          </p>

          <div className="mt-6 text-center text-sm text-muted-foreground">
            ¿Ya tienes cuenta?{" "}
            <Link href="/login" className="text-primary hover:underline font-medium">
              Inicia sesión
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
