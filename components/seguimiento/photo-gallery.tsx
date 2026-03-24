"use client"

import { useState } from "react"
import { Camera, ChevronLeft, ChevronRight, X } from "lucide-react"
import { cn } from "@/lib/utils"

interface Photo {
  id: string
  url: string
  tipo: string
  descripcion: string | null
  created_at: string
}

interface PhotoGalleryProps {
  photos: {
    INGRESO: Photo[]
    REPARACION: Photo[]
    ENTREGA: Photo[]
  }
}

const tipoLabels: Record<string, string> = {
  INGRESO: "Ingreso",
  DIAGNOSTICO: "Diagnóstico",
  COMPONENTE: "Componente",
  REPARACION: "Reparación",
  ENTREGA: "Entrega",
}

const tipoColors: Record<string, string> = {
  INGRESO: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  DIAGNOSTICO: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
  COMPONENTE: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300",
  REPARACION: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  ENTREGA: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
}

export function PhotoGallery({ photos }: PhotoGalleryProps) {
  const [lightboxPhoto, setLightboxPhoto] = useState<Photo | null>(null)
  const allPhotos = [...photos.INGRESO, ...photos.REPARACION, ...photos.ENTREGA]

  if (allPhotos.length === 0) return null

  const hasBeforeAfter = photos.INGRESO.length > 0 && (photos.REPARACION.length > 0 || photos.ENTREGA.length > 0)

  return (
    <div className="space-y-4">
      <h3 className="font-semibold flex items-center gap-2">
        <Camera className="h-5 w-5" />
        Fotos del equipo
      </h3>

      {/* Before/After comparison if both available */}
      {hasBeforeAfter && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <span className={cn("text-xs font-medium px-2 py-0.5 rounded", tipoColors.INGRESO)}>
              Antes
            </span>
            <img
              src={photos.INGRESO[0].url}
              alt="Antes de la reparación"
              className="mt-2 rounded-lg w-full h-48 object-cover cursor-pointer hover:opacity-90 transition-opacity"
              onClick={() => setLightboxPhoto(photos.INGRESO[0])}
            />
          </div>
          <div>
            <span className={cn("text-xs font-medium px-2 py-0.5 rounded", photos.ENTREGA.length > 0 ? tipoColors.ENTREGA : tipoColors.REPARACION)}>
              Después
            </span>
            {(() => {
              const afterPhoto = photos.ENTREGA[0] || photos.REPARACION[0]
              return (
                <img
                  src={afterPhoto.url}
                  alt="Después de la reparación"
                  className="mt-2 rounded-lg w-full h-48 object-cover cursor-pointer hover:opacity-90 transition-opacity"
                  onClick={() => setLightboxPhoto(afterPhoto)}
                />
              )
            })()}
          </div>
        </div>
      )}

      {/* All photos by stage */}
      {(["INGRESO", "REPARACION", "ENTREGA"] as const).map((tipo) => {
        const tipoPhotos = photos[tipo]
        if (tipoPhotos.length === 0) return null

        return (
          <div key={tipo}>
            <span className={cn("text-xs font-medium px-2 py-0.5 rounded", tipoColors[tipo])}>
              {tipoLabels[tipo]}
            </span>
            <div className="grid grid-cols-3 gap-2 mt-2">
              {tipoPhotos.map((photo) => (
                <img
                  key={photo.id}
                  src={photo.url}
                  alt={photo.descripcion || tipoLabels[tipo]}
                  className="rounded-md h-24 w-full object-cover cursor-pointer hover:opacity-90 transition-opacity"
                  onClick={() => setLightboxPhoto(photo)}
                  loading="lazy"
                />
              ))}
            </div>
          </div>
        )
      })}

      {/* Lightbox */}
      {lightboxPhoto && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
          onClick={() => setLightboxPhoto(null)}
        >
          <button
            className="absolute top-4 right-4 p-2 text-white hover:bg-white/20 rounded-full"
            onClick={() => setLightboxPhoto(null)}
          >
            <X className="h-6 w-6" />
          </button>
          <img
            src={lightboxPhoto.url}
            alt={lightboxPhoto.descripcion || "Foto"}
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  )
}
