"use client"

import { useRef } from "react"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Upload, Camera, Trash2, Loader2 } from "lucide-react"

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
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  onRemove: (id: string) => void
  onDescripcionChange: (id: string, value: string) => void
}

export function FotosIngreso({
  label,
  fotos,
  comprimiendo,
  onFileChange,
  onRemove,
  onDescripcionChange,
}: FotosIngresoProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)

  return (
    <div>
      <Label>{label}</Label>
      <div className="mt-2 space-y-3">
        <div className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={onFileChange}
            className="hidden"
          />
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={onFileChange}
            className="hidden"
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            className="flex-1"
            disabled={comprimiendo}
          >
            <Upload className="mr-2 h-4 w-4" />
            Seleccionar archivos
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => cameraInputRef.current?.click()}
            className="flex-1"
            disabled={comprimiendo}
          >
            <Camera className="mr-2 h-4 w-4" />
            Tomar foto
          </Button>
        </div>

        {comprimiendo && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Comprimiendo imagenes...
          </div>
        )}

        {fotos.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {fotos.map((foto) => (
              <div key={foto.id} className="relative group">
                <img
                  src={foto.preview}
                  alt="Preview"
                  className="w-full h-24 object-cover rounded-lg border"
                />
                <button
                  type="button"
                  onClick={() => onRemove(foto.id)}
                  className="absolute top-1 right-1 p-1 bg-destructive text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
                <Input
                  value={foto.descripcion}
                  onChange={(e) => onDescripcionChange(foto.id, e.target.value)}
                  placeholder="Descripcion..."
                  className="mt-1 text-xs h-7"
                />
              </div>
            ))}
          </div>
        )}

        {fotos.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4 border-2 border-dashed rounded-lg">
            Agregar fotos del estado inicial del equipo
          </p>
        )}
      </div>
    </div>
  )
}
