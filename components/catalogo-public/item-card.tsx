"use client"

import Image from "next/image"
import { motion } from "framer-motion"
import { Plus, Star, Check, Heart, Eye, Flame } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { useState } from "react"
import { CatalogoImagePlaceholder } from "./catalogo-image-placeholder"

interface Item {
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
  vistas_semana?: number
}

interface Props {
  item: Item
  onClick: () => void
  onQuickAdd: () => void
  formatPrecio: (n: number) => string
  brandColor: string
  isFav?: boolean
  onToggleFav?: () => void
  // priority=true en las primeras cards above-the-fold para LCP. Cargar
  // como high-priority evita que la imagen de hero/grid sea el LCP demorado.
  priority?: boolean
}

export function ItemCard({ item, onClick, onQuickAdd, formatPrecio, brandColor, isFav, onToggleFav, priority }: Props) {
  const [added, setAdded] = useState(false)
  const agotado = item.stock_disponible === 0
  const sinPrecio = item.precio == null
  const canQuickAdd = !sinPrecio && !agotado
  const stockBajo =
    item.stock_disponible != null && item.stock_disponible > 0 && item.stock_disponible <= 5
  const tieneAnchor =
    !sinPrecio && item.precio_lista != null && Number(item.precio_lista) > Number(item.precio)
  const pctDescuento = tieneAnchor
    ? Math.round((1 - Number(item.precio) / Number(item.precio_lista!)) * 100)
    : 0

  const handleQuickAdd = (e: React.MouseEvent) => {
    e.stopPropagation()
    onQuickAdd()
    setAdded(true)
    setTimeout(() => setAdded(false), 1200)
  }

  return (
    <motion.div
      layout
      variants={{
        hidden: { opacity: 0, y: 10 },
        visible: { opacity: 1, y: 0 },
      }}
      whileHover={{ y: -3 }}
      className={`group relative rounded-cat bg-cat-surface shadow-cat overflow-hidden transition-all duration-200 hover:shadow-cat-lg ${
        agotado ? "opacity-60" : ""
      }`}
    >
      {/* Wrapper accesible con role=button: evita HTML inválido por
          botones anidados (el quick-add y el de favoritos viven adentro).
          Click + Enter/Space disparan onClick. */}
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            onClick()
          }
        }}
        aria-label={item.nombre}
        className="block w-full text-left cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-current"
      >
        <div className="p-2.5 pb-0">
        <div className="aspect-square bg-cat-chip relative overflow-hidden rounded-cat-inner">
          {item.imagen_url ? (
            <Image
              src={item.imagen_url}
              alt={item.nombre}
              fill
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
              priority={priority}
              className="object-cover transition-transform duration-300 group-hover:scale-[1.04]"
            />
          ) : (
            <CatalogoImagePlaceholder name={item.nombre} className="w-full h-full" />
          )}

          {/* Badges esquina superior izquierda — máx 1 visible para no saturar */}
          <div className="absolute top-2 left-2 flex flex-col gap-1 items-start pointer-events-none">
            {item.destacado ? (
              <Badge className="gap-1 border-0 bg-orange-100 text-orange-800 shadow-sm font-bold font-display">
                <Star className="h-3 w-3 fill-current" />
                Destacado
              </Badge>
            ) : (item.vistas_semana ?? 0) >= 5 ? (
              <Badge variant="secondary" className="gap-1 border-0 bg-white/90 text-cat-ink backdrop-blur shadow-sm text-[10px] font-semibold">
                <Eye className="h-3 w-3" />
                {item.vistas_semana} vieron
              </Badge>
            ) : null}

            {tieneAnchor && pctDescuento > 0 && (
              <Badge className="gap-0.5 border-0 bg-green-100 text-green-800 text-[10px] font-bold shadow-sm">
                -{pctDescuento}%
              </Badge>
            )}

            {stockBajo && !agotado && (
              <Badge variant="secondary" className="gap-1 border-0 bg-orange-100 text-orange-800 text-[10px] font-semibold shadow-sm">
                <Flame className="h-3 w-3" />
                Últimas {item.stock_disponible}
              </Badge>
            )}
          </div>

          {/* Favorito — siempre visible en mobile, hover en desktop */}
          {onToggleFav && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                e.preventDefault()
                onToggleFav()
              }}
              className={`absolute top-2 right-2 h-11 w-11 sm:h-9 sm:w-9 rounded-full backdrop-blur flex items-center justify-center transition-all active:scale-90 ${
                isFav
                  ? "bg-white/95 text-rose-500 shadow"
                  : "bg-white/80 text-cat-muted sm:opacity-0 sm:group-hover:opacity-100 hover:text-rose-500 shadow-sm"
              }`}
              aria-label={isFav ? "Quitar de favoritos" : "Agregar a favoritos"}
            >
              <Heart className={`h-4 w-4 transition-transform ${isFav ? "fill-current scale-110" : ""}`} />
            </button>
          )}

          {agotado && (
            <div className="absolute inset-0 bg-white/60 backdrop-blur-[1px] flex items-center justify-center">
              <Badge variant="secondary" className="text-base shadow">Agotado</Badge>
            </div>
          )}
        </div>
        </div>

        <div className="p-3 pt-2.5 space-y-1">
          <h3 className="font-medium text-sm text-cat-ink line-clamp-2 min-h-[2.5rem] leading-snug">
            {item.nombre}
          </h3>
          {item.descripcion && (
            <p className="text-[11px] text-cat-muted line-clamp-1 leading-tight">
              {item.descripcion}
            </p>
          )}
          <div className="flex items-baseline gap-1.5 flex-wrap min-h-[1.5rem]">
            {sinPrecio ? (
              <span className="text-sm font-normal text-cat-muted italic">Consultar precio</span>
            ) : (
              <>
                <span className="font-display text-lg font-extrabold tracking-tight text-cat-ink leading-none">
                  {item.precio_hasta != null
                    ? `Desde ${formatPrecio(Number(item.precio))}`
                    : formatPrecio(Number(item.precio))}
                </span>
                {tieneAnchor && (
                  <span className="text-xs text-cat-muted line-through leading-none">
                    {formatPrecio(Number(item.precio_lista))}
                  </span>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Quick-add: visible siempre en mobile, hover en desktop */}
      {canQuickAdd && (
        <button
          onClick={handleQuickAdd}
          className="absolute bottom-3 right-3 h-11 w-11 sm:h-10 sm:w-10 rounded-full bg-brand text-brand-foreground shadow-brand flex items-center justify-center transition-all sm:opacity-0 sm:group-hover:opacity-100 hover:scale-110 active:scale-95 z-10"
          aria-label={`Agregar ${item.nombre}`}
        >
          {added ? <Check className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
        </button>
      )}
    </motion.div>
  )
}
