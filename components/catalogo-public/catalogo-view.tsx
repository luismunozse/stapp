"use client"

import { useEffect, useMemo, useState, type CSSProperties } from "react"
import dynamic from "next/dynamic"
import { brandCssVars } from "@/lib/catalogo/brand"
import { CatalogoImagePlaceholder } from "./catalogo-image-placeholder"
import { motion, AnimatePresence } from "framer-motion"
import { ShoppingCart } from "lucide-react"
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon"
import { Button } from "@/components/ui/button"
import { CatalogoHero } from "./catalogo-hero"
import { CatalogoFilters, type SortOption } from "./catalogo-filters"
import { MiniCart } from "./mini-cart"
import { ItemCard } from "./item-card"
import { useCart, type CartItem } from "./use-cart"
import { useRecientes, useFavoritos } from "./use-catalogo-storage"
import { useFuseSearch } from "./use-fuse-search"
import { Clock, Heart, Check } from "lucide-react"
import { toast } from "sonner"

// Dialogs/drawers solo se abren tras interacción. Cargarlos dynamic con
// ssr:false los saca del bundle inicial → mejor TTI mobile.
const CartDrawer = dynamic(
  () => import("./cart-drawer").then((m) => m.CartDrawer),
  { ssr: false }
)
const ItemDetailDialog = dynamic(
  () => import("./item-detail-dialog").then((m) => m.ItemDetailDialog),
  { ssr: false }
)

interface CatalogoData {
  config: {
    slug: string
    titulo: string | null
    descripcion: string | null
    color_primary: string
    whatsapp: string | null
    banner_url: string | null
    trust_badges: Array<{ icon: string; label: string }>
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
    slug: string | null
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
    precio_lista: number | null
    imagen_url: string | null
    imagenes: string[]
    etiquetas: string[]
    stock_disponible: number | null
    destacado: boolean
    vistas_semana?: number
    top_variante_id?: string | null
    variantes?: Array<{
      id: string
      etiqueta: string
      sku: string | null
      precio: number | null
      stock: number | null
      imagen_url: string | null
    }>
  }>
}

