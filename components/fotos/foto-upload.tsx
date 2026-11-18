"use client"
import { useTerminologia } from "@/contexts/currency-context"

import { useState, useRef } from "react"
import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Camera, Upload, X, Loader2, ImagePlus, Trash2, QrCode } from "lucide-react"
import { compressImage } from "@/lib/image-compression"
import { isNativePlatform } from "@/lib/capacitor"
import { useModal } from "@/contexts/modal-context"
import { cn } from "@/lib/utils"
import { SOLO_PC, useZonaArchivos } from "./use-zona-archivos"
import { FotoCelularDialog } from "./foto-celular-dialog"

interface FotoUploadProps {
  ordenId: string
  /** Se subieron todas: el padre cierra el panel y recarga la galeria. */
  onSuccess: () => void
  /** Entraron fotos sin terminar la tanda (fallaron otras, o llegaron desde
   *  el celular): el padre recarga sin cerrar. */
  onUploaded?: () => void
  onClose: () => void
}

interface FotoPendiente {
  id: string
  preview: string
  descripcion: string
}

const nuevoId = () => Math.random().toString(36).slice(2, 11)

const leerComoDataUrl = (file: File) =>
  new Promise<string | null>((resolve) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(typeof reader.result === "string" ? reader.result : null)
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(file)
  })

const buildTipoFotoOptions = (term: (k: string) => string) => [
  { value: "INGRESO", label: `Ingreso del ${term("equipo").toLowerCase()}` },
  { value: "DIAGNOSTICO", label: "Diagnóstico / Falla detectada" },
  { value: "COMPONENTE", label: "Componente / Repuesto" },
  { value: "REPARACION", label: "Durante reparación" },
  { value: "ENTREGA", label: "Entrega al cliente" },
]

