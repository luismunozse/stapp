"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Eye,
  EyeOff,
  Building2,
  User,
  ArrowRight,
  ArrowLeft,
  Check,
  Loader2,
  Globe,
  AlertCircle,
  CheckCircle2,
} from "lucide-react"

type Step = 1 | 2 | 3

interface FormData {
  // Organización
  orgNombre: string
  orgSlug: string
  orgTelefono: string
  orgEmail: string
  orgDireccion: string
  // Usuario
  nombre: string
  email: string
  password: string
  confirmPassword: string
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
  const router = useRouter()
  const [step, setStep] = useState<Step>(1)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [formData, setFormData] = useState<FormData>({
    orgNombre: "",
    orgSlug: "",
    orgTelefono: "",
    orgEmail: "",
    orgDireccion: "",
    nombre: "",
    email: "",
    password: "",
    confirmPassword: "",
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

  // Auto-generar slug cuando cambia el nombre (solo si el slug está vacío o coincide con el anterior)
  const handleNombreChange = (nombre: string) => {
    const previousSlugFromName = sanitizeSlug(formData.orgNombre)
    updateForm("orgNombre", nombre)

    // Solo auto-generar si el slug actual está vacío o era el auto-generado
    if (!formData.orgSlug || formData.orgSlug === previousSlugFromName) {
      generateSlugFromName(nombre)
    }
  }

  const handleSlugChange = (value: string) => {
    const sanitized = sanitizeSlug(value)
    setFormData((prev) => ({ ...prev, orgSlug: sanitized }))
    setError("")
  }

  const validateStep1 = () => {
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
    return true
  }

  const validateStep2 = () => {
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
    if (formData.password !== formData.confirmPassword) {
      setError("Las contraseñas no coinciden")
      return false
    }
    return true
  }

  const nextStep = () => {
    if (step === 1 && validateStep1()) {
      setStep(2)
    } else if (step === 2 && validateStep2()) {
      setStep(3)
    }
  }

  const prevStep = () => {
    setError("")
    if (step === 2) setStep(1)
    if (step === 3) setStep(2)
  }

  const handleSubmit = async () => {
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
            telefono: formData.orgTelefono || undefined,
            email: formData.orgEmail || undefined,
            direccion: formData.orgDireccion || undefined,
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
        setStep(2) // Volver al paso de usuario si hay error
        setLoading(false)
        return
      }

      // Éxito - redirigir al login con mensaje
      router.push("/login?registered=true")
    } catch (err) {
      console.error("Error:", err)
      setError("Error de conexión. Intenta de nuevo.")
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 px-4 py-8">
      <Card className="w-full max-w-lg">
        <CardHeader className="space-y-1 pb-4">
          <div className="flex justify-center py-4">
            <Image
              src="/logo.png"
              alt="STApp"
              width={150}
              height={50}
              className="h-12 w-auto object-contain"
              priority
            />
          </div>
          <CardTitle className="text-2xl text-center">
            Crear cuenta
          </CardTitle>
          <CardDescription className="text-center">
            Registra tu negocio y comienza a gestionar tus reparaciones
          </CardDescription>

          {/* Progress Steps */}
          <div className="flex items-center justify-center gap-2 pt-4">
            {[1, 2, 3].map((s) => (
              <div key={s} className="flex items-center">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
                    step >= s
                      ? "bg-primary text-white"
                      : "bg-gray-200 text-gray-500"
                  }`}
                >
                  {step > s ? <Check className="h-4 w-4" /> : s}
                </div>
                {s < 3 && (
                  <div
                    className={`w-12 h-1 mx-1 transition-colors ${
                      step > s ? "bg-primary" : "bg-gray-200"
                    }`}
                  />
                )}
              </div>
            ))}
          </div>
          <div className="flex justify-between text-xs text-muted-foreground px-2">
            <span>Negocio</span>
            <span>Usuario</span>
            <span>Confirmar</span>
          </div>
        </CardHeader>

        <CardContent>
          {error && (
            <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
              {error}
            </div>
          )}

          {/* Step 1: Datos del negocio */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-4 text-primary">
                <Building2 className="h-5 w-5" />
                <span className="font-medium">Datos de tu negocio</span>
              </div>

              <div className="space-y-2">
                <Label htmlFor="orgNombre">Nombre del negocio *</Label>
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
                    <Globe className="h-4 w-4" />
                    <span>Subdominio *</span>
                  </div>
                </Label>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
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
                </div>
                <div className="text-sm">
                  <span className="text-muted-foreground">Tu URL será: </span>
                  <span className="font-medium text-primary">
                    {formData.orgSlug || "mi-negocio"}.{rootDomain}
                  </span>
                </div>
                {slugError && (
                  <p className="text-sm text-red-500">{slugError}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="orgTelefono">Teléfono (opcional)</Label>
                <Input
                  id="orgTelefono"
                  value={formData.orgTelefono}
                  onChange={(e) => updateForm("orgTelefono", e.target.value)}
                  placeholder="+54 9 11 1234-5678"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="orgEmail">Email del negocio (opcional)</Label>
                <Input
                  id="orgEmail"
                  type="email"
                  value={formData.orgEmail}
                  onChange={(e) => updateForm("orgEmail", e.target.value)}
                  placeholder="contacto@tunegocio.com"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="orgDireccion">Dirección (opcional)</Label>
                <Input
                  id="orgDireccion"
                  value={formData.orgDireccion}
                  onChange={(e) => updateForm("orgDireccion", e.target.value)}
                  placeholder="Av. Principal 123"
                />
              </div>

              <Button onClick={nextStep} className="w-full mt-6">
                Continuar
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          )}

          {/* Step 2: Datos del usuario */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-4 text-primary">
                <User className="h-5 w-5" />
                <span className="font-medium">Tu cuenta de administrador</span>
              </div>

              <div className="space-y-2">
                <Label htmlFor="nombre">Tu nombre *</Label>
                <Input
                  id="nombre"
                  value={formData.nombre}
                  onChange={(e) => updateForm("nombre", e.target.value)}
                  placeholder="Juan Pérez"
                  autoFocus
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email *</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => updateForm("email", e.target.value)}
                  placeholder="tu@email.com"
                  autoComplete="email"
                />
                <p className="text-xs text-muted-foreground">
                  Usarás este email para iniciar sesión
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Contraseña *</Label>
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
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4 text-gray-500" />
                    ) : (
                      <Eye className="h-4 w-4 text-gray-500" />
                    )}
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirmar contraseña *</Label>
                <div className="relative">
                  <Input
                    id="confirmPassword"
                    type={showConfirmPassword ? "text" : "password"}
                    value={formData.confirmPassword}
                    onChange={(e) => updateForm("confirmPassword", e.target.value)}
                    placeholder="Repite tu contraseña"
                    className="pr-10"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  >
                    {showConfirmPassword ? (
                      <EyeOff className="h-4 w-4 text-gray-500" />
                    ) : (
                      <Eye className="h-4 w-4 text-gray-500" />
                    )}
                  </Button>
                </div>
              </div>

              <div className="flex gap-2 mt-6">
                <Button variant="outline" onClick={prevStep} className="flex-1">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Atrás
                </Button>
                <Button onClick={nextStep} className="flex-1">
                  Continuar
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {/* Step 3: Confirmación */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-4 text-primary">
                <Check className="h-5 w-5" />
                <span className="font-medium">Confirma tus datos</span>
              </div>

              <div className="space-y-4 bg-muted/50 rounded-lg p-4">
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <Building2 className="h-4 w-4" />
                    Negocio
                  </h4>
                  <p className="font-medium">{formData.orgNombre}</p>
                  <p className="text-sm flex items-center gap-1.5">
                    <Globe className="h-3.5 w-3.5 text-primary" />
                    <span className="text-primary font-medium">
                      {formData.orgSlug}.{rootDomain}
                    </span>
                  </p>
                  {formData.orgTelefono && (
                    <p className="text-sm text-muted-foreground">{formData.orgTelefono}</p>
                  )}
                  {formData.orgEmail && (
                    <p className="text-sm text-muted-foreground">{formData.orgEmail}</p>
                  )}
                  {formData.orgDireccion && (
                    <p className="text-sm text-muted-foreground">{formData.orgDireccion}</p>
                  )}
                </div>

                <hr />

                <div>
                  <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <User className="h-4 w-4" />
                    Administrador
                  </h4>
                  <p className="font-medium">{formData.nombre}</p>
                  <p className="text-sm text-muted-foreground">{formData.email}</p>
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-200 text-blue-800 px-4 py-3 rounded text-sm">
                Al crear tu cuenta aceptas nuestros términos de servicio y política de privacidad.
              </div>

              <div className="flex gap-2 mt-6">
                <Button variant="outline" onClick={prevStep} className="flex-1" disabled={loading}>
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Atrás
                </Button>
                <Button onClick={handleSubmit} className="flex-1" disabled={loading}>
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Creando...
                    </>
                  ) : (
                    <>
                      Crear cuenta
                      <Check className="ml-2 h-4 w-4" />
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}

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