export function CatalogoView({
  data,
  initialCategoriaId = null,
}: {
  data: CatalogoData
  initialCategoriaId?: string | null
}) {
  const cart = useCart(data.config.slug)
  const recientes = useRecientes(data.config.slug)
  const favoritos = useFavoritos(data.config.slug)
  const [search, setSearch] = useState("")
  const [categoriaActiva, setCategoriaActiva] = useState<string | null>(initialCategoriaId)
  const [sort, setSort] = useState<SortOption>("recomendados")
  const [tagsActivos, setTagsActivos] = useState<string[]>([])
  const [soloDisponibles, setSoloDisponibles] = useState(false)
  const [soloFavoritos, setSoloFavoritos] = useState(false)
  const [cartOpen, setCartOpen] = useState(false)
  const [detalleId, setDetalleId] = useState<string | null>(null)

  const openDetalle = (id: string) => {
    setDetalleId(id)
    recientes.push(id)
  }

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

  useEffect(() => {
    // Tracking de vista del catálogo (una vez por carga). Fire & forget.
    fetch(`/api/public/catalogo/${data.config.slug}/view`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
      keepalive: true,
    }).catch(() => {})
  }, [data.config.slug])

  // Tags únicos de items activos
  const tags = useMemo(() => {
    const set = new Set<string>()
    data.items.forEach((i) => i.etiquetas.forEach((t) => set.add(t)))
    return Array.from(set).sort()
  }, [data.items])

  const fuseConfig = useMemo(
    () => ({
      keys: [
        { name: "nombre" as const, weight: 0.6 },
        { name: "etiquetas" as const, weight: 0.25 },
        { name: "descripcion" as const, weight: 0.15 },
      ],
    }),
    []
  )
  const searchResults = useFuseSearch(data.items, search, fuseConfig)

  const itemsFiltrados = useMemo(() => {
    let arr = searchResults.filter((it) => {
      if (categoriaActiva && it.categoria_id !== categoriaActiva) return false
      if (soloDisponibles && it.stock_disponible === 0) return false
      if (soloFavoritos && !favoritos.ids.has(it.id)) return false
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
  }, [searchResults, categoriaActiva, soloDisponibles, soloFavoritos, favoritos.ids, tagsActivos, precioRange, precioMin, precioMax, sort])

  // Items recientemente vistos (que sigan existiendo en el catálogo)
  const itemsRecientes = useMemo(() => {
    if (recientes.ids.length === 0) return []
    const map = new Map(data.items.map((i) => [i.id, i]))
    return recientes.ids
      .map((id) => map.get(id))
      .filter((it): it is NonNullable<typeof it> => !!it)
      .slice(0, 8)
  }, [recientes.ids, data.items])

  const itemDetalle = data.items.find((i) => i.id === detalleId) ?? null

  const hasActiveFilters =
    !!search ||
    categoriaActiva !== null ||
    sort !== "recomendados" ||
    tagsActivos.length > 0 ||
    soloDisponibles ||
    soloFavoritos ||
    precioRange[0] !== precioMin ||
    precioRange[1] !== precioMax

  const clearFilters = () => {
    setSearch("")
    setCategoriaActiva(null)
    setSort("recomendados")
    setTagsActivos([])
    setSoloDisponibles(false)
    setSoloFavoritos(false)
    setPrecioRange([precioMin, precioMax])
  }

  const notifyAdded = (it: { nombre: string; imagen_url?: string | null }) => {
    toast.success(
      <div className="flex items-center gap-2.5 min-w-0">
        {it.imagen_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={it.imagen_url}
            alt=""
            className="h-10 w-10 rounded-md object-cover shrink-0"
          />
        ) : (
          <div className="h-10 w-10 rounded-md bg-muted flex items-center justify-center shrink-0">
            <Check className="h-5 w-5 text-muted-foreground" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-sm">Agregado al carrito</div>
          <div className="text-xs text-muted-foreground truncate">{it.nombre}</div>
        </div>
      </div>,
      {
        action: {
          label: "Ver carrito",
          onClick: () => setCartOpen(true),
        },
        duration: 3000,
      }
    )
  }

  const handleQuickAdd = (item: CatalogoData["items"][number]) => {
    if (item.precio == null) return
    // Si tiene variantes, abrir detalle en vez de quick-add (cliente debe elegir)
    if (item.variantes && item.variantes.length > 0) {
      openDetalle(item.id)
      return
    }
    cart.add({
      id: item.id,
      nombre: item.nombre,
      precio: Number(item.precio),
      imagen_url: item.imagen_url,
      stock_disponible: item.stock_disponible,
    })
    notifyAdded(item)
  }

  const shareUrl = typeof window !== "undefined" ? window.location.href : ""

  return (
    <div
      className="min-h-dvh bg-background"
      style={brandCssVars(data.config.color_primary) as CSSProperties}
    >
      <CatalogoHero
        bannerUrl={data.config.banner_url}
        logoUrl={data.organizacion.logo_url}
        titulo={titulo}
        descripcion={data.config.descripcion}
        whatsapp={data.config.whatsapp}
        brandColor={data.config.color_primary}
        shareUrl={shareUrl}
        trustBadges={data.config.trust_badges}
      />

      <CatalogoFilters
        search={search}
        onSearch={setSearch}
        catalogoSlug={data.config.slug}
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

      {/* Skip link para keyboard / screen reader users. */}
      <a
        href="#productos"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-background focus:px-3 focus:py-2 focus:shadow focus:ring-2"
      >
        Saltar al listado de productos
      </a>

      {/* Anuncia cantidad de resultados a screen readers cuando cambian filtros. */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {itemsFiltrados.length} {itemsFiltrados.length === 1 ? "resultado" : "resultados"}
      </div>

      <main id="productos" className="container mx-auto max-w-6xl px-4 py-6 pb-32 lg:pb-12" aria-label="Catálogo de productos">
        <div className="flex gap-6">
          <div className="flex-1 min-w-0">
            {/* Strip horizontal compacto vistos recientemente (sólo sin filtros) */}
            {itemsRecientes.length > 0 && !hasActiveFilters && (
              <section className="mb-5">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" />
                    Vistos recientemente
                  </h3>
                  <button
                    onClick={recientes.clear}
                    className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Limpiar
                  </button>
                </div>
                <div className="-mx-4 sm:mx-0 relative">
                  <div className="flex gap-2.5 overflow-x-auto px-4 sm:px-0 scrollbar-hide snap-x snap-mandatory pb-1">
                    {itemsRecientes.map((it) => (
                      <button
                        key={it.id}
                        onClick={() => openDetalle(it.id)}
                        className="snap-start shrink-0 w-32 text-left rounded-lg border bg-card overflow-hidden hover:shadow-md hover:border-foreground/20 transition group active:scale-95"
                      >
                        <div className="aspect-square bg-muted relative">
                          {it.imagen_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={it.imagen_url}
                              alt={it.nombre}
                              loading="lazy"
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                            />
                          ) : (
                            <CatalogoImagePlaceholder name={it.nombre} className="w-full h-full" />
                          )}
                        </div>
                        <div className="p-2">
                          <p className="text-[11px] font-medium line-clamp-1">{it.nombre}</p>
                          <p className="text-xs font-bold leading-none mt-1" style={{ color: data.config.color_primary }}>
                            {it.precio != null ? formatPrecio(Number(it.precio)) : "Consultar"}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                  <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-6 bg-gradient-to-l from-background to-transparent" />
                </div>
              </section>
            )}

            {(favoritos.count > 0 || soloFavoritos) && (
              <div className="flex items-center gap-2 mb-3">
                <button
                  onClick={() => setSoloFavoritos((v) => !v)}
                  className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-medium border transition-all active:scale-95 ${
                    soloFavoritos ? "text-white shadow-sm" : "bg-background hover:bg-muted"
                  }`}
                  style={
                    soloFavoritos
                      ? { backgroundColor: data.config.color_primary, borderColor: data.config.color_primary }
                      : undefined
                  }
                >
                  <Heart className={`h-3.5 w-3.5 ${soloFavoritos ? "fill-current" : ""}`} />
                  Favoritos ({favoritos.count})
                </button>
              </div>
            )}
            {itemsFiltrados.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <p className="mb-4 text-base">
                  {search.trim()
                    ? <>No encontramos <span className="font-medium text-foreground">"{search}"</span> en el catálogo.</>
                    : "No hay items que coincidan con esos filtros."}
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {hasActiveFilters && (
                    <Button variant="outline" size="sm" onClick={clearFilters}>
                      Limpiar filtros
                    </Button>
                  )}
                  {data.config.whatsapp && (
                    <Button
                      asChild
                      size="sm"
                      className="gap-1.5 text-white"
                      style={{ backgroundColor: data.config.color_primary }}
                    >
                      <a
                        href={`https://wa.me/${data.config.whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(
                          search.trim()
                            ? `Hola! Estoy buscando "${search.trim()}" pero no lo encuentro en el catálogo. ¿Tienen disponibilidad?`
                            : `Hola! ¿Pueden ayudarme a encontrar algo en el catálogo?`
                        )}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <WhatsAppIcon className="h-4 w-4" />
                        Consultar por WhatsApp
                      </a>
                    </Button>
                  )}
                </div>
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
                  {itemsFiltrados.map((item, idx) => (
                    <ItemCard
                      key={item.id}
                      item={item}
                      onClick={() => openDetalle(item.id)}
                      onQuickAdd={() => handleQuickAdd(item)}
                      formatPrecio={formatPrecio}
                      brandColor={data.config.color_primary}
                      isFav={favoritos.has(item.id)}
                      onToggleFav={() => favoritos.toggle(item.id)}
                      priority={idx < 4}
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
          notifyAdded(it)
          setDetalleId(null)
        }}
        formatPrecio={formatPrecio}
        brandColor={data.config.color_primary}
        whatsapp={data.config.whatsapp}
        slug={data.config.slug}
        relatedItems={data.items}
        onSelectRelated={(id) => openDetalle(id)}
        isFav={itemDetalle ? favoritos.has(itemDetalle.id) : false}
        onToggleFav={itemDetalle ? () => favoritos.toggle(itemDetalle.id) : () => {}}
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
