"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Save, Bell, Mail, Package } from "lucide-react"
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon"

interface NotificationConfig {
  notificacionesEmail: boolean
  notificacionesWhatsapp: boolean
  diasRecordatorio: number
  notifStockBajo: boolean
}

interface NotificationSettingsProps {
  allowEdit?: boolean
}

export function NotificationSettings({ allowEdit = true }: NotificationSettingsProps) {
  const [config, setConfig] = useState<NotificationConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{
    type: "success" | "error"
    text: string
  } | null>(null)

  useEffect(() => {
    fetchConfig()
  }, [])

  const fetchConfig = async () => {
    try {
      const res = await fetch("/api/notificaciones/config")
      if (res.ok) {
        const data = await res.json()
        setConfig(data)
      }
    } catch (error) {
      console.error("Error fetching config:", error)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    if (!config) return

    setSaving(true)
    setMessage(null)

    try {
      const res = await fetch("/api/notificaciones/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      })

      if (res.ok) {
        setMessage({ type: "success", text: "Configuracion guardada" })
        setTimeout(() => setMessage(null), 3000)
      } else {
        const error = await res.json()
        setMessage({ type: "error", text: error.error || "Error al guardar" })
      }
    } catch (error) {
      setMessage({ type: "error", text: "Error al guardar configuracion" })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Notificaciones
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-muted-foreground">Cargando...</div>
        </CardContent>
      </Card>
    )
  }

  if (!config) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Notificaciones
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-muted-foreground">
            Error al cargar configuracion
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="p-4 sm:p-6">
        <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
          <Bell className="h-4 w-4 sm:h-5 sm:w-5" />
          Notificaciones
        </CardTitle>
        <CardDescription className="text-xs sm:text-sm">
          Configura como y cuando se envian notificaciones
        </CardDescription>
      </CardHeader>
      <CardContent className="p-4 sm:p-6 pt-0 space-y-4 sm:space-y-6">
        {message && (
          <div
            className={`px-3 sm:px-4 py-2 sm:py-3 rounded text-xs sm:text-sm ${
              message.type === "success"
                ? "bg-green-50 dark:bg-green-950/50 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400"
                : "bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400"
            }`}
          >
            {message.text}
          </div>
        )}

        <div className="flex items-center justify-between p-3 sm:p-4 border rounded-lg gap-3">
          <div className="flex items-start gap-2 sm:gap-3 min-w-0">
            <Mail className="h-4 w-4 sm:h-5 sm:w-5 text-blue-600 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <Label className="text-sm sm:text-base">Email</Label>
              <p className="text-xs sm:text-sm text-muted-foreground">
                Emails al cambiar estado, presupuesto, garantia, etc.
              </p>
            </div>
          </div>
          <label className={`relative inline-flex items-center shrink-0 ${allowEdit ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}>
            <input
              type="checkbox"
              checked={config.notificacionesEmail}
              onChange={(e) =>
                setConfig({ ...config, notificacionesEmail: e.target.checked })
              }
              disabled={!allowEdit}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 dark:bg-gray-700 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 dark:after:border-gray-600 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
          </label>
        </div>

        <div className="flex items-center justify-between p-3 sm:p-4 border rounded-lg gap-3">
          <div className="flex items-start gap-2 sm:gap-3 min-w-0">
            <WhatsAppIcon className="h-4 w-4 sm:h-5 sm:w-5 text-green-600 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <Label className="text-sm sm:text-base">WhatsApp</Label>
              <p className="text-xs sm:text-sm text-muted-foreground">
                Boton con plantillas de mensajes en ordenes
              </p>
            </div>
          </div>
          <label className={`relative inline-flex items-center shrink-0 ${allowEdit ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}>
            <input
              type="checkbox"
              checked={config.notificacionesWhatsapp}
              onChange={(e) =>
                setConfig({
                  ...config,
                  notificacionesWhatsapp: e.target.checked,
                })
              }
              disabled={!allowEdit}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 dark:bg-gray-700 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-green-300 dark:peer-focus:ring-green-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 dark:after:border-gray-600 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600"></div>
          </label>
        </div>

        <div className="flex items-center justify-between p-3 sm:p-4 border rounded-lg gap-3">
          <div className="flex items-start gap-2 sm:gap-3 min-w-0">
            <Package className="h-4 w-4 sm:h-5 sm:w-5 text-red-600 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <Label className="text-sm sm:text-base">Stock bajo</Label>
              <p className="text-xs sm:text-sm text-muted-foreground">
                Aviso in-app a admins cuando un item cruza su umbral (punto de reorden / stock mínimo / global). Cooldown 24h por item.
              </p>
            </div>
          </div>
          <label className={`relative inline-flex items-center shrink-0 ${allowEdit ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}>
            <input
              type="checkbox"
              checked={config.notifStockBajo}
              onChange={(e) =>
                setConfig({ ...config, notifStockBajo: e.target.checked })
              }
              disabled={!allowEdit}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 dark:bg-gray-700 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-red-300 dark:peer-focus:ring-red-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 dark:after:border-gray-600 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-red-600"></div>
          </label>
        </div>

        <div className="p-3 sm:p-4 border rounded-lg">
          <Label className="text-sm sm:text-base">Recordatorio de retiro</Label>
          <p className="text-xs sm:text-sm text-muted-foreground mb-3">
            Recordatorio si el cliente no retira su dispositivo
          </p>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min="1"
              max="30"
              value={config.diasRecordatorio}
              onChange={(e) =>
                setConfig({
                  ...config,
                  diasRecordatorio: parseInt(e.target.value) || 3,
                })
              }
              disabled={!allowEdit}
              className="w-20 sm:w-24"
            />
            <span className="text-xs sm:text-sm text-muted-foreground">dias</span>
          </div>
        </div>

        <Button onClick={handleSave} disabled={saving || !allowEdit} className="w-full">
          <Save className="mr-2 h-4 w-4" />
          {saving ? "Guardando..." : "Guardar configuracion"}
        </Button>
      </CardContent>
    </Card>
  )
}
