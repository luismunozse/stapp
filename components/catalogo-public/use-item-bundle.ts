"use client"

import { useEffect, useState } from "react"

interface BundleItemRaw {
  id: string
  tipo: "PRODUCTO" | "SERVICIO"
  nombre: string
  precio: number | null
  precio_lista?: number | null
  imagen_url: string | null
  stock_disponible: number | null
}

interface BundleItemShaped {
  id: string
  tipo: "PRODUCTO" | "SERVICIO"
  nombre: string
  descripcion: string | null
  categoria_id: string | null
  precio: number | null
  precio_hasta: number | null
  precio_lista: number | null
  imagen_url: string | null
  imagenes: string[]
  etiquetas: string[]
  stock_disponible: number | null
  destacado: boolean
}

/**
 * Carga "comprados juntos" del backend cuando el dialog se abre. Si encuentra
 * el item en `existingItems` (data ya hidratada por SSR / página principal),
 * reusa esa instancia; sino arma un shape mínimo desde la respuesta del API.
 *
 * Extraído de item-detail-dialog para reuso y testeo.
 */
export function useItemBundle(
  slug: string,
  itemId: string | null,
  open: boolean,
  existingItems: BundleItemShaped[]
): BundleItemShaped[] {
  const [bundle, setBundle] = useState<BundleItemShaped[]>([])

  useEffect(() => {
    if (!open || !itemId) {
      setBundle([])
      return
    }
    const ac = new AbortController()
    fetch(`/api/public/catalogo/${slug}/items/${itemId}/bundle`, { signal: ac.signal })
      .then((r) => r.json())
      .then((data) => {
        const shaped: BundleItemShaped[] = (data.items ?? []).map((b: BundleItemRaw) => {
          const existing = existingItems.find((i) => i.id === b.id)
          return (
            existing ?? {
              id: b.id,
              tipo: b.tipo,
              nombre: b.nombre,
              descripcion: null,
              categoria_id: null,
              precio: b.precio,
              precio_hasta: null,
              precio_lista: b.precio_lista ?? null,
              imagen_url: b.imagen_url,
              imagenes: [],
              etiquetas: [],
              stock_disponible: b.stock_disponible,
              destacado: false,
            }
          )
        })
        setBundle(shaped)
      })
      .catch(() => setBundle([]))
    return () => ac.abort()
  }, [open, itemId, slug, existingItems])

  return bundle
}
