"use client"

import { useRef } from "react"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Upload, Camera, Trash2, Loader2, ImagePlus } from "lucide-react"
import { cn } from "@/lib/utils"
import { SOLO_PC, useZonaArchivos } from "@/components/fotos/use-zona-archivos"

export interface FotoPreview {
  id: string
  preview: string
  file?: File
  descripcion: string
}

interface FotosIngresoProps {
  label: string
  fotos: FotoPreview[]
  comprimiendo: boolean
  /** Recibe los archivos elegidos, arrastrados o pegados. El padre los
   *  valida y comprime; aca no se filtra nada salvo en el pegado. */
  onFiles: (files: File[]) => void
  onRemove: (id: string) => void
  onDescripcionChange: (id: string, value: string) => void
}

const SOLO_PC_PADDING = "[@media(hover:hover)_and_(pointer:fine)]:py-8"

export function FotosIngreso({
  label,
  fotos,
  comprimiendo,
  onFiles,
  onRemove,
  onDescripcionChange,
}: FotosIngresoProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const { arrastrando, zonaProps } = useZonaArchivos({ onFiles, deshabilitada: comprimiendo })

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    // Permite volver a elegir el mismo archivo.
    e.target.value = ""
    if (files.length > 0) onFiles(files)
  }

  return (
    <div
      {...zonaProps}
      className={cn(
        "relative rounded-lg transition-shadow",
        arrastrando && "ring-2 ring-primary ring-offset-4 ring-offset-background"
      )}
    >
      <Label>{label}</Label>
      <div className="mt-2 space-y-3">
        <div className="flex flex-col sm:flex-row gap-2">
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
          <Button
            type="button"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            className="w-full sm:w-auto sm:flex-1"
            disabled={comprimiendo}
          >
            <Upload className="mr-2 h-4 w-4" />
            Seleccionar archivos
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => cameraInputRef.current?.click()}
            className="w-full sm:w-auto sm:flex-1"
            disabled={comprimiendo}
          >
            <Camera className="mr-2 h-4 w-4" />
            Tomar foto
          </Button>
        </div>

        {comprimiendo && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Comprimiendo imágenes...
          </div>
        )}

        {fotos.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {fotos.map((foto) => (
              <div key={foto.id} className="relative group">
                <img
                  src={foto.preview}
                  alt="Vista previa"
                  className="w-full h-24 object-cover rounded-lg border"
                />
                <button aria-label="Eliminar foto"
                  type="button"
                  onClick={() => onRemove(foto.id)}
                  className="absolute top-1 right-1 p-1 bg-destructive text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
                <Input
                  value={foto.descripcion}
                  onChange={(e) => onDescripcionChange(foto.id, e.target.value)}
                  placeholder="Descripción..."
                  className="mt-1 text-xs h-7"
                />
              </div>
            ))}
          </div>
        )}

        {fotos.length === 0 && (
          <div
            className={cn(
              "flex flex-col items-center gap-1 px-4 py-4 text-center text-sm text-muted-foreground border-2 border-dashed rounded-lg transition-colors",
              SOLO_PC_PADDING,
              arrastrando && "border-primary bg-primary/5 text-foreground"
            )}
          >
            <ImagePlus className={cn("h-6 w-6 mb-1", SOLO_PC)} aria-hidden="true" />
            <p>Agregar fotos del estado inicial del equipo</p>
            <p className={cn("text-xs", SOLO_PC)}>
              {arrastrando
                ? "Soltá las imágenes para agregarlas"
                : "Arrastrá las imágenes hasta acá o pegalas con Ctrl+V"}
            </p>
          </div>
        )}

        {fotos.length > 0 && (
          <p className={cn("text-xs text-muted-foreground", SOLO_PC)}>
            {arrastrando
              ? "Soltá las imágenes para agregarlas"
              : "Para sumar más, arrastrá las imágenes hasta acá o pegalas con Ctrl+V."}
          </p>
        )}
      </div>
    </div>
  )
}
