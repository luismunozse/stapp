"use client"

import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Plus, Minus, ShoppingCart, Package, Wrench } from "lucide-react"
import type { CartItem } from "./use-cart"

interface Item {
  id: string
  tipo: "PRODUCTO" | "SERVICIO"
  nombre: string
  descripcion: string | null
  precio: number | null
  precio_hasta: number | null
  imagen_url: string | null
  imagenes: string[]
  etiquetas: string[]
  stock_disponible: number | null
}

interface Props {
  item: Item | null
  open: boolean
  onClose: () => void
  onAdd: (cartItem: CartItem) => void
  formatPrecio: (n: number) => string
  brandColor: string
}

export function ItemDetailDialog({ item, open, onClose, onAdd, formatPrecio, brandColor }: Props) {
  const [cantidad, setCantidad] = useState(1)
  const [imgIdx, setImgIdx] = useState(0)

  useEffect(() => {
    if (open) {
      setCantidad(1)
      setImgIdx(0)
    }
  }, [open, item?.id])

  if (!item) return null

  const galeria = [item.imagen_url, ...(item.imagenes ?? [])].filter(Boolean) as string[]
  const agotado = item.stock_disponible === 0
  const sinPrecio = item.precio == null
  const stockMax = item.stock_disponible ?? Infinity

  const handleAdd = () => {
    if (sinPrecio || agotado) return
    onAdd({
      id: item.id,
      nombre: item.nombre,
      precio: Number(item.precio),
      cantidad,
      imagen_url: item.imagen_url,
      stock_disponible: item.stock_disponible,
    })
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-0">
        <DialogTitle className="sr-only">{item.nombre}</DialogTitle>

        <div className="aspect-video bg-muted relative">
          {galeria[imgIdx] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={galeria[imgIdx]}
              alt={item.nombre}
              loading="lazy"
              decoding="async"
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-6xl text-muted-foreground">
              {item.tipo === "PRODUCTO" ? "📦" : "🛠️"}
            </div>
          )}
          {galeria.length > 1 && (
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
              {galeria.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setImgIdx(i)}
                  className={`h-2 w-2 rounded-full transition-colors ${i === imgIdx ? "bg-white" : "bg-white/50"}`}
                  aria-label={`Imagen ${i + 1}`}
                />
              ))}
            </div>
          )}
        </div>

        <div className="p-6 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Badge variant="secondary" className="gap-1 mb-2">
                {item.tipo === "PRODUCTO" ? <Package className="h-3 w-3" /> : <Wrench className="h-3 w-3" />}
                {item.tipo === "PRODUCTO" ? "Producto" : "Servicio"}
              </Badge>
              <h2 className="text-xl font-bold">{item.nombre}</h2>
            </div>
            <div className="text-right">
              {sinPrecio ? (
                <span className="text-sm italic text-muted-foreground">Consultar precio</span>
              ) : (
                <>
                  <div className="text-2xl font-bold" style={{ color: brandColor }}>
                    {item.precio_hasta != null ? `Desde ${formatPrecio(Number(item.precio))}` : formatPrecio(Number(item.precio))}
                  </div>
                  {item.precio_hasta != null && (
                    <div className="text-xs text-muted-foreground">hasta {formatPrecio(Number(item.precio_hasta))}</div>
                  )}
                </>
              )}
            </div>
          </div>

          {item.descripcion && (
            <p className="text-sm text-muted-foreground whitespace-pre-line">{item.descripcion}</p>
          )}

          {item.etiquetas.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {item.etiquetas.map((tag) => (
                <Badge key={tag} variant="outline">{tag}</Badge>
              ))}
            </div>
          )}

          {item.tipo === "PRODUCTO" && item.stock_disponible != null && (
            <div className="text-sm">
              {agotado ? (
                <Badge variant="secondary">Sin stock</Badge>
              ) : item.stock_disponible <= 5 ? (
                <span className="text-orange-600">Quedan {item.stock_disponible} unidades</span>
              ) : (
                <span className="text-green-600">Stock disponible</span>
              )}
            </div>
          )}

          {!sinPrecio && !agotado && (
            <div className="flex items-center justify-between gap-3 pt-2 border-t">
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setCantidad((c) => Math.max(1, c - 1))}
                  disabled={cantidad <= 1}
                >
                  <Minus className="h-4 w-4" />
                </Button>
                <span className="w-12 text-center font-semibold">{cantidad}</span>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setCantidad((c) => Math.min(stockMax, c + 1))}
                  disabled={cantidad >= stockMax}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              <Button onClick={handleAdd} className="flex-1 gap-2" style={{ backgroundColor: brandColor }}>
                <ShoppingCart className="h-4 w-4" />
                Agregar
              </Button>
            </div>
          )}

          {sinPrecio && (
            <div className="pt-2 border-t text-sm text-center text-muted-foreground">
              Este item requiere consulta. Contactá al negocio para más información.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
