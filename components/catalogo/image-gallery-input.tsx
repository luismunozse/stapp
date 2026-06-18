"use client"

import { useRef } from "react"
import { Upload, Loader2, X, Star } from "lucide-react"
import { addImage, setCover, removeCover, removeFromGallery, type Gallery } from "@/lib/catalogo/gallery"

interface ImageGalleryInputProps {
  cover: string | null
  gallery: string[]
  onChange: (next: Gallery) => void
  onUpload: (file: File) => Promise<string>
  uploading?: boolean
}

export function ImageGalleryInput({ cover, gallery, onChange, onUpload, uploading }: ImageGalleryInputProps) {
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFiles = async (files: FileList) => {
    let next: Gallery = { cover, gallery }
    for (const file of Array.from(files)) {
      try {
        const url = await onUpload(file)
        next = addImage(next, url)
      } catch {
        // onUpload surfaces its own error toast; skip this file
      }
    }
    onChange(next)
  }

  const items: { url: string; isCover: boolean }[] = [
    ...(cover ? [{ url: cover, isCover: true }] : []),
    ...gallery.map((url) => ({ url, isCover: false })),
  ]

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {items.map(({ url, isCover }) => (
          <div key={url} className="relative aspect-square rounded-md overflow-hidden border bg-muted group">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt="Imagen del producto" className="w-full h-full object-cover" />
            {isCover && (
              <span className="absolute top-1 left-1 inline-flex items-center gap-0.5 rounded bg-background/90 px-1 py-0.5 text-[10px] font-medium">
                <Star className="h-2.5 w-2.5 fill-current text-amber-500" />
                Portada
              </span>
            )}
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-background/80 p-1 opacity-0 group-hover:opacity-100 transition-opacity">
              {!isCover ? (
                <button
                  type="button"
                  aria-label="Hacer portada"
                  onClick={() => onChange(setCover({ cover, gallery }, url))}
                  className="text-[10px] hover:underline"
                >
                  <Star className="h-3 w-3" aria-hidden="true" />
                </button>
              ) : (
                <span className="text-[10px] text-muted-foreground">Principal</span>
              )}
              <button
                type="button"
                aria-label={isCover ? "Quitar portada" : "Quitar imagen"}
                onClick={() => onChange(isCover ? removeCover({ cover, gallery }) : removeFromGallery({ cover, gallery }, url))}
                className="text-destructive"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="aspect-square rounded-md border border-dashed flex flex-col items-center justify-center gap-1 text-muted-foreground hover:bg-muted/50 disabled:opacity-50"
        >
          {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
          <span className="text-[10px]">Subir</span>
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) handleFiles(e.target.files)
          e.target.value = ""
        }}
      />
      <p className="text-[11px] text-muted-foreground">
        La primera imagen es la principal. Pasá el mouse para cambiarla o quitarla. JPG/PNG/WEBP ≤4MB.
      </p>
    </div>
  )
}
