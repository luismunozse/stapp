"use client"
import { useTerminologia } from "@/contexts/currency-context"

import { useState, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Camera, Upload, X, Loader2 } from "lucide-react"
import { compressImage } from "@/lib/image-compression"
import { isNativePlatform } from "@/lib/capacitor"
import { useModal } from "@/contexts/modal-context"

interface FotoUploadProps {
  ordenId: string
  onSuccess: () => void
  onClose: () => void
}

const buildTipoFotoOptions = (term: (k: string) => string) => [
  { value: "INGRESO", label: `Ingreso del ${term("equipo").toLowerCase()}` },
  { value: "DIAGNOSTICO", label: "Diagnóstico / Falla detectada" },
  { value: "COMPONENTE", label: "Componente / Repuesto" },
  { value: "REPARACION", label: "Durante reparación" },
  { value: "ENTREGA", label: "Entrega al cliente" },
]

export function FotoUpload({ ordenId, onSuccess, onClose }: FotoUploadProps) {
  const term = useTerminologia()
  const tipoFotoOptions = buildTipoFotoOptions(term)
  const { showError } = useModal()
  const [loading, setLoading] = useState(false)
  const [comprimiendo, setComprimiendo] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const [tipo, setTipo] = useState("REPARACION")
  const [descripcion, setDescripcion] = useState("")
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)

  const handleNativeCamera = async () => {
    try {
      const { Camera: CapCamera, CameraResultType, CameraSource } = await import("@capacitor/camera")
      const image = await CapCamera.getPhoto({
        quality: 80,
        allowEditing: false,
        resultType: CameraResultType.DataUrl,
        source: CameraSource.Camera,
      })
      if (image.dataUrl) {
        setPreview(image.dataUrl)
      }
    } catch (error) {
      console.error("Error cámara nativa:", error)
    }
  }

  const handleNativeGallery = async () => {
    try {
      const { Camera: CapCamera, CameraResultType, CameraSource } = await import("@capacitor/camera")
      const image = await CapCamera.getPhoto({
        quality: 80,
        allowEditing: false,
        resultType: CameraResultType.DataUrl,
        source: CameraSource.Photos,
      })
      if (image.dataUrl) {
        setPreview(image.dataUrl)
      }
    } catch (error) {
      console.error("Error galería nativa:", error)
    }
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validar tipo de archivo
    if (!file.type.startsWith("image/")) {
      await showError("Por favor selecciona una imagen válida")
      return
    }

    setComprimiendo(true)
    try {
      // Comprimir imagen (máx 300KB, 1920px)
      const compressedFile = await compressImage(file)

      const reader = new FileReader()
      reader.onloadend = () => {
        setPreview(reader.result as string)
        setComprimiendo(false)
      }
      reader.readAsDataURL(compressedFile)
    } catch (error) {
      console.error("Error comprimiendo:", error)
      setComprimiendo(false)
      await showError("Error al procesar la imagen")
    }
  }

  const handleUpload = async () => {
    if (!preview) {
      await showError("Selecciona una imagen primero")
      return
    }

    setLoading(true)
    try {
      // Extraer el base64 sin el prefijo data:image/...;base64,
      const base64Match = preview.match(/^data:(image\/[a-z]+);base64,(.+)$/)
      if (!base64Match) {
        await showError("Formato de imagen inválido")
        return
      }

      const mime = base64Match[1]
      const data = base64Match[2]

      const res = await fetch(`/api/ordenes/${ordenId}/fotos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data,
          mime,
          tipo,
          descripcion: descripcion || undefined,
        }),
      })

      if (!res.ok) {
        const error = await res.json()
        await showError(error.error || "Error al subir la foto")
        return
      }

      onSuccess()
    } catch (error) {
      console.error("Error:", error)
      await showError("Error al subir la foto")
    } finally {
      setLoading(false)
    }
  }

  const clearPreview = () => {
    setPreview(null)
    if (fileInputRef.current) fileInputRef.current.value = ""
    if (cameraInputRef.current) cameraInputRef.current.value = ""
  }

  return (
    <Card className="mb-4">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Camera className="h-5 w-5" />
            Subir Foto
          </CardTitle>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Botones para seleccionar imagen */}
        {!preview && !comprimiendo && (
          <div className="flex gap-2">
            {!isNativePlatform() && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </>
            )}
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={isNativePlatform() ? handleNativeGallery : () => fileInputRef.current?.click()}
            >
              <Upload className="mr-2 h-4 w-4" />
              Seleccionar archivo
            </Button>
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={isNativePlatform() ? handleNativeCamera : () => cameraInputRef.current?.click()}
            >
              <Camera className="mr-2 h-4 w-4" />
              Tomar foto
            </Button>
          </div>
        )}

        {/* Indicador de compresión */}
        {comprimiendo && (
          <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            Comprimiendo imagen...
          </div>
        )}

        {/* Preview de la imagen */}
        {preview && (
          <div className="relative">
            <img
              src={preview}
              alt="Preview"
              className="w-full max-h-64 object-contain rounded-lg border"
            />
            <Button
              variant="destructive"
              size="icon"
              className="absolute top-2 right-2"
              onClick={clearPreview}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}

        {/* Opciones */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="tipo">Tipo de foto</Label>
            <Select
              value={tipo}
              onValueChange={setTipo}
              disabled={loading}
            >
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar tipo" />
              </SelectTrigger>
              <SelectContent>
                {tipoFotoOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="descripcion">Descripción (opcional)</Label>
            <Input
              id="descripcion"
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              placeholder="Ej: Pantalla dañada"
              disabled={loading}
            />
          </div>
        </div>

        {/* Botones de acción */}
        <div className="flex gap-2 justify-end">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={handleUpload} disabled={loading || !preview}>
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Subiendo...
              </>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" />
                Subir Foto
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
