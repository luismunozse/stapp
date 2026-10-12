"use client"

import { Star } from "lucide-react"

export interface Variante {
  id: string
  etiqueta: string
  sku: string | null
  precio: number | null
  stock: number | null
  imagen_url: string | null
}

interface Props {
  variantes: Variante[]
  varianteId: string | null
  onSelect: (id: string) => void
  topVarianteId?: string | null
  brandColor: string
}

export function VariantPicker({ variantes, varianteId, onSelect, topVarianteId, brandColor }: Props) {
  const varianteSel = variantes.find((v) => v.id === varianteId) ?? null
  return (
    <div>
      <div className="text-xs font-medium mb-2">
        Variante: {varianteSel ? <span className="text-foreground">{varianteSel.etiqueta}</span> : <span className="text-destructive">elegí una opción</span>}
      </div>
      <div className="flex flex-wrap gap-2">
        {variantes.map((v) => {
          const sinStock = v.stock === 0
          const active = v.id === varianteId
          const esTop = topVarianteId === v.id
          return (
            <button
              key={v.id}
              type="button"
              onClick={() => !sinStock && onSelect(v.id)}
              disabled={sinStock}
              className={`inline-flex items-center gap-1.5 px-3 py-2 min-h-[40px] rounded-lg text-xs font-medium border transition-all active:scale-95 ${
                active
                  ? "text-white shadow-sm"
                  : sinStock
                    ? "bg-muted text-muted-foreground line-through"
                    : "bg-background hover:bg-muted hover:border-foreground/20"
              }`}
              style={active ? { backgroundColor: brandColor, borderColor: brandColor } : undefined}
              title={sinStock ? "Sin stock" : esTop ? "La más elegida" : undefined}
            >
              <span>{v.etiqueta}</span>
              {esTop && !sinStock && (
                <span
                  className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold leading-none ${
                    active
                      ? "bg-white/25 text-white"
                      : "bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300"
                  }`}
                  aria-label="La más elegida"
                >
                  <Star className="h-2.5 w-2.5 fill-current" />
                  TOP
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
