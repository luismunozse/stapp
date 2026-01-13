"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Save, Bell, Mail } from "lucide-react"
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon"

interface NotificationConfig {
  notificacionesEmail: boolean
  notificacionesWhatsapp: boolean
  diasRecordatorio: number
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
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="h-5 w-5" />
          Notificaciones
        </CardTitle>
        <CardDescription>
          Configura como y cuando se envian notificaciones a los clientes
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {message && (
          <div
            className={`px-4 py-3 rounded text-sm ${
              message.type === "success"
                ? "bg-green-50 border border-green-200 text-green-700"
                : "bg-red-50 border border-red-200 text-red-700"
            }`}
          >
            {message.text}
          </div>
        )}

        <div className="flex items-center justify-between p-4 border rounded-lg">
          <div className="flex items-start gap-3">
            <Mail className="h-5 w-5 text-blue-600 mt-0.5" />
            <div>
              <Label className="text-base">Notificaciones por Email</Label>
              <p className="text-sm text-muted-foreground">
                Enviar emails automaticos al cambiar estado, definir
                presupuesto, crear garantia, etc.
              </p>
            </div>
          </div>
          <label className={`relative inline-flex items-center ${allowEdit ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}>
            <input
              type="checkbox"
              checked={config.notificacionesEmail}
              onChange={(e) =>
                setConfig({ ...config, notificacionesEmail: e.target.checked })
              }
              disabled={!allowEdit}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
          </label>
        </div>

        <div className="flex items-center justify-between p-4 border rounded-lg">
          <div className="flex items-start gap-3">
            <WhatsAppIcon className="h-5 w-5 text-green-600 mt-0.5" />
            <div>
              <Label className="text-base">Boton WhatsApp</Label>
              <p className="text-sm text-muted-foreground">
                Mostrar boton de WhatsApp con plantillas de mensajes en las
                ordenes
              </p>
            </div>
          </div>
          <label className={`relative inline-flex items-center ${allowEdit ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}>
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
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-green-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600"></div>
          </label>
        </div>

        <div className="p-4 border rounded-lg">
          <Label className="text-base">Dias para recordatorio de retiro</Label>
          <p className="text-sm text-muted-foreground mb-3">
            Enviar recordatorio automatico si el cliente no retira su
            dispositivo despues de X dias
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
              className="w-24"
            />
            <span className="text-sm text-muted-foreground">dias</span>
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
