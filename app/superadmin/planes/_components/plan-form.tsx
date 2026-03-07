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
import { FeaturesEditor } from "./features-editor"
import { Loader2, Save } from "lucide-react"
import type { PlanType, CreatePlanInput, UpdatePlanInput } from "@/types/superadmin"

interface PlanFormProps {
  mode: "create" | "edit"
  planId?: string
  initialData?: {
    nombre: string
    tipo: PlanType
    descripcion: string | null
    precio_mensual: number
    precio_anual: number
    limite_ordenes: number | null
    limite_tecnicos: number | null
    limite_clientes: number | null
    limite_storage_mb: number | null
    features: string[]
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
    limite_ordenes: initialData?.limite_ordenes ?? null,
    limite_tecnicos: initialData?.limite_tecnicos ?? null,
    limite_clientes: initialData?.limite_clientes ?? null,
    limite_storage_mb: initialData?.limite_storage_mb ?? null,
    features: initialData?.features || [],
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
            limite_ordenes: formData.limite_ordenes,
            limite_tecnicos: formData.limite_tecnicos,
            limite_clientes: formData.limite_clientes,
            limite_storage_mb: formData.limite_storage_mb,
            features: formData.features,
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

      {/* Características */}
      <Card>
        <CardHeader>
          <CardTitle>Características</CardTitle>
          <CardDescription>
            Lista de features incluidas en el plan
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
