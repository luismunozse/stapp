"use client"

import Link from "next/link"
import { useState, useRef } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Plus, Minus, ShoppingCart, Package, Wrench, MessageCircle,
  Star, Share2, ChevronLeft, ChevronRight, ArrowLeft, Sparkles, Copy,
} from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { toast } from "sonner"
import { useCart } from "./use-cart"
import { CartDrawer } from "./cart-drawer"

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
}

interface Data {
  config: {
    slug: string
    titulo: string | null
    color_primary: string
    whatsapp: string | null
  }
  organizacion: {
    id: string
    nombre: string
    nombre_mostrar: string
    logo_url: string | null
    moneda: string
  }
  item: Item
  relacionados: Item[]
  bundle?: Item[]
}

export function CatalogoItemView({ data }: { data: Data }) {
  const cart = useCart(data.config.slug)
  const [cantidad, setCantidad] = useState(1)
  const [imgIdx, setImgIdx] = useState(0)
  const [cartOpen, setCartOpen] = useState(false)
  const touchStartX = useRef<number | null>(null)

  const { item, organizacion, config } = data
  const moneda = organizacion.moneda || "ARS"
  const formatPrecio = (n: number) =>
    new Intl.NumberFormat("es-AR", { style: "currency", currency: moneda, maximumFractionDigits: 0 }).format(n)

  const titulo = config.titulo || organizacion.nombre_mostrar || organizacion.nombre
  const galeria = [item.imagen_url, ...(item.imagenes ?? [])].filter(Boolean) as string[]
  const agotado = item.stock_disponible === 0
  const sinPrecio = item.precio == null
  const stockMax = item.stock_disponible ?? Infinity

  const whatsappLink = config.whatsapp
    ? `https://wa.me/${config.whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(
        `Hola! Vi "${item.nombre}" en su catálogo. Quería consultar.`
      )}`
    : null

  const handleAdd = () => {
    if (sinPrecio || agotado) return
    cart.add({
      id: item.id,
      nombre: item.nombre,
      precio: Number(item.precio),
      imagen_url: item.imagen_url,
      stock_disponible: item.stock_disponible,
    }, cantidad)
    toast.success("Agregado al carrito")
  }

  const itemUrl = typeof window !== "undefined" ? window.location.href : ""
  const precioTexto = !sinPrecio ? formatPrecio(Number(item.precio)) : "(consultar precio)"
  const shareText = `Hola! Vi "${item.nombre}" ${precioTexto} en el catálogo: ${itemUrl}`
  const shareWhatsAppUrl = `https://wa.me/?text=${encodeURIComponent(shareText)}`

  const handleShare = async () => {
    if (typeof navigator !== "undefined" && navigator.share) {
      try { await navigator.share({ title: item.nombre, text: shareText, url: itemUrl }) } catch { /* */ }
      return
    }
    try {
      await navigator.clipboard.writeText(itemUrl)
      toast.success("Link copiado")
    } catch { toast.error("No se pudo copiar") }
  }

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(itemUrl)
      toast.success("Link copiado")
    } catch { toast.error("No se pudo copiar") }
  }

  const onTouchStart = (e: React.TouchEvent) => { touchStartX.current = e.touches[0].clientX }
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
    <div
      className="min-h-dvh bg-background"
      style={{ ["--brand" as any]: config.color_primary }}
    >
      {/* Compact header */}
      <header className="border-b sticky top-0 z-30 bg-background/95 backdrop-blur">
        <div className="container mx-auto max-w-5xl px-4 py-3 flex items-center gap-3">
          <Link href={`/catalogo/${config.slug}`} className="flex items-center gap-2 hover:opacity-80">
            <ArrowLeft className="h-4 w-4" />
            {organizacion.logo_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={organizacion.logo_url} alt="" className="h-8 w-8 rounded-md object-cover" />
            )}
            <span className="font-semibold truncate">{titulo}</span>
          </Link>
          <div className="flex-1" />
          {cart.count > 0 && (
            <Button size="sm" onClick={() => setCartOpen(true)} className="gap-1.5" style={{ backgroundColor: config.color_primary }}>
              <ShoppingCart className="h-4 w-4" />
              {cart.count}
            </Button>
          )}
        </div>
      </header>

      <main className="container mx-auto max-w-5xl px-4 py-6">
        <div className="grid md:grid-cols-2 gap-6 lg:gap-10">
          {/* Galería */}
          <div className="space-y-2">
            <div
              className="aspect-square bg-muted rounded-xl overflow-hidden relative select-none"
              onTouchStart={onTouchStart}
              onTouchEnd={onTouchEnd}
            >
              {galeria[imgIdx] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={galeria[imgIdx]} alt={item.nombre} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-7xl text-muted-foreground">
                  {item.tipo === "PRODUCTO" ? "📦" : "🛠️"}
                </div>
              )}
              {galeria.length > 1 && (
                <>
                  <button
                    onClick={() => setImgIdx((i) => (i - 1 + galeria.length) % galeria.length)}
                    className="absolute left-2 top-1/2 -translate-y-1/2 h-11 w-11 rounded-full bg-background/85 backdrop-blur flex items-center justify-center shadow-md active:scale-95 transition"
                    aria-label="Anterior"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <button
                    onClick={() => setImgIdx((i) => (i + 1) % galeria.length)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 h-11 w-11 rounded-full bg-background/85 backdrop-blur flex items-center justify-center shadow-md active:scale-95 transition"
                    aria-label="Siguiente"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </>
              )}
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="absolute top-2 right-2 h-11 w-11 rounded-full bg-background/85 backdrop-blur flex items-center justify-center shadow-md hover:bg-background active:scale-95 transition"
                    aria-label="Compartir"
                  >
                    <Share2 className="h-4 w-4" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="p-2 w-48">
                  <a
                    href={shareWhatsAppUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm hover:bg-muted transition-colors"
                  >
                    <MessageCircle className="h-4 w-4 text-green-600" />
                    WhatsApp
                  </a>
                  <button
                    type="button"
                    onClick={handleCopyLink}
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm hover:bg-muted transition-colors"
                  >
                    <Copy className="h-4 w-4 text-muted-foreground" />
                    Copiar link
                  </button>
                  <button
                    type="button"
                    onClick={handleShare}
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm hover:bg-muted transition-colors"
                  >
                    <Share2 className="h-4 w-4 text-muted-foreground" />
                    Más opciones…
                  </button>
                </PopoverContent>
              </Popover>
            </div>
            {galeria.length > 1 && (
              <div className="grid grid-cols-5 gap-2">
                {galeria.map((src, i) => (
                  <button
                    key={i}
                    onClick={() => setImgIdx(i)}
                    className={`aspect-square rounded-md overflow-hidden border-2 transition ${
                      i === imgIdx ? "border-current" : "border-transparent opacity-60 hover:opacity-100"
                    }`}
                    style={i === imgIdx ? { borderColor: config.color_primary } : undefined}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt="" loading="lazy" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Info */}
          <div className="space-y-4">
            <div className="flex gap-1.5">
              <Badge variant="secondary" className="gap-1">
                {item.tipo === "PRODUCTO" ? <Package className="h-3 w-3" /> : <Wrench className="h-3 w-3" />}
                {item.tipo === "PRODUCTO" ? "Producto" : "Servicio"}
              </Badge>
              {item.destacado && (
                <Badge className="gap-1 border-0 text-white" style={{ backgroundColor: config.color_primary }}>
                  <Star className="h-3 w-3 fill-current" />
                  Destacado
                </Badge>
              )}
            </div>

            <h1 className="text-2xl sm:text-3xl font-bold">{item.nombre}</h1>

            {sinPrecio ? (
              <p className="text-lg italic text-muted-foreground">Consultar precio</p>
            ) : (
              <div>
                <div className="flex items-baseline gap-2 flex-wrap">
                  <div className="text-3xl font-bold" style={{ color: config.color_primary }}>
                    {item.precio_hasta != null ? `Desde ${formatPrecio(Number(item.precio))}` : formatPrecio(Number(item.precio))}
                  </div>
                  {item.precio_lista != null && Number(item.precio_lista) > Number(item.precio) && (
                    <>
                      <span className="text-base text-muted-foreground line-through">
                        {formatPrecio(Number(item.precio_lista))}
                      </span>
                      <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded">
                        -{Math.round((1 - Number(item.precio) / Number(item.precio_lista)) * 100)}%
                      </span>
                    </>
                  )}
                </div>
                {item.precio_hasta != null && (
                  <p className="text-sm text-muted-foreground">hasta {formatPrecio(Number(item.precio_hasta))}</p>
                )}
              </div>
            )}

            {item.descripcion && (
              <p className="text-muted-foreground whitespace-pre-line">{item.descripcion}</p>
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
                  <span className="text-orange-600 font-medium">Quedan {item.stock_disponible} unidades</span>
                ) : (
                  <span className="text-green-600 font-medium">Stock disponible</span>
                )}
              </div>
            )}

            {!sinPrecio && !agotado ? (
              <div className="flex items-center gap-3 pt-2">
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
                <Button onClick={handleAdd} className="flex-1 gap-2 h-11" style={{ backgroundColor: config.color_primary }}>
                  <ShoppingCart className="h-4 w-4" />
                  Agregar
                </Button>
              </div>
            ) : whatsappLink && (
              <Button asChild className="gap-2 w-full h-11" style={{ backgroundColor: config.color_primary }}>
                <a href={whatsappLink} target="_blank" rel="noreferrer">
                  <MessageCircle className="h-4 w-4" />
                  Consultar por WhatsApp
                </a>
              </Button>
            )}
          </div>
        </div>

        {(data.bundle?.length ?? 0) > 0 && (
          <section className="mt-12 pt-8 border-t">
            <h2 className="text-lg font-semibold mb-4 inline-flex items-center gap-2">
              <Sparkles className="h-5 w-5" style={{ color: config.color_primary }} />
              Frecuentemente comprados juntos
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {(data.bundle ?? []).map((bg) => (
                <Link
                  key={bg.id}
                  href={`/catalogo/${config.slug}/${bg.id}`}
                  className="rounded-lg border bg-card overflow-hidden hover:shadow-md transition group"
                >
                  <div className="aspect-square bg-muted relative">
                    {bg.imagen_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={bg.imagen_url}
                        alt={bg.nombre}
                        loading="lazy"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      />
                    )}
                  </div>
                  <div className="p-2.5">
                    <p className="text-sm font-medium line-clamp-1">{bg.nombre}</p>
                    <p className="text-sm font-bold mt-1" style={{ color: config.color_primary }}>
                      {bg.precio != null ? formatPrecio(Number(bg.precio)) : "Consultar"}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {data.relacionados.filter((r) => !data.bundle?.some((b) => b.id === r.id)).length > 0 && (
          <section className="mt-12 pt-8 border-t">
            <h2 className="text-lg font-semibold mb-4">Otros items relacionados</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {data.relacionados
                .filter((r) => !data.bundle?.some((b) => b.id === r.id))
                .map((rel) => (
                <Link
                  key={rel.id}
                  href={`/catalogo/${config.slug}/${rel.id}`}
                  className="rounded-lg border bg-card overflow-hidden hover:shadow-md transition group"
                >
                  <div className="aspect-square bg-muted relative">
                    {rel.imagen_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={rel.imagen_url}
                        alt={rel.nombre}
                        loading="lazy"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      />
                    )}
                    {rel.destacado && (
                      <Badge
                        className="absolute top-2 left-2 gap-1 border-0 text-white text-xs"
                        style={{ backgroundColor: config.color_primary }}
                      >
                        <Star className="h-3 w-3 fill-current" />
                      </Badge>
                    )}
                  </div>
                  <div className="p-2.5">
                    <p className="text-sm font-medium line-clamp-1">{rel.nombre}</p>
                    <p className="text-sm font-bold mt-1" style={{ color: config.color_primary }}>
                      {rel.precio != null ? formatPrecio(Number(rel.precio)) : "Consultar"}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}
      </main>

      <CartDrawer
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        cart={cart}
        slug={config.slug}
        titulo={titulo}
        formatPrecio={formatPrecio}
        brandColor={config.color_primary}
      />
    </div>
  )
}
