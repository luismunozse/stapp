"use client"

import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Upload, Trash2, Save, ImageIcon } from "lucide-react"
import { useModal } from "@/contexts/modal-context"
import { NotificationSettings } from "@/components/configuracion/notification-settings"

interface Config {
  logoData: string | null
  logoMime: string | null
  logoUrl: string | null
  nombreEmpresa: string
  telefono: string | null
  direccion: string | null
}

interface ConfiguracionFormProps {
  allowEdit?: boolean
}

export function ConfiguracionForm({ allowEdit = true }: ConfiguracionFormProps) {
  const { confirm } = useModal()
  const [config, setConfig] = useState<Config | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const [nombreEmpresa, setNombreEmpresa] = useState("Servicio Técnico")
  const [telefono, setTelefono] = useState("")
  const [direccion, setDireccion] = useState("")
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetchConfig()
  }, [])

  const fetchConfig = async () => {
    try {
      const res = await fetch("/api/configuracion")
      if (res.ok) {
        const data = await res.json()
        setConfig(data)
        setNombreEmpresa(data.nombreEmpresa || "Servicio Técnico")
        setTelefono(data.telefono || "")
        setDireccion(data.direccion || "")
        // Usar logoUrl si existe, o logoData para compatibilidad
        if (data.logoUrl) {
          setPreview(data.logoUrl)
        } else if (data.logoData && data.logoMime) {
          setPreview(`data:${data.logoMime};base64,${data.logoData}`)
        }
      }
    } catch (error) {
      console.error("Error fetching config:", error)
    } finally {
      setLoading(false)
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith("image/")) {
      setMessage({ type: "error", text: "Por favor selecciona una imagen válida" })
      return
    }

    if (file.size > 2 * 1024 * 1024) {
      setMessage({ type: "error", text: "La imagen es demasiado grande (máximo 2MB)" })
      return
    }

    const reader = new FileReader()
    reader.onload = (event) => {
      const result = event.target?.result as string
      setPreview(result)
      setMessage(null)
    }
    reader.readAsDataURL(file)
  }

  const handleSave = async () => {
    setSaving(true)
    setMessage(null)
    try {
      let logoData = null
      let logoMime = null

      if (preview && preview.startsWith("data:")) {
        const [header, data] = preview.split(",")
        logoMime = header.split(":")[1].split(";")[0]
        logoData = data
      }

      const res = await fetch("/api/configuracion", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ logoData, logoMime, nombreEmpresa, telefono, direccion }),
      })

      if (res.ok) {
        setMessage({ type: "success", text: "Configuración guardada exitosamente" })
        fetchConfig()
      } else {
        const error = await res.json()
        setMessage({ type: "error", text: error.error || "Error al guardar" })
      }
    } catch (error) {
      console.error("Error saving config:", error)
      setMessage({ type: "error", text: "Error al guardar configuración" })
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteLogo = async () => {
    const confirmed = await confirm({
      title: "Eliminar Logo",
      description: "¿Estás seguro de eliminar el logo? Se mostrará el texto por defecto.",
      confirmText: "Eliminar",
      cancelText: "Cancelar",
      variant: "warning",
    })

    if (!confirmed) return

    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch("/api/configuracion", { method: "DELETE" })
      if (res.ok) {
        setPreview(null)
        setMessage({ type: "success", text: "Logo eliminado" })
        fetchConfig()
      }
    } catch (error) {
      console.error("Error deleting logo:", error)
      setMessage({ type: "error", text: "Error al eliminar logo" })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {message && (
        <div
          className={`px-4 py-3 rounded ${
            message.type === "success"
              ? "bg-green-50 border border-green-200 text-green-700"
              : "bg-red-50 border border-red-200 text-red-700"
          }`}
        >
          {message.text}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Logo de la Empresa</CardTitle>
          <CardDescription>
            Sube un logo para personalizar la aplicación. Se mostrará en el login, la barra de navegación y los comprobantes PDF.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="w-24 h-24 border-2 border-dashed border-gray-300 rounded-lg flex items-center justify-center overflow-hidden bg-gray-50">
              {preview ? (
                <img
                  src={preview}
                  alt="Logo preview"
                  className="max-w-full max-h-full object-contain"
                />
              ) : (
                <ImageIcon className="h-8 w-8 text-gray-400" />
              )}
            </div>
            <div className="space-y-2">
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept="image/png,image/jpeg,image/gif,image/webp"
                className="hidden"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={!allowEdit}
              >
                <Upload className="mr-2 h-4 w-4" />
                Subir Logo
              </Button>
              {preview && (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={handleDeleteLogo}
                  disabled={saving || !allowEdit}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Eliminar
                </Button>
              )}
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Formatos aceptados: PNG, JPG, GIF, WebP. Tamaño máximo: 2MB.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Datos de la Empresa</CardTitle>
          <CardDescription>
            Estos datos se mostrarán en la aplicación y en los comprobantes PDF generados.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="nombreEmpresa">Nombre de la Empresa</Label>
            <Input
              id="nombreEmpresa"
              value={nombreEmpresa}
              onChange={(e) => setNombreEmpresa(e.target.value)}
              placeholder="Servicio Técnico"
              disabled={!allowEdit}
            />
          </div>
          <div>
            <Label htmlFor="telefono">Teléfono</Label>
            <Input
              id="telefono"
              value={telefono}
              onChange={(e) => setTelefono(e.target.value)}
              placeholder="+54 11 1234-5678"
              disabled={!allowEdit}
            />
            <p className="text-sm text-muted-foreground mt-1">
              Se mostrará en los comprobantes PDF
            </p>
          </div>
          <div>
            <Label htmlFor="direccion">Dirección</Label>
            <Input
              id="direccion"
              value={direccion}
              onChange={(e) => setDireccion(e.target.value)}
              placeholder="Av. Principal 123, Ciudad"
              disabled={!allowEdit}
            />
            <p className="text-sm text-muted-foreground mt-1">
              Se mostrará en los comprobantes PDF
            </p>
          </div>
        </CardContent>
      </Card>

      <Button onClick={handleSave} disabled={saving || !allowEdit} className="w-full sm:w-auto">
        <Save className="mr-2 h-4 w-4" />
        {saving ? "Guardando..." : "Guardar Cambios"}
      </Button>

      {/* Configuración de notificaciones - se guarda por separado */}
      <NotificationSettings allowEdit={allowEdit} />
    </div>
  )
}
