"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { FeaturesEditor } from "./features-editor"
import { Loader2, Save } from "lucide-react"
import type { PlanType, CreatePlanInput, UpdatePlanInput } from "@/types/superadmin"

// Todas las feature flags disponibles en el sistema
const ALL_FEATURE_FLAGS = [
  { key: "advanced_reports", label: "Reportes avanzados" },
  { key: "whatsapp_notifications", label: "Notificaciones WhatsApp" },
  { key: "kiosk_mode", label: "Modo kiosco" },
  { key: "pos_sales", label: "Punto de venta" },
  { key: "client_portal", label: "Portal de seguimiento" },
  { key: "data_export", label: "Exportar datos" },
  { key: "custom_logo", label: "Logo personalizado" },
  { key: "cuenta_corriente", label: "Cuenta corriente" },
  { key: "cotizaciones_online", label: "Cotizaciones online" },
  { key: "gestion_proveedores", label: "Gestión proveedores" },
  { key: "import_export", label: "Import/export datos" },
  { key: "firma_digital", label: "Firma digital" },
  { key: "fotos_etapa", label: "Fotos por etapa" },
  { key: "garantias", label: "Garantías" },
]

interface PlanFormProps {
  mode: "create" | "edit"
  planId?: string
  initialData?: {
    nombre: string
    tipo: PlanType
    descripcion: string | null
    precio_mensual: number
    precio_anual: number
    precio_mensual_usd: number
    precio_anual_usd: number
    limite_ordenes: number | null
    limite_tecnicos: number | null
    limite_clientes: number | null
    limite_storage_mb: number | null
    features: string[]
    feature_flags: Record<string, boolean>
  }
}

