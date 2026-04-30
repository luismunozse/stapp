"use client"

import { useState, useEffect, useRef, useMemo } from "react"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Plus, Minus, ShoppingCart, Package, Wrench, MessageCircle, Star, Share2, ChevronLeft, ChevronRight } from "lucide-react"
import { toast } from "sonner"
import type { CartItem } from "./use-cart"

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
  item: Item | null
  open: boolean
  onClose: () => void
  onAdd: (cartItem: CartItem) => void
  formatPrecio: (n: number) => string
  brandColor: string
  whatsapp: string | null
  slug: string
  relatedItems: Item[]
  onSelectRelated: (id: string) => void
}

export function ItemDetailDialog({
  item,
  open,
  onClose,
  onAdd,
  formatPrecio,
  brandColor,
  whatsapp,
  slug,
  relatedItems,
  onSelectRelated,
}: Props) {
  const [cantidad, setCantidad] = useState(1)
  const [imgIdx, setImgIdx] = useState(0)
  const touchStartX = useRef<number | null>(null)

  useEffect(() => {
    if (open) {
      setCantidad(1)
      setImgIdx(0)
    }
  }, [open, item?.id])

  // Cross-sell: 4 items aleatorios de la misma categoría (excluyendo el actual)
  const sugeridos = useMemo(() => {
    if (!item) return []
    return relatedItems
      .filter((i) => i.id !== item.id && i.categoria_id === item.categoria_id && i.stock_disponible !== 0)
      .slice(0, 4)
  }, [item, relatedItems])

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

  const handleShare = async () => {
    const url = `${window.location.origin}/catalogo/${slug}/${item.id}`
    if (navigator.share) {
      try {
        await navigator.share({ title: item.nombre, url })
      } catch { /* cancel */ }
      return
    }
    try {
      await navigator.clipboard.writeText(url)
      toast.success("Link copiado")
    } catch {
      toast.error("No se pudo copiar")
    }
  }

  const whatsappLink = whatsapp
    ? `https://wa.me/${whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(
        `Hola! Vi "${item.nombre}" en su catálogo. Quería consultar más info.`
      )}`
    : null

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
  }
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null || galeria.length <= 1) return
    const dx = e.changedTouches[0].clientX - touchStartX.current
    if (Math.abs(dx) > 50) {
      if (dx < 0) setImgIdx((i) => (i + 1) % galeria.length)
      else setImgIdx((i) => (i - 1 + galeria.length) % galeria.length)
    }
    touchStartX.current = null
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-0">
        <DialogTitle className="sr-only">{item.nombre}</DialogTitle>

        <div
          className="aspect-video bg-muted relative select-none"
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
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
            <>
              <button
                onClick={() => setImgIdx((i) => (i - 1 + galeria.length) % galeria.length)}
                className="absolute left-2 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-background/80 backdrop-blur flex items-center justify-center hover:bg-background transition"
                aria-label="Anterior"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                onClick={() => setImgIdx((i) => (i + 1) % galeria.length)}
                className="absolute right-2 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-background/80 backdrop-blur flex items-center justify-center hover:bg-background transition"
                aria-label="Siguiente"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
              <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
                {galeria.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setImgIdx(i)}
                    className={`h-2 rounded-full transition-all ${i === imgIdx ? "bg-white w-6" : "bg-white/50 w-2"}`}
                    aria-label={`Imagen ${i + 1}`}
                  />
                ))}
              </div>
            </>
          )}

          <button
            onClick={handleShare}
            className="absolute top-2 right-2 h-9 w-9 rounded-full bg-background/80 backdrop-blur flex items-center justify-center hover:bg-background transition"
            aria-label="Compartir"
          >
            <Share2 className="h-4 w-4" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex gap-1.5 mb-2">
                <Badge variant="secondary" className="gap-1">
                  {item.tipo === "PRODUCTO" ? <Package className="h-3 w-3" /> : <Wrench className="h-3 w-3" />}
                  {item.tipo === "PRODUCTO" ? "Producto" : "Servicio"}
                </Badge>
                {item.destacado && (
                  <Badge className="gap-1 border-0 text-white" style={{ backgroundColor: brandColor }}>
                    <Star className="h-3 w-3 fill-current" />
                    Destacado
                  </Badge>
                )}
              </div>
              <h2 className="text-xl font-bold">{item.nombre}</h2>
            </div>
            <div className="text-right shrink-0">
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

          {!sinPrecio && !agotado ? (
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
          ) : (
            <div className="pt-2 border-t flex flex-col gap-2">
              {sinPrecio && (
                <p className="text-sm text-center text-muted-foreground">
                  Este item requiere consulta. Contactá al negocio para más información.
                </p>
              )}
              {whatsappLink && (
                <Button asChild className="gap-2 w-full" style={{ backgroundColor: brandColor }}>
                  <a href={whatsappLink} target="_blank" rel="noreferrer">
                    <MessageCircle className="h-4 w-4" />
                    Consultar por WhatsApp
                  </a>
                </Button>
              )}
            </div>
          )}

          {sugeridos.length > 0 && (
            <div className="pt-4 border-t">
              <h3 className="text-sm font-semibold mb-3">También te puede interesar</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {sugeridos.map((sg) => (
                  <button
                    key={sg.id}
                    onClick={() => onSelectRelated(sg.id)}
                    className="text-left rounded-lg border bg-card overflow-hidden hover:shadow-md transition group"
                  >
                    <div className="aspect-square bg-muted">
                      {sg.imagen_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={sg.imagen_url}
                          alt={sg.nombre}
                          loading="lazy"
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                        />
                      )}
                    </div>
                    <div className="p-2">
                      <p className="text-xs font-medium line-clamp-1">{sg.nombre}</p>
                      <p className="text-xs font-bold" style={{ color: brandColor }}>
                        {sg.precio != null ? formatPrecio(Number(sg.precio)) : "Consultar"}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