export function FotoUpload({ ordenId, onSuccess, onUploaded, onClose }: FotoUploadProps) {
  const term = useTerminologia()
  const tipoFotoOptions = buildTipoFotoOptions(term)
  const { showError } = useModal()
  const [loading, setLoading] = useState(false)
  const [progreso, setProgreso] = useState(0)
  const [comprimiendo, setComprimiendo] = useState(false)
  const [pendientes, setPendientes] = useState<FotoPendiente[]>([])
  const [tipo, setTipo] = useState("REPARACION")
  const [celularAbierto, setCelularAbierto] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)

  const ocupado = loading || comprimiendo

  const agregarPreview = (preview: string) => {
    setPendientes((prev) => [...prev, { id: nuevoId(), preview, descripcion: "" }])
  }

  const tomarNativa = async (origen: "Camera" | "Photos") => {
    try {
      const { Camera: CapCamera, CameraResultType, CameraSource } = await import("@capacitor/camera")
      const image = await CapCamera.getPhoto({
        quality: 80,
        allowEditing: false,
        resultType: CameraResultType.DataUrl,
        source: CameraSource[origen],
      })
      if (image.dataUrl) agregarPreview(image.dataUrl)
    } catch (error) {
      console.error("Error cámara/galería nativa:", error)
    }
  }

  // Recibe los archivos del selector, arrastrados o pegados (Ctrl+V).
  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return

    setComprimiendo(true)
    try {
      const previews = await Promise.all(
        files.map(async (file) => {
          if (!file.type.startsWith("image/")) return null
          try {
            // Comprimir imagen (máx 300KB, 1920px)
            return await leerComoDataUrl(await compressImage(file))
          } catch (error) {
            console.error("Error procesando imagen:", error)
            return null
          }
        })
      )
      const validas = previews.filter((p): p is string => p !== null)
      if (validas.length > 0) {
        setPendientes((prev) => [
          ...prev,
          ...validas.map((preview) => ({ id: nuevoId(), preview, descripcion: "" })),
        ])
      }

      const fallidas = files.length - validas.length
      if (fallidas > 0) {
        await showError(
          fallidas === files.length
            ? "No se pudo procesar ninguna imagen. Verificá que sean archivos de imagen válidos."
            : `${fallidas} de ${files.length} imágenes no se pudieron procesar.`
        )
      }
    } finally {
      setComprimiendo(false)
    }
  }

  const { arrastrando, zonaProps } = useZonaArchivos({ onFiles: handleFiles, deshabilitada: ocupado })

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    // Permite volver a elegir el mismo archivo.
    e.target.value = ""
    void handleFiles(files)
  }

  const handleUpload = async () => {
    if (pendientes.length === 0) {
      await showError("Primero seleccioná una imagen")
      return
    }

    const cola = pendientes
    setLoading(true)
    setProgreso(0)
    let subidas = 0
    let mensajeError: string | null = null
    try {
      // De a una: cada foto pasa por el limite del plan y el uso de storage.
      for (const foto of cola) {
        // Extraer el base64 sin el prefijo data:image/...;base64,
        const base64Match = foto.preview.match(/^data:(image\/[a-z]+);base64,(.+)$/)
        if (!base64Match) {
          mensajeError = "Formato de imagen inválido"
          break
        }

        const res = await fetch(`/api/ordenes/${ordenId}/fotos`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            data: base64Match[2],
            mime: base64Match[1],
            tipo,
            descripcion: foto.descripcion.trim() || undefined,
          }),
        })

        if (!res.ok) {
          const error = await res.json().catch(() => null)
          mensajeError = error?.error || "Error al subir la foto"
          break
        }

        subidas += 1
        setProgreso(subidas)
      }
    } catch (error) {
      console.error("Error:", error)
      mensajeError = "Error al subir la foto"
    } finally {
      setLoading(false)
    }

    if (mensajeError === null) {
      onSuccess()
      return
    }

    // Las que ya subieron salen de la lista; las demas quedan para reintentar.
    if (subidas > 0) {
      const yaSubidas = new Set(cola.slice(0, subidas).map((f) => f.id))
      setPendientes((prev) => prev.filter((f) => !yaSubidas.has(f.id)))
      onUploaded?.()
    }
    await showError(
      cola.length === 1
        ? mensajeError
        : `Se subieron ${subidas} de ${cola.length} fotos. ${mensajeError}`
    )
  }

  const quitar = (id: string) => {
    setPendientes((prev) => prev.filter((f) => f.id !== id))
  }

  const cambiarDescripcion = (id: string, descripcion: string) => {
    setPendientes((prev) => prev.map((f) => (f.id === id ? { ...f, descripcion } : f)))
  }

  const textoAyuda = arrastrando
    ? "Soltá las imágenes para agregarlas"
    : "Arrastrá las imágenes hasta acá o pegalas con Ctrl+V"

  return (
    <Card
      {...zonaProps}
      className={cn("mb-4 transition-shadow", arrastrando && "ring-2 ring-primary")}
    >
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Camera className="h-5 w-5" />
            Subir fotos
          </CardTitle>
          <IconButton label="Cerrar" variant="ghost" onClick={onClose} disabled={loading}>
            <X className="h-4 w-4" />
          </IconButton>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Botones para seleccionar imagenes */}
        <div className="flex flex-col sm:flex-row gap-2">
          {!isNativePlatform() && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleInputChange}
                className="hidden"
              />
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleInputChange}
                className="hidden"
              />
            </>
          )}
          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto sm:flex-1"
            disabled={ocupado}
            onClick={isNativePlatform() ? () => tomarNativa("Photos") : () => fileInputRef.current?.click()}
          >
            <Upload className="mr-2 h-4 w-4" />
            Seleccionar archivos
          </Button>
          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto sm:flex-1"
            disabled={ocupado}
            onClick={isNativePlatform() ? () => tomarNativa("Camera") : () => cameraInputRef.current?.click()}
          >
            <Camera className="mr-2 h-4 w-4" />
            Tomar foto
          </Button>
          {/* En la app nativa ya se está en el celular: el QR no aporta. */}
          {!isNativePlatform() && (
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto sm:flex-1"
              disabled={ocupado}
              onClick={() => setCelularAbierto(true)}
            >
              <QrCode className="mr-2 h-4 w-4" />
              Desde el celular
            </Button>
          )}
        </div>

        {/* Indicador de compresión */}
        {comprimiendo && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Comprimiendo imágenes...
          </div>
        )}

        {/* Zona para soltar (solo con mouse) mientras no hay nada elegido */}
        {pendientes.length === 0 && (
          <div
            className={cn(
              "flex-col items-center gap-1 px-4 py-8 text-center text-sm text-muted-foreground border-2 border-dashed rounded-lg transition-colors",
              "hidden [@media(hover:hover)_and_(pointer:fine)]:flex",
              arrastrando && "border-primary bg-primary/5 text-foreground"
            )}
          >
            <ImagePlus className="h-6 w-6 mb-1" aria-hidden="true" />
            <p>{textoAyuda}</p>
          </div>
        )}

        {/* Fotos elegidas */}
        {pendientes.length > 0 && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {pendientes.map((foto) => (
                <div key={foto.id} className="relative">
                  <img
                    src={foto.preview}
                    alt="Vista previa"
                    className="w-full h-28 object-cover rounded-lg border"
                  />
                  <button
                    aria-label="Quitar foto"
                    type="button"
                    disabled={loading}
                    onClick={() => quitar(foto.id)}
                    className="absolute top-1 right-1 p-1 bg-destructive text-white rounded-full disabled:opacity-50"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                  <Input
                    value={foto.descripcion}
                    onChange={(e) => cambiarDescripcion(foto.id, e.target.value)}
                    placeholder="Descripción (opcional)"
                    aria-label="Descripción de la foto"
                    disabled={loading}
                    className="mt-1 text-xs h-7"
                  />
                </div>
              ))}
            </div>
            <p className={cn("text-xs text-muted-foreground", SOLO_PC)}>
              {arrastrando
                ? textoAyuda
                : "Para sumar más, arrastrá las imágenes hasta acá o pegalas con Ctrl+V."}
            </p>
          </>
        )}

        {/* Opciones */}
        <div className="sm:max-w-xs">
          <Label htmlFor="tipo">
            {pendientes.length > 1 ? "Tipo de las fotos" : "Tipo de foto"}
          </Label>
          <Select value={tipo} onValueChange={setTipo} disabled={loading}>
            <SelectTrigger id="tipo">
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

        {/* Botones de acción */}
        <div className="flex gap-2 justify-end">
          <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={handleUpload} disabled={ocupado || pendientes.length === 0}>
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Subiendo {Math.min(progreso + 1, pendientes.length)} de {pendientes.length}...
              </>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" />
                {pendientes.length > 1 ? `Subir ${pendientes.length} fotos` : "Subir foto"}
              </>
            )}
          </Button>
        </div>
      </CardContent>

      <FotoCelularDialog
        ordenId={ordenId}
        tipo={tipo}
        open={celularAbierto}
        onOpenChange={setCelularAbierto}
        onFotos={() => onUploaded?.()}
      />
    </Card>
  )
}
