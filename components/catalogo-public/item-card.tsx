"use client"

import Image from "next/image"
import { motion } from "framer-motion"
import { Plus, Star, Check, Heart } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { useState } from "react"

interface Item {
  id: string
  tipo: "PRODUCTO" | "SERVICIO"
  nombre: string
  descripcion: string | null
  categoria_id: string | null
  precio: number | null
  precio_hasta: number | null
  imagen_url: string | null
  imagenes: string[]
  etiquetas: string[]
  stock_disponible: number | null
  destacado: boolean
}

interface Props {
  item: Item
  onClick: () => void
  onQuickAdd: () => void
  formatPrecio: (n: number) => string
  brandColor: string
  isFav?: boolean
  onToggleFav?: () => void
}

export function ItemCard({ item, onClick, onQuickAdd, formatPrecio, brandColor, isFav, onToggleFav }: Props) {
  const [added, setAdded] = useState(false)
  const agotado = item.stock_disponible === 0
  const sinPrecio = item.precio == null
  const canQuickAdd = !sinPrecio && !agotado

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
      whileHover={{ y: -2 }}
      className={`group relative rounded-xl border bg-card overflow-hidden transition-shadow hover:shadow-lg ${
        agotado ? "opacity-60" : ""
      }`}
    >
      <button onClick={onClick} className="block w-full text-left">
        <div className="aspect-square bg-muted relative">
          {item.imagen_url ? (
            <Image
              src={item.imagen_url}
              alt={item.nombre}
              fill
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
              className="object-cover transition-transform group-hover:scale-105"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-3xl text-muted-foreground">
              {item.tipo === "PRODUCTO" ? "📦" : "🛠️"}
            </div>
          )}
          {item.destacado && (
            <Badge
              className="absolute top-2 left-2 gap-1 border-0 text-white shadow"
              style={{ backgroundColor: brandColor }}
            >
              <Star className="h-3 w-3 fill-current" />
              Destacado
            </Badge>
          )}
          {onToggleFav && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                e.preventDefault()
                onToggleFav()
              }}
              className={`absolute top-2 right-2 h-8 w-8 rounded-full backdrop-blur flex items-center justify-center transition-all ${
                isFav
                  ? "bg-white/95 text-rose-500"
                  : "bg-background/70 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-rose-500"
              }`}
              aria-label={isFav ? "Quitar de favoritos" : "Agregar a favoritos"}
            >
              <Heart className={`h-4 w-4 transition-transform ${isFav ? "fill-current scale-110" : ""}`} />
            </button>
          )}
          {agotado && (
            <div className="absolute inset-0 bg-background/60 flex items-center justify-center">
              <Badge variant="secondary" className="text-base">Agotado</Badge>
            </div>
          )}
        </div>
        <div className="p-3 space-y-1">
          <h3 className="font-medium text-sm line-clamp-2 min-h-[2.5rem]">{item.nombre}</h3>
          <div className="text-base font-bold" style={{ color: brandColor }}>
            {sinPrecio
              ? <span className="text-sm font-normal text-muted-foreground italic">Consultar</span>
              : item.precio_hasta != null
                ? `Desde ${formatPrecio(Number(item.precio))}`
                : formatPrecio(Number(item.precio))}
          </div>
        </div>
      </button>

      {canQuickAdd && (
        <button
          onClick={handleQuickAdd}
          className="absolute bottom-3 right-3 h-9 w-9 rounded-full text-white shadow-lg flex items-center justify-center transition-all opacity-0 group-hover:opacity-100 hover:scale-110 active:scale-95"
          style={{ backgroundColor: brandColor }}
          aria-label={`Agregar ${item.nombre}`}
        >
          {added ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
        </button>
      )}
    </motion.div>
  )
}
