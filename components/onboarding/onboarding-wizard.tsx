"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  Upload,
  Users,
  ClipboardList,
  CheckSquare,
  Rocket,
  Sparkles,
  Loader2,
  Database,
} from "lucide-react"
import { cn } from "@/lib/utils"

interface OnboardingProgress {
  step_logo: boolean
  step_first_client: boolean
  step_first_order: boolean
  step_checklist: boolean
  sample_data_loaded: boolean
}

const STEPS = [
  { key: "welcome", title: "Bienvenido", icon: Sparkles },
  { key: "logo", title: "Tu negocio", icon: Upload },
  { key: "client", title: "Primer cliente", icon: Users },
  { key: "order", title: "Primera orden", icon: ClipboardList },
  { key: "done", title: "¡Listo!", icon: Rocket },
]

export function OnboardingWizard() {
  const router = useRouter()
  const [currentStep, setCurrentStep] = useState(0)
  const [progress, setProgress] = useState<OnboardingProgress | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingSample, setLoadingSample] = useState(false)

  // Form states
  const [orgName, setOrgName] = useState("")
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)

  const [clienteNombre, setClienteNombre] = useState("")
  const [clienteTelefono, setClienteTelefono] = useState("")

  useEffect(() => {
    fetchProgress()
  }, [])

  const fetchProgress = async () => {
    const res = await fetch("/api/onboarding/progress")
    if (res.ok) {
      const data = await res.json()
      setProgress(data)
    }
  }

  const updateProgress = async (field: string, value: boolean) => {
    await fetch("/api/onboarding/progress", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    })
    setProgress((prev) => prev ? { ...prev, [field]: value } : null)
  }

  const handleLogoUpload = async () => {
    if (!logoFile) return
    setLoading(true)
    try {
      const formData = new FormData()
      formData.append("logo", logoFile)
      if (orgName) formData.append("nombreMostrar", orgName)

      const res = await fetch("/api/configuracion/logo", {
        method: "POST",
        body: formData,
      })

      if (res.ok) {
        await updateProgress("step_logo", true)
        setCurrentStep(2)
      }
    } catch (err) {
      console.error("Error uploading logo:", err)
    } finally {
      setLoading(false)
    }
  }

  const handleSaveOrgName = async () => {
    if (!orgName.trim()) {
      setCurrentStep(2)
      return
    }
    setLoading(true)
    try {
      await fetch("/api/configuracion", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombreMostrar: orgName }),
      })
      await updateProgress("step_logo", true)
      setCurrentStep(2)
    } catch (err) {
      console.error("Error saving org name:", err)
    } finally {
      setLoading(false)
    }
  }

  const handleCreateClient = async () => {
    if (!clienteNombre.trim() || !clienteTelefono.trim()) return
    setLoading(true)
    try {
      const res = await fetch("/api/clientes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: clienteNombre,
          telefono: clienteTelefono,
        }),
      })

      if (res.ok) {
        await updateProgress("step_first_client", true)
        setCurrentStep(3)
      }
    } catch (err) {
      console.error("Error creating client:", err)
    } finally {
      setLoading(false)
    }
  }

  const handleLoadSampleData = async () => {
    setLoadingSample(true)
    try {
      const res = await fetch("/api/onboarding/sample-data", { method: "POST" })
      if (res.ok) {
        await updateProgress("step_first_client", true)
        await updateProgress("step_first_order", true)
        setCurrentStep(4)
      }
    } catch (err) {
      console.error("Error loading sample data:", err)
    } finally {
      setLoadingSample(false)
    }
  }

  const handleComplete = async () => {
    setLoading(true)
    try {
      await fetch("/api/onboarding/complete", { method: "POST" })
      router.push("/dashboard")
      router.refresh()
    } catch (err) {
      console.error("Error completing onboarding:", err)
    } finally {
      setLoading(false)
    }
  }

  const handleSkipToDashboard = async () => {
    await handleComplete()
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-gray-950 dark:to-gray-900 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        {/* Progress indicator */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {STEPS.map((step, idx) => (
            <div key={step.key} className="flex items-center">
              <div
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors",
                  idx < currentStep
                    ? "bg-green-500 text-white"
                    : idx === currentStep
                    ? "bg-blue-600 text-white"
                    : "bg-muted text-muted-foreground"
                )}
              >
                {idx < currentStep ? (
                  <CheckCircle2 className="h-5 w-5" />
                ) : (
                  idx + 1
                )}
              </div>
              {idx < STEPS.length - 1 && (
                <div
                  className={cn(
                    "w-8 h-0.5 mx-1",
                    idx < currentStep ? "bg-green-500" : "bg-muted"
                  )}
                />
              )}
            </div>
          ))}
        </div>

        <Card className="shadow-xl">
          {/* Step 0: Welcome */}
          {currentStep === 0 && (
            <>
              <CardHeader className="text-center pb-2">
                <div className="mx-auto w-16 h-16 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center mb-4">
                  <Sparkles className="h-8 w-8 text-blue-600 dark:text-blue-400" />
                </div>
                <CardTitle className="text-2xl">¡Bienvenido a STApp!</CardTitle>
                <CardDescription className="text-base mt-2">
                  Vamos a configurar tu cuenta en menos de 5 minutos.
                  Te guiaremos paso a paso.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 pt-4">
                <Button
                  onClick={() => setCurrentStep(1)}
                  className="w-full"
                  size="lg"
                >
                  Comenzar configuración
                  <ChevronRight className="ml-2 h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  onClick={handleSkipToDashboard}
                  className="w-full text-muted-foreground"
                >
                  Omitir e ir al dashboard
                </Button>
              </CardContent>
            </>
          )}

          {/* Step 1: Logo & Business Name */}
          {currentStep === 1 && (
            <>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Upload className="h-5 w-5 text-blue-600" />
                  Personalizá tu negocio
                </CardTitle>
                <CardDescription>
                  Subí tu logo y configurá el nombre que verán tus clientes.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label>Nombre de tu negocio</Label>
                  <Input
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                    placeholder="Ej: TecnoFix Buenos Aires"
                  />
                </div>
                <div>
                  <Label>Logo (opcional)</Label>
                  <div className="mt-2">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) {
                          setLogoFile(file)
                          setLogoPreview(URL.createObjectURL(file))
                        }
                      }}
                      className="block w-full text-sm text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 dark:file:bg-blue-900 dark:file:text-blue-300"
                    />
                    {logoPreview && (
                      <img
                        src={logoPreview}
                        alt="Preview"
                        className="mt-3 h-16 w-auto object-contain rounded"
                      />
                    )}
                  </div>
                </div>
                <div className="flex justify-between pt-4">
                  <Button variant="ghost" onClick={() => setCurrentStep(0)}>
                    <ChevronLeft className="mr-2 h-4 w-4" />
                    Atrás
                  </Button>
                  <Button
                    onClick={logoFile ? handleLogoUpload : handleSaveOrgName}
                    disabled={loading}
                  >
                    {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Siguiente
                    <ChevronRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </>
          )}

          {/* Step 2: First Client */}
          {currentStep === 2 && (
            <>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5 text-blue-600" />
                  Tu primer cliente
                </CardTitle>
                <CardDescription>
                  Creá tu primer cliente o cargá datos de ejemplo para explorar el sistema.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div>
                    <Label>Nombre del cliente</Label>
                    <Input
                      value={clienteNombre}
                      onChange={(e) => setClienteNombre(e.target.value)}
                      placeholder="Ej: Juan Pérez"
                    />
                  </div>
                  <div>
                    <Label>Teléfono</Label>
                    <Input
                      value={clienteTelefono}
                      onChange={(e) => setClienteTelefono(e.target.value)}
                      placeholder="Ej: 1155001234"
                    />
                  </div>
                  <Button
                    onClick={handleCreateClient}
                    disabled={loading || !clienteNombre.trim() || !clienteTelefono.trim()}
                    className="w-full"
                  >
                    {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Crear cliente
                  </Button>
                </div>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-background px-2 text-muted-foreground">O bien</span>
                  </div>
                </div>

                <Button
                  variant="outline"
                  onClick={handleLoadSampleData}
                  disabled={loadingSample}
                  className="w-full"
                >
                  {loadingSample ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Database className="mr-2 h-4 w-4" />
                  )}
                  Cargar datos de ejemplo
                </Button>
                <p className="text-xs text-muted-foreground text-center">
                  Carga 3 clientes, 5 repuestos y 2 órdenes de ejemplo. Podés limpiarlos después.
                </p>

                <div className="flex justify-between pt-2">
                  <Button variant="ghost" onClick={() => setCurrentStep(1)}>
                    <ChevronLeft className="mr-2 h-4 w-4" />
                    Atrás
                  </Button>
                  <Button variant="ghost" onClick={() => setCurrentStep(3)}>
                    Omitir
                    <ChevronRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </>
          )}

          {/* Step 3: First Order */}
          {currentStep === 3 && (
            <>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ClipboardList className="h-5 w-5 text-blue-600" />
                  Tu primera orden
                </CardTitle>
                <CardDescription>
                  Ya tenés lo básico configurado. Podés crear tu primera orden ahora o hacerlo después desde el dashboard.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Button
                  onClick={() => {
                    handleComplete().then(() => router.push("/ordenes?new=true"))
                  }}
                  className="w-full"
                  size="lg"
                >
                  <ClipboardList className="mr-2 h-4 w-4" />
                  Crear mi primera orden
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setCurrentStep(4)}
                  className="w-full"
                >
                  Continuar sin crear orden
                  <ChevronRight className="ml-2 h-4 w-4" />
                </Button>
                <div className="flex justify-start pt-2">
                  <Button variant="ghost" onClick={() => setCurrentStep(2)}>
                    <ChevronLeft className="mr-2 h-4 w-4" />
                    Atrás
                  </Button>
                </div>
              </CardContent>
            </>
          )}

          {/* Step 4: Done */}
          {currentStep === 4 && (
            <>
              <CardHeader className="text-center pb-2">
                <div className="mx-auto w-16 h-16 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center mb-4">
                  <Rocket className="h-8 w-8 text-green-600 dark:text-green-400" />
                </div>
                <CardTitle className="text-2xl">¡Todo listo!</CardTitle>
                <CardDescription className="text-base mt-2">
                  Tu cuenta está configurada. Ya podés empezar a gestionar tus reparaciones.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 pt-4">
                <div className="bg-muted/50 rounded-lg p-4 space-y-2 text-sm">
                  <p className="font-medium">Próximos pasos recomendados:</p>
                  <ul className="space-y-1 text-muted-foreground">
                    <li className="flex items-center gap-2">
                      <CheckSquare className="h-4 w-4 text-blue-500" />
                      Configurar checklists de recepción
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckSquare className="h-4 w-4 text-blue-500" />
                      Agregar técnicos a tu equipo
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckSquare className="h-4 w-4 text-blue-500" />
                      Configurar notificaciones por email
                    </li>
                  </ul>
                </div>
                <Button
                  onClick={handleComplete}
                  disabled={loading}
                  className="w-full"
                  size="lg"
                >
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Ir al Dashboard
                  <ChevronRight className="ml-2 h-4 w-4" />
                </Button>
              </CardContent>
            </>
          )}
        </Card>
      </div>
    </div>
  )
}
