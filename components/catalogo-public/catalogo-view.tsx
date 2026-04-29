"use client"

import { useMemo, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Search, MessageCircle, ShoppingCart, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { CartDrawer } from "./cart-drawer"
import { ItemDetailDialog } from "./item-detail-dialog"
import { useCart, type CartItem } from "./use-cart"

interface CatalogoData {
  config: {
    slug: string
    titulo: string | null
    descripcion: string | null
    color_primary: string
    whatsapp: string | null
  }
  organizacion: {
    id: string
    nombre: string
    nombre_mostrar: string
    logo_url: string | null
    telefono: string | null
    moneda: string
  }
  categorias: Array<{
    id: string
    nombre: string
    descripcion: string | null
    imagen_url: string | null
  }>
  items: Array<{
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
  }>
}

export function CatalogoView({ data }: { data: CatalogoData }) {
  const cart = useCart(data.config.slug)
  const [search, setSearch] = useState("")
  const [categoriaActiva, setCategoriaActiva] = useState<string | null>(null)
  const [cartOpen, setCartOpen] = useState(false)
  const [detalleId, setDetalleId] = useState<string | null>(null)

  const itemsFiltrados = useMemo(() => {
    return data.items.filter((it) => {
      if (categoriaActiva && it.categoria_id !== categoriaActiva) return false
      if (search && !it.nombre.toLowerCase().includes(search.toLowerCase())) return false
      return true
    })
  }, [data.items, search, categoriaActiva])

  const itemDetalle = data.items.find((i) => i.id === detalleId) ?? null
  const titulo = data.config.titulo || data.organizacion.nombre_mostrar || data.organizacion.nombre
  const moneda = data.organizacion.moneda || "ARS"
  const formatPrecio = (n: number) =>
    new Intl.NumberFormat("es-AR", { style: "currency", currency: moneda, maximumFractionDigits: 0 }).format(n)

  const whatsappLink = data.config.whatsapp
    ? `https://wa.me/${data.config.whatsapp.replace(/\D/g, "")}`
    : null

  return (
    <div
      className="min-h-screen bg-background"
      style={{ ["--brand" as any]: data.config.color_primary }}
    >
      {/* Header */}
      <header className="border-b bg-gradient-to-b from-[var(--brand)]/10 to-transparent">
        <div className="container mx-auto max-w-5xl px-4 py-8">
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
            {data.organizacion.logo_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={data.organizacion.logo_url}
                alt={titulo}
                className="h-16 w-16 rounded-xl object-cover bg-white border shadow-sm"
              />
            )}
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{titulo}</h1>
              {data.config.descripcion && (
                <p className="text-muted-foreground mt-1">{data.config.descripcion}</p>
              )}
            </div>
            {whatsappLink && (
              <Button asChild className="gap-2" style={{ backgroundColor: "var(--brand)" }}>
                <a href={whatsappLink} target="_blank" rel="noreferrer">
                  <MessageCircle className="h-4 w-4" />
                  Contactar
                </a>
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Filtros sticky */}
      <div className="sticky top-0 z-30 bg-background/95 backdrop-blur border-b">
        <div className="container mx-auto max-w-5xl px-4 py-3 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar..."
              className="pl-9"
            />
          </div>

          {data.categorias.length > 0 && (
            <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-thin">
              <button
                onClick={() => setCategoriaActiva(null)}
                className={`shrink-0 px-3 py-1.5 rounded-full text-sm transition-colors border ${
                  categoriaActiva === null
                    ? "bg-[var(--brand)] text-white border-[var(--brand)]"
                    : "bg-background hover:bg-muted"
                }`}
              >
                Todos
              </button>
              {data.categorias.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setCategoriaActiva(cat.id)}
                  className={`shrink-0 px-3 py-1.5 rounded-full text-sm transition-colors border ${
                    categoriaActiva === cat.id
                      ? "bg-[var(--brand)] text-white border-[var(--brand)]"
                      : "bg-background hover:bg-muted"
                  }`}
                >
                  {cat.nombre}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Grid */}
      <main className="container mx-auto max-w-5xl px-4 py-6 pb-24">
        {itemsFiltrados.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">
            <p>No hay items que coincidan con tu búsqueda.</p>
          </div>
        ) : (
          <motion.div
            className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4"
            initial="hidden"
            animate="visible"
            variants={{
              visible: { transition: { staggerChildren: 0.03 } },
              hidden: {},
            }}
          >
            <AnimatePresence>
              {itemsFiltrados.map((item) => {
                const agotado = item.stock_disponible === 0
                const sinPrecio = item.precio == null
                return (
                  <motion.button
                    key={item.id}
                    onClick={() => setDetalleId(item.id)}
                    layout
                    variants={{
                      hidden: { opacity: 0, y: 10 },
                      visible: { opacity: 1, y: 0 },
                    }}
                    whileHover={{ y: -2 }}
                    className={`text-left group relative rounded-xl border bg-card overflow-hidden transition-shadow hover:shadow-md ${
                      agotado ? "opacity-60" : ""
                    }`}
                  >
                    <div className="aspect-square bg-muted relative">
                      {item.imagen_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.imagen_url}
                          alt={item.nombre}
                          loading="lazy"
                          decoding="async"
                          className="w-full h-full object-cover transition-transform group-hover:scale-105"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-3xl text-muted-foreground">
                          {item.tipo === "PRODUCTO" ? "📦" : "🛠️"}
                        </div>
                      )}
                      {agotado && (
                        <div className="absolute inset-0 bg-background/60 flex items-center justify-center">
                          <Badge variant="secondary" className="text-base">Agotado</Badge>
                        </div>
                      )}
                    </div>
                    <div className="p-3 space-y-1">
                      <h3 className="font-medium text-sm line-clamp-2 min-h-[2.5rem]">{item.nombre}</h3>
                      <div className="text-base font-bold" style={{ color: "var(--brand)" }}>
                        {sinPrecio
                          ? <span className="text-sm font-normal text-muted-foreground italic">Consultar</span>
                          : item.precio_hasta != null
                            ? `Desde ${formatPrecio(Number(item.precio))}`
                            : formatPrecio(Number(item.precio))}
                      </div>
                    </div>
                  </motion.button>
                )
              })}
            </AnimatePresence>
          </motion.div>
        )}

        <p className="text-center text-xs text-muted-foreground mt-12">
          Powered by <a href="https://stapp.app" className="underline">STApp</a>
        </p>
      </main>

      {/* Cart FAB */}
      <AnimatePresence>
        {cart.count > 0 && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="fixed bottom-4 right-4 z-40"
          >
            <Button
              size="lg"
              onClick={() => setCartOpen(true)}
              className="rounded-full shadow-xl h-14 px-5 gap-2"
              style={{ backgroundColor: "var(--brand)" }}
            >
              <ShoppingCart className="h-5 w-5" />
              <span className="font-semibold">{cart.count}</span>
              <span className="hidden sm:inline">·</span>
              <span className="hidden sm:inline">{formatPrecio(cart.total)}</span>
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Detail dialog */}
      <ItemDetailDialog
        item={itemDetalle}
        open={!!itemDetalle}
        onClose={() => setDetalleId(null)}
        onAdd={(it: CartItem) => {
          cart.add(it)
          setDetalleId(null)
        }}
        formatPrecio={formatPrecio}
        brandColor={data.config.color_primary}
      />

      {/* Cart drawer */}
      <CartDrawer
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        cart={cart}
        slug={data.config.slug}
        titulo={titulo}
        formatPrecio={formatPrecio}
        brandColor={data.config.color_primary}
      />
    </div>
  )
}
