"use client"

import { useMemo, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { ShoppingCart } from "lucide-react"
import { Button } from "@/components/ui/button"
import { CartDrawer } from "./cart-drawer"
import { ItemDetailDialog } from "./item-detail-dialog"
import { CatalogoHero } from "./catalogo-hero"
import { CatalogoFilters, type SortOption } from "./catalogo-filters"
import { MiniCart } from "./mini-cart"
import { ItemCard } from "./item-card"
import { useCart, type CartItem } from "./use-cart"

interface CatalogoData {
  config: {
    slug: string
    titulo: string | null
    descripcion: string | null
    color_primary: string
    whatsapp: string | null
    banner_url: string | null
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
    destacado: boolean
  }>
}

export function CatalogoView({ data }: { data: CatalogoData }) {
  const cart = useCart(data.config.slug)
  const [search, setSearch] = useState("")
  const [categoriaActiva, setCategoriaActiva] = useState<string | null>(null)
  const [sort, setSort] = useState<SortOption>("recomendados")
  const [tagsActivos, setTagsActivos] = useState<string[]>([])
  const [soloDisponibles, setSoloDisponibles] = useState(false)
  const [cartOpen, setCartOpen] = useState(false)
  const [detalleId, setDetalleId] = useState<string | null>(null)

  const titulo = data.config.titulo || data.organizacion.nombre_mostrar || data.organizacion.nombre
  const moneda = data.organizacion.moneda || "ARS"
  const formatPrecio = (n: number) =>
    new Intl.NumberFormat("es-AR", { style: "currency", currency: moneda, maximumFractionDigits: 0 }).format(n)

  // Calcular rango de precios disponibles
  const { precioMin, precioMax } = useMemo(() => {
    const precios = data.items.map((i) => Number(i.precio)).filter((p) => !isNaN(p) && p > 0)
    if (precios.length === 0) return { precioMin: 0, precioMax: 0 }
    return { precioMin: Math.floor(Math.min(...precios)), precioMax: Math.ceil(Math.max(...precios)) }
  }, [data.items])

  const [precioRange, setPrecioRange] = useState<[number, number]>([precioMin, precioMax])

  // Tags únicos de items activos
  const tags = useMemo(() => {
    const set = new Set<string>()
    data.items.forEach((i) => i.etiquetas.forEach((t) => set.add(t)))
    return Array.from(set).sort()
  }, [data.items])

  const itemsFiltrados = useMemo(() => {
    let arr = data.items.filter((it) => {
      if (categoriaActiva && it.categoria_id !== categoriaActiva) return false
      if (search && !it.nombre.toLowerCase().includes(search.toLowerCase())) return false
      if (soloDisponibles && it.stock_disponible === 0) return false
      if (tagsActivos.length > 0 && !tagsActivos.some((t) => it.etiquetas.includes(t))) return false
      if (precioRange[0] > precioMin || precioRange[1] < precioMax) {
        if (it.precio != null) {
          const p = Number(it.precio)
          if (p < precioRange[0] || p > precioRange[1]) return false
        }
      }
      return true
    })

    if (sort === "precio_asc") {
      arr = [...arr].sort((a, b) => (Number(a.precio) || Infinity) - (Number(b.precio) || Infinity))
    } else if (sort === "precio_desc") {
      arr = [...arr].sort((a, b) => (Number(b.precio) || -Infinity) - (Number(a.precio) || -Infinity))
    } else if (sort === "nombre_asc") {
      arr = [...arr].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))
    }
    // recomendados: ya viene ordenado del server (destacado DESC, orden ASC)

    return arr
  }, [data.items, search, categoriaActiva, soloDisponibles, tagsActivos, precioRange, precioMin, precioMax, sort])

  const itemDetalle = data.items.find((i) => i.id === detalleId) ?? null

  const hasActiveFilters =
    !!search ||
    categoriaActiva !== null ||
    sort !== "recomendados" ||
    tagsActivos.length > 0 ||
    soloDisponibles ||
    precioRange[0] !== precioMin ||
    precioRange[1] !== precioMax

  const clearFilters = () => {
    setSearch("")
    setCategoriaActiva(null)
    setSort("recomendados")
    setTagsActivos([])
    setSoloDisponibles(false)
    setPrecioRange([precioMin, precioMax])
  }

  const handleQuickAdd = (item: CatalogoData["items"][number]) => {
    if (item.precio == null) return
    cart.add({
      id: item.id,
      nombre: item.nombre,
      precio: Number(item.precio),
      imagen_url: item.imagen_url,
      stock_disponible: item.stock_disponible,
    })
  }

  const shareUrl = typeof window !== "undefined" ? window.location.href : ""

  return (
    <div
      className="min-h-screen bg-background"
      style={{ ["--brand" as any]: data.config.color_primary }}
    >
      <CatalogoHero
        bannerUrl={data.config.banner_url}
        logoUrl={data.organizacion.logo_url}
        titulo={titulo}
        descripcion={data.config.descripcion}
        whatsapp={data.config.whatsapp}
        brandColor={data.config.color_primary}
        shareUrl={shareUrl}
      />

      <CatalogoFilters
        search={search}
        onSearch={setSearch}
        categorias={data.categorias}
        categoriaActiva={categoriaActiva}
        onCategoria={setCategoriaActiva}
        sort={sort}
        onSort={setSort}
        tags={tags}
        tagsActivos={tagsActivos}
        onToggleTag={(t) =>
          setTagsActivos((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]))
        }
        precioMin={precioMin}
        precioMax={precioMax}
        precioRange={precioRange}
        onPrecioRange={setPrecioRange}
        soloDisponibles={soloDisponibles}
        onSoloDisponibles={setSoloDisponibles}
        brandColor={data.config.color_primary}
        formatPrecio={formatPrecio}
        hasActiveFilters={hasActiveFilters}
        onClearFilters={clearFilters}
      />

      <main className="container mx-auto max-w-6xl px-4 py-6 pb-32 lg:pb-12">
        <div className="flex gap-6">
          <div className="flex-1 min-w-0">
            {itemsFiltrados.length === 0 ? (
              <div className="text-center py-20 text-muted-foreground">
                <p className="mb-3">No hay items que coincidan con tu búsqueda.</p>
                {hasActiveFilters && (
                  <Button variant="outline" size="sm" onClick={clearFilters}>
                    Limpiar filtros
                  </Button>
                )}
              </div>
            ) : (
              <motion.div
                className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4"
                initial="hidden"
                animate="visible"
                variants={{
                  visible: { transition: { staggerChildren: 0.03 } },
                  hidden: {},
                }}
              >
                <AnimatePresence>
                  {itemsFiltrados.map((item) => (
                    <ItemCard
                      key={item.id}
                      item={item}
                      onClick={() => setDetalleId(item.id)}
                      onQuickAdd={() => handleQuickAdd(item)}
                      formatPrecio={formatPrecio}
                      brandColor={data.config.color_primary}
                    />
                  ))}
                </AnimatePresence>
              </motion.div>
            )}

            <p className="text-center text-xs text-muted-foreground mt-12">
              Powered by <a href="https://stapp.com.ar" className="underline">STApp</a>
            </p>
          </div>

          <MiniCart
            cart={cart}
            onOpen={() => setCartOpen(true)}
            formatPrecio={formatPrecio}
            brandColor={data.config.color_primary}
          />
        </div>
      </main>

      {/* Sticky bottom CTA mobile */}
      <AnimatePresence>
        {cart.count > 0 && (
          <motion.div
            initial={{ y: 100 }}
            animate={{ y: 0 }}
            exit={{ y: 100 }}
            transition={{ type: "spring", damping: 25 }}
            className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-background border-t shadow-2xl px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]"
          >
            <Button
              onClick={() => setCartOpen(true)}
              size="lg"
              className="w-full justify-between gap-3 h-12"
              style={{ backgroundColor: data.config.color_primary }}
            >
              <span className="flex items-center gap-2">
                <ShoppingCart className="h-5 w-5" />
                <span className="font-semibold">{cart.count} item{cart.count > 1 ? "s" : ""}</span>
              </span>
              <span className="font-bold">{formatPrecio(cart.total)}</span>
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

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
        whatsapp={data.config.whatsapp}
        slug={data.config.slug}
        relatedItems={data.items}
        onSelectRelated={(id) => setDetalleId(id)}
      />

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
