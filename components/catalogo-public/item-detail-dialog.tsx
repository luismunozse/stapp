"use client"

import Image from "next/image"
import { useState, useEffect, useRef, useMemo } from "react"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Plus, Minus, ShoppingCart, Package, Wrench, MessageCircle, Star, Share2, ChevronLeft, ChevronRight, Copy, Heart } from "lucide-react"
import { toast } from "sonner"
import type { CartItem } from "./use-cart"

interface Variante {
  id: string
  etiqueta: string
  sku: string | null
  precio: number | null
  stock: number | null
  imagen_url: string | null
}

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
  variantes?: Variante[]
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
  isFav?: boolean
  onToggleFav?: () => void
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
  isFav,
  onToggleFav,
}: Props) {
  const [cantidad, setCantidad] = useState(1)
  const [imgIdx, setImgIdx] = useState(0)
  const [varianteId, setVarianteId] = useState<string | null>(null)
  const touchStartX = useRef<number | null>(null)

  useEffect(() => {
    if (open) {
      setCantidad(1)
      setImgIdx(0)
      // Pre-seleccionar primera variante con stock disponible
      const variantes = item?.variantes ?? []
      const primera = variantes.find((v) => v.stock == null || v.stock > 0) ?? variantes[0]
      setVarianteId(primera?.id ?? null)
    }
  }, [open, item?.id])

  useEffect(() => {
    if (!open || !item?.id) return
    // Tracking de vista de item. Fire & forget.
    fetch(`/api/public/catalogo/${slug}/view`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId: item.id }),
      keepalive: true,
    }).catch(() => {})
  }, [open, item?.id, slug])

  // Cross-sell: 4 items misma categoría priorizando destacados y precio alto (anchor upsell).
  // Si no hay 4 en la misma categoría, completa con destacados de otras categorías.
  const sugeridos = useMemo(() => {
    if (!item) return []
    const disponible = (i: Item) => i.id !== item.id && i.stock_disponible !== 0
    const score = (i: Item) =>
      (i.destacado ? 1_000_000 : 0) + (Number(i.precio) || 0)
    const sortByScore = (arr: Item[]) =>
      [...arr].sort((a, b) => score(b) - score(a))

    const mismaCat = sortByScore(
      relatedItems.filter(disponible).filter((i) => i.categoria_id === item.categoria_id)
    )
    if (mismaCat.length >= 4) return mismaCat.slice(0, 4)

    const otraCat = sortByScore(
      relatedItems.filter(disponible).filter((i) => i.categoria_id !== item.categoria_id)
    )
    return [...mismaCat, ...otraCat].slice(0, 4)
  }, [item, relatedItems])

  if (!item) return null

  const variantes = item.variantes ?? []
  const tieneVariantes = variantes.length > 0
  const varianteSel = tieneVariantes ? variantes.find((v) => v.id === varianteId) ?? null : null

  const galeriaBase = [item.imagen_url, ...(item.imagenes ?? [])].filter(Boolean) as string[]
  const galeria = varianteSel?.imagen_url
    ? [varianteSel.imagen_url, ...galeriaBase.filter((u) => u !== varianteSel.imagen_url)]
    : galeriaBase

  const precioEfectivo = varianteSel?.precio != null ? Number(varianteSel.precio) : item.precio != null ? Number(item.precio) : null
  const stockEfectivo = tieneVariantes
    ? varianteSel?.stock ?? null
    : item.stock_disponible

  const sinPrecio = precioEfectivo == null
  const agotado = stockEfectivo === 0
  const stockMax = stockEfectivo ?? Infinity
  const debeElegirVariante = tieneVariantes && !varianteSel

  const handleAdd = () => {
    if (sinPrecio || agotado || debeElegirVariante) return
    onAdd({
      id: item.id,
      nombre: item.nombre,
      precio: precioEfectivo!,
      cantidad,
      imagen_url: varianteSel?.imagen_url ?? item.imagen_url,
      stock_disponible: stockEfectivo,
      varianteId: varianteSel?.id ?? null,
      varianteEtiqueta: varianteSel?.etiqueta ?? null,
    })
  }

  const itemUrl =
    typeof window !== "undefined" ? `${window.location.origin}/catalogo/${slug}/${item.id}` : ""

  const precioTexto = (() => {
    if (precioEfectivo == null) return "(consultar precio)"
    const base = formatPrecio(precioEfectivo)
    return tieneVariantes ? base : item.precio_hasta != null ? `desde ${base}` : base
  })()

  const shareText = `Hola! Vi "${item.nombre}" ${precioTexto} en el catálogo: ${itemUrl}`

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: item.nombre, text: shareText, url: itemUrl })
      } catch { /* cancel */ }
      return
    }
    try {
      await navigator.clipboard.writeText(itemUrl)
      toast.success("Link copiado")
    } catch {
      toast.error("No se pudo copiar")
    }
  }

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(itemUrl)
      toast.success("Link copiado")
    } catch {
      toast.error("No se pudo copiar")
    }
  }

  const shareWhatsAppUrl = `https://wa.me/?text=${encodeURIComponent(shareText)}`

  const whatsappLink = whatsapp
    ? `https://wa.me/${whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(
        `Hola! Me interesa "${item.nombre}" ${precioTexto}. Link: ${itemUrl}`
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
      <DialogContent className="w-[calc(100vw-1rem)] sm:w-full sm:max-w-2xl max-h-[90dvh] overflow-y-auto p-0">
        <DialogTitle className="sr-only">{item.nombre}</DialogTitle>

        <div
          className="aspect-video bg-muted relative select-none"
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          {galeria[imgIdx] ? (
            <Image
              src={galeria[imgIdx]}
              alt={item.nombre}
              fill
              sizes="(max-width: 768px) 100vw, 672px"
              className="object-cover"
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

          <div className="absolute top-2 right-2 flex gap-1.5">
            {onToggleFav && (
              <button
                onClick={onToggleFav}
                className={`h-9 w-9 rounded-full backdrop-blur flex items-center justify-center transition ${
                  isFav ? "bg-white/95 text-rose-500" : "bg-background/80 hover:bg-background"
                }`}
                aria-label={isFav ? "Quitar de favoritos" : "Agregar a favoritos"}
                title={isFav ? "Quitar de favoritos" : "Agregar a favoritos"}
              >
                <Heart className={`h-4 w-4 ${isFav ? "fill-current" : ""}`} />
              </button>
            )}
            <a
              href={shareWhatsAppUrl}
              target="_blank"
              rel="noreferrer"
              className="h-9 w-9 rounded-full bg-background/80 backdrop-blur flex items-center justify-center hover:bg-background transition"
              aria-label="Compartir por WhatsApp"
              title="Compartir por WhatsApp"
            >
              <MessageCircle className="h-4 w-4" />
            </a>
            <button
              onClick={handleCopyLink}
              className="h-9 w-9 rounded-full bg-background/80 backdrop-blur flex items-center justify-center hover:bg-background transition"
              aria-label="Copiar link"
              title="Copiar link del item"
            >
              <Copy className="h-4 w-4" />
            </button>
            <button
              onClick={handleShare}
              className="h-9 w-9 rounded-full bg-background/80 backdrop-blur flex items-center justify-center hover:bg-background transition"
              aria-label="Compartir"
            >
              <Share2 className="h-4 w-4" />
            </button>
          </div>
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
                    {tieneVariantes
                      ? formatPrecio(precioEfectivo!)
                      : item.precio_hasta != null
                        ? `Desde ${formatPrecio(precioEfectivo!)}`
                        : formatPrecio(precioEfectivo!)}
                  </div>
                  {item.precio_hasta != null && !tieneVariantes && (
                    <div className="text-xs text-muted-foreground">hasta {formatPrecio(Number(item.precio_hasta))}</div>
                  )}
                  {item.precio_lista != null && Number(item.precio_lista) > precioEfectivo! && (
                    <div className="flex items-center justify-end gap-1.5 mt-0.5">
                      <span className="text-xs text-muted-foreground line-through">
                        {formatPrecio(Number(item.precio_lista))}
                      </span>
                      <span className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded">
                        -{Math.round((1 - precioEfectivo! / Number(item.precio_lista)) * 100)}%
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {item.descripcion && (
            <p className="text-sm text-muted-foreground whitespace-pre-line">{item.descripcion}</p>
          )}

          {tieneVariantes && (
            <div>
              <div className="text-xs font-medium mb-1.5">
                Variante: {varianteSel ? <span className="text-foreground">{varianteSel.etiqueta}</span> : <span className="text-destructive">elegí una opción</span>}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {variantes.map((v) => {
                  const sinStock = v.stock === 0
                  const active = v.id === varianteId
                  return (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => !sinStock && setVarianteId(v.id)}
                      disabled={sinStock}
                      className={`px-3 py-1.5 rounded-md text-xs border transition-colors ${
                        active ? "text-white" : sinStock ? "bg-muted text-muted-foreground line-through" : "bg-background hover:bg-muted"
                      }`}
                      style={active ? { backgroundColor: brandColor, borderColor: brandColor } : undefined}
                      title={sinStock ? "Sin stock" : undefined}
                    >
                      {v.etiqueta}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {item.etiquetas.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {item.etiquetas.map((tag) => (
                <Badge key={tag} variant="outline">{tag}</Badge>
              ))}
            </div>
          )}

          {item.tipo === "PRODUCTO" && stockEfectivo != null && (
            <div className="text-sm">
              {agotado ? (
                <Badge variant="secondary">Sin stock</Badge>
              ) : stockEfectivo <= 5 ? (
                <span className="text-orange-600">Quedan {stockEfectivo} unidades</span>
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
                    <div className="aspect-square bg-muted relative">
                      {sg.imagen_url && (
                        <Image
                          src={sg.imagen_url}
                          alt={sg.nombre}
                          fill
                          sizes="(max-width: 640px) 50vw, 25vw"
                          className="object-cover group-hover:scale-105 transition-transform"
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