export function PlanForm({ mode, planId, initialData }: PlanFormProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  const [formData, setFormData] = useState({
    nombre: initialData?.nombre || "",
    tipo: initialData?.tipo || ("FREE" as PlanType),
    descripcion: initialData?.descripcion || "",
    precio_mensual: initialData?.precio_mensual ?? 0,
    precio_anual: initialData?.precio_anual ?? 0,
    precio_mensual_usd: initialData?.precio_mensual_usd ?? 0,
    precio_anual_usd: initialData?.precio_anual_usd ?? 0,
    limite_ordenes: initialData?.limite_ordenes ?? null,
    limite_tecnicos: initialData?.limite_tecnicos ?? null,
    limite_clientes: initialData?.limite_clientes ?? null,
    limite_storage_mb: initialData?.limite_storage_mb ?? null,
    features: initialData?.features || [],
    feature_flags: initialData?.feature_flags || {},
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      const endpoint = mode === "create"
        ? "/api/superadmin/plans"
        : `/api/superadmin/plans/${planId}`

      const method = mode === "create" ? "POST" : "PATCH"

      const payload: CreatePlanInput | UpdatePlanInput = mode === "create"
        ? {
            nombre: formData.nombre,
            tipo: formData.tipo,
            descripcion: formData.descripcion || null,
            precio_mensual: formData.precio_mensual,
            precio_anual: formData.precio_anual,
            moneda: "ARS",
            limite_ordenes: formData.limite_ordenes,
            limite_tecnicos: formData.limite_tecnicos,
            limite_clientes: formData.limite_clientes,
            limite_storage_mb: formData.limite_storage_mb,
            features: formData.features,
          }
        : {
            nombre: formData.nombre,
            descripcion: formData.descripcion || null,
            precio_mensual: formData.precio_mensual,
            precio_anual: formData.precio_anual,
            precio_mensual_usd: formData.precio_mensual_usd,
            precio_anual_usd: formData.precio_anual_usd,
            limite_ordenes: formData.limite_ordenes,
            limite_tecnicos: formData.limite_tecnicos,
            limite_clientes: formData.limite_clientes,
            limite_storage_mb: formData.limite_storage_mb,
            features: formData.features,
            feature_flags: formData.feature_flags,
          }

      const res = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      const data = await res.json()

      if (!res.ok) {
        toast.error(data.error || "Error al guardar el plan")
        return
      }

      toast.success(data.message)
      router.push("/superadmin/planes")
      router.refresh()
    } catch (error) {
      console.error("Error:", error)
      toast.error("Error al guardar el plan")
    } finally {
      setLoading(false)
    }
  }

  const isFree = formData.tipo === "FREE"

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Información Básica */}
      <Card>
        <CardHeader>
          <CardTitle>Información Básica</CardTitle>
          <CardDescription>
            Datos principales del plan de suscripción
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="nombre">Nombre del Plan *</Label>
              <Input
                id="nombre"
                required
                minLength={2}
                maxLength={50}
                value={formData.nombre}
                onChange={(e) =>
                  setFormData({ ...formData, nombre: e.target.value })
                }
                placeholder="Ej: Plan Básico"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="tipo">Tipo de Plan *</Label>
              <Select
                value={formData.tipo}
                onValueChange={(value: PlanType) =>
                  setFormData({
                    ...formData,
                    tipo: value,
                    precio_mensual: value === "FREE" ? 0 : formData.precio_mensual,
                    precio_anual: value === "FREE" ? 0 : formData.precio_anual,
                  })
                }
                disabled={mode === "edit"}
              >
                <SelectTrigger id="tipo">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="FREE">FREE</SelectItem>
                  <SelectItem value="PREMIUM">PREMIUM</SelectItem>
                </SelectContent>
              </Select>
              {mode === "edit" && (
                <p className="text-xs text-muted-foreground">
                  El tipo de plan no se puede modificar
                </p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="descripcion">Descripción</Label>
            <Textarea
              id="descripcion"
              maxLength={500}
              rows={3}
              value={formData.descripcion}
              onChange={(e) =>
                setFormData({ ...formData, descripcion: e.target.value })
              }
              placeholder="Descripción corta del plan"
            />
          </div>
        </CardContent>
      </Card>

      {/* Precios */}
      <Card>
        <CardHeader>
          <CardTitle>Precios</CardTitle>
          <CardDescription>
            {isFree
              ? "Plan FREE: los precios deben ser 0"
              : "Define los precios mensuales y anuales en ARS"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="precio_mensual">Precio Mensual (ARS) *</Label>
              <Input
                id="precio_mensual"
                type="number"
                min={0}
                step="0.01"
                required
                value={formData.precio_mensual}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    precio_mensual: parseFloat(e.target.value) || 0,
                  })
                }
                disabled={isFree}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="precio_anual">Precio Anual (ARS) *</Label>
              <Input
                id="precio_anual"
                type="number"
                min={0}
                step="0.01"
                required
                value={formData.precio_anual}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    precio_anual: parseFloat(e.target.value) || 0,
                  })
                }
                disabled={isFree}
              />
            </div>
          </div>

          {!isFree && formData.precio_anual > 0 && formData.precio_mensual > 0 && (
            <div className="p-3 bg-muted rounded-lg text-sm">
              <span className="text-muted-foreground">Ahorro anual: </span>
              <span className="font-semibold">
                {((1 - formData.precio_anual / (formData.precio_mensual * 12)) * 100).toFixed(1)}%
              </span>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="precio_mensual_usd">Precio Mensual (USD)</Label>
              <Input
                id="precio_mensual_usd"
                type="number"
                min={0}
                step="0.01"
                value={formData.precio_mensual_usd}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    precio_mensual_usd: parseFloat(e.target.value) || 0,
                  })
                }
                disabled={isFree}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="precio_anual_usd">Precio Anual (USD)</Label>
              <Input
                id="precio_anual_usd"
                type="number"
                min={0}
                step="0.01"
                value={formData.precio_anual_usd}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    precio_anual_usd: parseFloat(e.target.value) || 0,
                  })
                }
                disabled={isFree}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Límites */}
      <Card>
        <CardHeader>
          <CardTitle>Límites del Plan</CardTitle>
          <CardDescription>
            Deja en blanco o 0 para límites ilimitados
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="limite_ordenes">Órdenes por mes</Label>
              <Input
                id="limite_ordenes"
                type="number"
                min={0}
                value={formData.limite_ordenes ?? ""}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    limite_ordenes: e.target.value ? parseInt(e.target.value) : null,
                  })
                }
                placeholder="Ilimitado"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="limite_tecnicos">Técnicos</Label>
              <Input
                id="limite_tecnicos"
                type="number"
                min={0}
                value={formData.limite_tecnicos ?? ""}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    limite_tecnicos: e.target.value ? parseInt(e.target.value) : null,
                  })
                }
                placeholder="Ilimitado"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="limite_clientes">Clientes</Label>
              <Input
                id="limite_clientes"
                type="number"
                min={0}
                value={formData.limite_clientes ?? ""}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    limite_clientes: e.target.value ? parseInt(e.target.value) : null,
                  })
                }
                placeholder="Ilimitado"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="limite_storage_mb">Storage (MB)</Label>
              <Input
                id="limite_storage_mb"
                type="number"
                min={0}
                value={formData.limite_storage_mb ?? ""}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    limite_storage_mb: e.target.value ? parseInt(e.target.value) : null,
                  })
                }
                placeholder="Ilimitado"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Feature Flags */}
      <Card>
        <CardHeader>
          <CardTitle>Feature Flags</CardTitle>
          <CardDescription>
            Funcionalidades habilitadas para este plan. Los usuarios Free no deberían tener ninguna activada.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-2">
            {ALL_FEATURE_FLAGS.map(({ key, label }) => (
              <div
                key={key}
                className="flex items-center justify-between py-2 px-3 bg-muted/50 rounded-lg"
              >
                <Label htmlFor={`flag-${key}`} className="text-sm font-normal cursor-pointer">
                  {label}
                </Label>
                <Switch
                  id={`flag-${key}`}
                  checked={formData.feature_flags[key] === true}
                  onCheckedChange={(checked) =>
                    setFormData({
                      ...formData,
                      feature_flags: {
                        ...formData.feature_flags,
                        [key]: checked,
                      },
                    })
                  }
                  disabled={loading}
                />
              </div>
            ))}
          </div>
          <div className="flex gap-2 mt-4">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                const allOn: Record<string, boolean> = {}
                ALL_FEATURE_FLAGS.forEach(({ key }) => { allOn[key] = true })
                setFormData({ ...formData, feature_flags: allOn })
              }}
            >
              Activar todas
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setFormData({ ...formData, feature_flags: {} })}
            >
              Desactivar todas
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Características */}
      <Card>
        <CardHeader>
          <CardTitle>Características</CardTitle>
          <CardDescription>
            Lista de features incluidas en el plan (texto visible para el usuario)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FeaturesEditor
            features={formData.features}
            onChange={(features) => setFormData({ ...formData, features })}
            disabled={loading}
          />
        </CardContent>
      </Card>

      {/* Acciones */}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={loading} className="gap-2">
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Guardando...
            </>
          ) : (
            <>
              <Save className="h-4 w-4" />
              {mode === "create" ? "Crear Plan" : "Guardar Cambios"}
            </>
          )}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          disabled={loading}
        >
          Cancelar
        </Button>
      </div>
    </form>
  )
}
