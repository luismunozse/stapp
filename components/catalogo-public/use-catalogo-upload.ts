"use client"

import { useCallback, useState } from "react"
import { toast } from "sonner"

const MAX_BYTES = 4 * 1024 * 1024

/**
 * Hook que encapsula upload de fotos al endpoint público del catálogo.
 * Devuelve la URL absoluta servida por Supabase Storage.
 *
 * Extraído de cart-drawer.tsx para que el componente principal no maneje
 * fetch + estado loading + validación de tamaño. El backend valida magic
 * bytes (ver app/api/public/catalogo/[slug]/upload/route.ts).
 */
export function useCatalogoUpload(slug: string) {
  const [uploadingItem, setUploadingItem] = useState<string | null>(null)

  const upload = useCallback(
    async (itemId: string, file: File): Promise<string | null> => {
      if (file.size > MAX_BYTES) {
        toast.error("La foto supera 4MB")
        return null
      }
      setUploadingItem(itemId)
      try {
        const fd = new FormData()
        fd.append("file", file)
        const res = await fetch(`/api/public/catalogo/${slug}/upload`, {
          method: "POST",
          body: fd,
        })
        const data = await res.json().catch(() => ({ error: "Respuesta inválida" }))
        if (!res.ok) throw new Error(data.error || "Error subiendo foto")
        return data.url as string
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Error subiendo foto")
        return null
      } finally {
        setUploadingItem(null)
      }
    },
    [slug]
  )

  return { upload, uploadingItem }
}
