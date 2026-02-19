"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Camera,
  Plus,
  Trash2,
  X,
  ChevronLeft,
  ChevronRight,
  Download,
  Maximize2,
  Package,
  Wrench,
  CheckCircle,
  Search,
  Cpu,
} from "lucide-react"
import { FotoUpload } from "./foto-upload"
import { useModal } from "@/contexts/modal-context"
import { useCurrency } from "@/contexts/currency-context"

interface Foto {
  id: string
  url: string
  mime: string
  descripcion: string | null
  tipo: string
  createdAt: string
}

interface FotoGalleryProps {
  ordenId: string
}

const tipoConfig: Record<string, { label: string; icon: typeof Package; color: string }> = {
  INGRESO: { label: "Ingreso", icon: Package, color: "bg-blue-100 text-blue-800" },
  DIAGNOSTICO: { label: "Diagnóstico", icon: Search, color: "bg-purple-100 text-purple-800" },
  COMPONENTE: { label: "Componente", icon: Cpu, color: "bg-orange-100 text-orange-800" },
  REPARACION: { label: "Reparación", icon: Wrench, color: "bg-yellow-100 text-yellow-800" },
  ENTREGA: { label: "Entrega", icon: CheckCircle, color: "bg-green-100 text-green-800" },
}

export function FotoGallery({ ordenId }: FotoGalleryProps) {
  const [fotos, setFotos] = useState<Foto[]>([])
  const [loading, setLoading] = useState(true)
  const [showUpload, setShowUpload] = useState(false)
  const [selectedFoto, setSelectedFoto] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const { confirm, showError } = useModal()
  const { formatDate } = useCurrency()

  const fetchFotos = async () => {
    try {
      const res = await fetch(`/api/ordenes/${ordenId}/fotos`)
      const data = await res.json()
      setFotos(data)
    } catch (error) {
      console.error("Error fetching fotos:", error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchFotos()
  }, [ordenId])

  const openViewer = (fotoId: string) => {
    setSelectedFoto(fotoId)
  }

  const closeViewer = () => {
    setSelectedFoto(null)
  }

  const navigateFoto = (direction: "prev" | "next") => {
    if (!selectedFoto) return
    const currentIndex = fotos.findIndex((f) => f.id === selectedFoto)
    let newIndex: number

    if (direction === "prev") {
      newIndex = currentIndex > 0 ? currentIndex - 1 : fotos.length - 1
    } else {
      newIndex = currentIndex < fotos.length - 1 ? currentIndex + 1 : 0
    }

    setSelectedFoto(fotos[newIndex].id)
  }

  const handleDelete = async (fotoId: string) => {
    const confirmed = await confirm({
      title: "Eliminar Foto",
      description: "¿Estás seguro de eliminar esta foto? Esta acción no se puede deshacer.",
      confirmText: "Eliminar",
      cancelText: "Cancelar",
      variant: "danger",
    })

    if (!confirmed) return

    setDeleting(fotoId)
    try {
      const res = await fetch(`/api/ordenes/${ordenId}/fotos?fotoId=${fotoId}`, {
        method: "DELETE",
      })

      if (res.ok) {
        if (selectedFoto === fotoId) closeViewer()
        fetchFotos()
      } else {
        await showError("Error al eliminar la foto")
      }
    } catch (error) {
      console.error("Error:", error)
      await showError("Error al eliminar la foto")
    } finally {
      setDeleting(null)
    }
  }

  const downloadFoto = async () => {
    if (!selectedFoto) return
    const foto = fotos.find((f) => f.id === selectedFoto)
    if (!foto) return

    try {
      const response = await fetch(foto.url)
      const blob = await response.blob()
      const link = document.createElement("a")
      link.href = URL.createObjectURL(blob)
      link.download = `foto-${foto.tipo.toLowerCase()}-${new Date(foto.createdAt).getTime()}.${foto.mime.split("/")[1]}`
      link.click()
      URL.revokeObjectURL(link.href)
    } catch (error) {
      console.error("Error downloading foto:", error)
    }
  }

  // Agrupar fotos por tipo
  const fotosPorTipo = fotos.reduce((acc, foto) => {
    if (!acc[foto.tipo]) acc[foto.tipo] = []
    acc[foto.tipo].push(foto)
    return acc
  }, {} as Record<string, Foto[]>)

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Camera className="h-5 w-5" />
              Fotos del Equipo ({fotos.length})
            </CardTitle>
            {!showUpload && (
              <Button size="sm" onClick={() => setShowUpload(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Agregar Foto
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {showUpload && (
            <FotoUpload
              ordenId={ordenId}
              onClose={() => setShowUpload(false)}
              onSuccess={() => {
                setShowUpload(false)
                fetchFotos()
              }}
            />
          )}

          {loading ? (
            <p className="text-center text-muted-foreground py-4">Cargando...</p>
          ) : fotos.length === 0 ? (
            <p className="text-center text-muted-foreground py-4">
              No hay fotos registradas para esta orden
            </p>
          ) : (
            <div className="space-y-4">
              {Object.entries(fotosPorTipo).map(([tipo, fotosDelTipo]) => {
                const config = tipoConfig[tipo] || tipoConfig.REPARACION
                const Icon = config.icon

                return (
                  <div key={tipo}>
                    <div className="flex items-center gap-2 mb-2">
                      <Badge className={config.color}>
                        <Icon className="mr-1 h-3 w-3" />
                        {config.label}
                      </Badge>
                      <span className="text-sm text-muted-foreground">
                        ({fotosDelTipo.length} foto{fotosDelTipo.length > 1 ? "s" : ""})
                      </span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
                      {fotosDelTipo.map((foto) => (
                        <div
                          key={foto.id}
                          role="button"
                          tabIndex={0}
                          className="relative group aspect-square bg-muted rounded-lg overflow-hidden cursor-pointer border hover:border-primary transition-colors"
                          onClick={() => openViewer(foto.id)}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openViewer(foto.id); } }}
                        >
                          {foto.url ? (
                            <img
                              src={foto.url}
                              alt={foto.descripcion || "Foto del equipo"}
                              className="absolute inset-0 w-full h-full object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <div className="absolute inset-0 flex items-center justify-center">
                              <Camera className="h-8 w-8 text-muted-foreground" />
                            </div>
                          )}
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                            <Maximize2 className="h-6 w-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>
                          {foto.descripcion && (
                            <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs p-1 truncate">
                              {foto.descripcion}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Visor de imagen a pantalla completa */}
      {selectedFoto && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center">
          <div className="absolute top-4 right-4 flex gap-2">
            <Button variant="ghost" size="icon" onClick={downloadFoto} className="text-white hover:bg-white/20">
              <Download className="h-5 w-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => handleDelete(selectedFoto)}
              disabled={deleting === selectedFoto}
              className="text-white hover:bg-red-500/50"
            >
              <Trash2 className="h-5 w-5" />
            </Button>
            <Button variant="ghost" size="icon" onClick={closeViewer} className="text-white hover:bg-white/20">
              <X className="h-5 w-5" />
            </Button>
          </div>

          {fotos.length > 1 && (
            <>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigateFoto("prev")}
                className="absolute left-4 text-white hover:bg-white/20"
              >
                <ChevronLeft className="h-8 w-8" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigateFoto("next")}
                className="absolute right-4 text-white hover:bg-white/20"
              >
                <ChevronRight className="h-8 w-8" />
              </Button>
            </>
          )}

          <div className="max-w-4xl max-h-[80vh] p-4">
            {(() => {
              const foto = fotos.find((f) => f.id === selectedFoto)
              if (!foto) return null
              return (
                <img
                  src={foto.url}
                  alt={foto.descripcion || "Foto del equipo"}
                  className="max-w-full max-h-[80vh] object-contain rounded-lg"
                />
              )
            })()}
          </div>

          {/* Info de la foto */}
          {selectedFoto && (
            <div className="absolute bottom-4 left-4 right-4 text-white text-center">
              {(() => {
                const foto = fotos.find((f) => f.id === selectedFoto)
                if (!foto) return null
                const config = tipoConfig[foto.tipo]
                return (
                  <div className="space-y-1">
                    <Badge className={config?.color}>
                      {config?.label || foto.tipo}
                    </Badge>
                    {foto.descripcion && (
                      <p className="text-sm">{foto.descripcion}</p>
                    )}
                    <p className="text-xs text-gray-400">
                      {formatDate(foto.createdAt)}
                    </p>
                  </div>
                )
              })()}
            </div>
          )}
        </div>
      )}
    </>
  )
}
