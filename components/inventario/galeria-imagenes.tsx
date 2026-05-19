"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ImagePlus, Loader2, Star, Trash2, Package, ArrowUp, ArrowDown } from "lucide-react"
import { compressImage } from "@/lib/image-compression"

interface Imagen {
  id: string
  url: string
  path: string
  orden: number
  esPrincipal: boolean
  alt: string | null
  createdAt: string
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  inventarioId: string
  inventarioNombre: string
  onChange?: () => void
}

const MAX_IMAGES = 10

export function GaleriaImagenes({ open, onOpenChange, inventarioId, inventarioNombre, onChange }: Props) {
  const [imagenes, setImagenes] = useState<Imagen[]>([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string>("")
  const fileInputRef = useRef<HTMLInputElement>(null)

  const refetch = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/inventario/${inventarioId}/imagenes`)
      const json = await res.json()
      setImagenes(json.data || [])
    } finally {
      setLoading(false)
    }
  }, [inventarioId])

  useEffect(() => {
    if (open) refetch()
  }, [open, refetch])

  const handleUpload = async (file: File) => {
    setError("")
    if (imagenes.length >= MAX_IMAGES) {
      setError(`Máximo ${MAX_IMAGES} imágenes`)
      return
    }
    setUploading(true)
    try {
      const compressed = await compressImage(file).catch(() => file)
      const form = new FormData()
      form.append("file", compressed)
      const res = await fetch(`/api/inventario/${inventarioId}/imagenes`, {
        method: "POST",
        body: form,
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || "Error al subir")
      }
      await refetch()
      onChange?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al subir imagen")
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  const setPrincipal = async (img: Imagen) => {
    if (img.esPrincipal) return
    setBusyId(img.id)
    try {
      const res = await fetch(`/api/inventario/${inventarioId}/imagenes/${img.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ esPrincipal: true }),
      })
      if (res.ok) {
        await refetch()
        onChange?.()
      }
    } finally {
      setBusyId(null)
    }
  }

  const reordenar = async (img: Imagen, delta: number) => {
    const sorted = [...imagenes].sort((a, b) => a.orden - b.orden)
    const idx = sorted.findIndex((i) => i.id === img.id)
    const newIdx = idx + delta
    if (newIdx < 0 || newIdx >= sorted.length) return
    const other = sorted[newIdx]
    setBusyId(img.id)
    try {
      await Promise.all([
        fetch(`/api/inventario/${inventarioId}/imagenes/${img.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orden: other.orden }),
        }),
        fetch(`/api/inventario/${inventarioId}/imagenes/${other.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orden: img.orden }),
        }),
      ])
      await refetch()
    } finally {
      setBusyId(null)
    }
  }

  const eliminar = async (img: Imagen) => {
    if (!confirm("¿Eliminar esta imagen?")) return
    setBusyId(img.id)
    try {
      const res = await fetch(`/api/inventario/${inventarioId}/imagenes/${img.id}`, {
        method: "DELETE",
      })
      if (res.ok) {
        await refetch()
        onChange?.()
      }
    } finally {
      setBusyId(null)
    }
  }

  const sorted = [...imagenes].sort((a, b) => a.orden - b.orden)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-4 w-4" />
            Galería de imágenes
          </DialogTitle>
          <p className="text-xs text-muted-foreground truncate">{inventarioNombre}</p>
        </DialogHeader>

        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="text-xs text-muted-foreground">
            {imagenes.length} / {MAX_IMAGES} imágenes
          </div>
          <Button
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || imagenes.length >= MAX_IMAGES}
          >
            {uploading ? (
              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
            ) : (
              <ImagePlus className="h-3.5 w-3.5 mr-1" />
            )}
            Subir imagen
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) handleUpload(f)
            }}
          />
        </div>

        {error && (
          <div className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2 mb-2">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : sorted.length === 0 ? (
          <div className="border-2 border-dashed rounded-lg py-12 text-center text-sm text-muted-foreground">
            Sin imágenes. Subí la primera para empezar.
          </div>
        ) : (
          <div className="overflow-y-auto flex-1 -mx-6 px-6">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {sorted.map((img, idx) => {
                const busy = busyId === img.id
                return (
                  <div
                    key={img.id}
                    className={`relative rounded-lg overflow-hidden border ${img.esPrincipal ? "border-amber-500 ring-2 ring-amber-500/30" : ""}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={img.url}
                      alt={img.alt || ""}
                      className="w-full aspect-square object-cover"
                      loading="lazy"
                    />
                    {img.esPrincipal && (
                      <Badge className="absolute top-1 left-1 gap-1 bg-amber-500 hover:bg-amber-500 text-white">
                        <Star className="h-3 w-3" /> Principal
                      </Badge>
                    )}
                    {busy && (
                      <div className="absolute inset-0 bg-background/60 flex items-center justify-center">
                        <Loader2 className="h-5 w-5 animate-spin" />
                      </div>
                    )}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-1.5 flex items-center justify-between gap-1">
                      <div className="flex items-center gap-0.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-white hover:bg-white/20"
                          onClick={() => reordenar(img, -1)}
                          disabled={busy || idx === 0}
                          title="Mover arriba"
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-white hover:bg-white/20"
                          onClick={() => reordenar(img, 1)}
                          disabled={busy || idx === sorted.length - 1}
                          title="Mover abajo"
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <div className="flex items-center gap-0.5">
                        {!img.esPrincipal && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-white hover:bg-white/20"
                            onClick={() => setPrincipal(img)}
                            disabled={busy}
                            title="Marcar como principal"
                          >
                            <Star className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-white hover:bg-red-500"
                          onClick={() => eliminar(img)}
                          disabled={busy}
                          title="Eliminar"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
