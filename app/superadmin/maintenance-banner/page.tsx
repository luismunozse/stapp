"use client"

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Wrench, Save, Loader2, AlertTriangle, Info } from "lucide-react"
import { useSuperadminFetch, useSuperadminMutation } from "@/hooks/use-superadmin-fetch"
import { formatDateTime } from "@/lib/utils"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

interface MaintenanceBannerData {
  id: string
  active: boolean
  message: string
  severity: "INFO" | "WARNING" | "CRITICAL"
  updated_at: string | null
  updated_by: string | null
}

export default function MaintenanceBannerPage() {
  const { data, loading, fetchData } = useSuperadminFetch<MaintenanceBannerData>()
  const { mutate, loading: saving } = useSuperadminMutation<MaintenanceBannerData>()

  const [active, setActive] = useState(false)
  const [message, setMessage] = useState("")
  const [severity, setSeverity] = useState<"INFO" | "WARNING" | "CRITICAL">("INFO")
  const [initialized, setInitialized] = useState(false)

  const loadBanner = useCallback(async () => {
    const result = await fetchData("/api/superadmin/maintenance-banner")
    if (result) {
      setActive(result.active)
      setMessage(result.message)
      setSeverity(result.severity)
      setInitialized(true)
    }
  }, [fetchData])

  useEffect(() => {
    loadBanner()
  }, [loadBanner])

  const handleSave = async () => {
    if (active && !message.trim()) {
      toast.error("El mensaje no puede estar vacío si el banner está activo")
      return
    }

    const result = await mutate("/api/superadmin/maintenance-banner", {
      method: "PUT",
      body: { active, message, severity },
      successMessage: active
        ? "Banner publicado en todas las organizaciones"
        : "Banner desactivado",
    })

    if (result) {
      loadBanner()
    }
  }

  const severityStyles = {
    INFO: "bg-blue-500 text-white border-blue-600",
    WARNING: "bg-amber-500 text-amber-950 border-amber-600",
    CRITICAL: "bg-red-500 text-white border-red-600",
  }

  const severityIcons = {
    INFO: Info,
    WARNING: Wrench,
    CRITICAL: AlertTriangle,
  }

  const PreviewIcon = severityIcons[severity]

  if (loading && !initialized) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Wrench className="h-6 w-6" />
          Banner de Mantenimiento
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Mostrá un aviso global a todas las organizaciones sobre mantenimiento,
          actualizaciones o incidentes en curso.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Configuración</CardTitle>
          <CardDescription>
            Cuando el banner está activo, aparece en la parte superior del dashboard
            de todos los usuarios.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Active toggle */}
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">Banner activo</Label>
              <p className="text-xs text-muted-foreground">
                {active
                  ? "El aviso se está mostrando a todas las organizaciones"
                  : "El aviso está oculto"}
              </p>
            </div>
            <Switch checked={active} onCheckedChange={setActive} />
          </div>

          {/* Severity */}
          <div>
            <Label htmlFor="severity" className="text-sm">
              Tipo de aviso
            </Label>
            <Select
              value={severity}
              onValueChange={(v) => setSeverity(v as "INFO" | "WARNING" | "CRITICAL")}
            >
              <SelectTrigger id="severity" className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="INFO">Informativo (azul)</SelectItem>
                <SelectItem value="WARNING">Mantenimiento (amarillo)</SelectItem>
                <SelectItem value="CRITICAL">Crítico (rojo)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Message */}
          <div>
            <Label htmlFor="message" className="text-sm">
              Mensaje
            </Label>
            <Textarea
              id="message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Estamos realizando tareas de mantenimiento. Algunas funcionalidades pueden verse afectadas."
              rows={3}
              maxLength={500}
              className="mt-1"
            />
            <p className="text-xs text-muted-foreground mt-1">
              {message.length} / 500 caracteres
            </p>
          </div>

          {/* Preview */}
          {message.trim() && (
            <div>
              <Label className="text-sm">Vista previa</Label>
              <div className="mt-2 p-4 bg-muted/30 rounded-lg border">
                <div
                  className={cn(
                    "px-4 py-2 text-sm font-medium rounded-full shadow-lg inline-flex items-center gap-2 border",
                    severityStyles[severity]
                  )}
                >
                  <PreviewIcon className="h-4 w-4 shrink-0" />
                  <span>{message}</span>
                </div>
              </div>
            </div>
          )}

          {/* Meta info */}
          {data?.updated_at && (
            <div className="text-xs text-muted-foreground border-t pt-3">
              Última actualización: {formatDateTime(data.updated_at)}
              {data.updated_by && ` por ${data.updated_by}`}
            </div>
          )}

          {/* Save */}
          <div className="flex justify-end pt-2">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Guardando...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Guardar cambios
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
