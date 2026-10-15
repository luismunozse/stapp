"use client"

import { useState } from "react"
import { Package } from "lucide-react"
import { cn } from "@/lib/utils"

interface Props {
  /** Label of the row, e.g. "Azul / M". Names the photo for screen readers. */
  etiqueta: string
  /** The row's own photo. */
  imagenUrl?: string | null
  /** A sibling's photo, shown (dimmed) only when the row has none of its own. */
  imagenRespaldo?: { url: string; etiqueta: string } | null
  className?: string
}

const TAMANO = 44

/**
 * Fixed 44px thumbnail of one row of the POS variants sheet. The box never changes size, so a
 * slow or broken image cannot shift the rows. A failed image shows the placeholder and never
 * blocks the row.
 */
export function PosVarianteMiniatura({ etiqueta, imagenUrl, imagenRespaldo, className }: Props) {
  const propia = imagenUrl || null
  const prestada = propia ? null : imagenRespaldo?.url || null
  const src = propia ?? prestada
  // Remember WHICH url failed, so a new photo on the same row is tried again.
  const [fallida, setFallida] = useState<string | null>(null)
  const caja = cn("relative size-11 shrink-0 overflow-hidden rounded-md bg-muted", className)

  if (!src || fallida === src) {
    return (
      <span className={cn(caja, "flex items-center justify-center text-muted-foreground")} data-testid="variante-sin-foto">
        <Package className="size-5" aria-hidden="true" />
      </span>
    )
  }

  return (
    <span className={caja}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={propia ? etiqueta : ""}
        width={TAMANO}
        height={TAMANO}
        loading="lazy"
        decoding="async"
        onError={() => setFallida(src)}
        className={cn("size-full object-cover", prestada && "opacity-60")}
      />
      {prestada && imagenRespaldo ? <span className="sr-only">{`Foto de ${imagenRespaldo.etiqueta}`}</span> : null}
    </span>
  )
}
