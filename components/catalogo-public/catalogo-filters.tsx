"use client"

import { Search, SlidersHorizontal, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useState } from "react"

export type SortOption = "recomendados" | "precio_asc" | "precio_desc" | "nombre_asc"

interface Categoria {
  id: string
  nombre: string
}

interface Props {
  search: string
  onSearch: (s: string) => void
  categorias: Categoria[]
  categoriaActiva: string | null
  onCategoria: (id: string | null) => void
  sort: SortOption
  onSort: (s: SortOption) => void
  tags: string[]
  tagsActivos: string[]
  onToggleTag: (tag: string) => void
  precioMin: number
  precioMax: number
  precioRange: [number, number]
  onPrecioRange: (r: [number, number]) => void
  soloDisponibles: boolean
  onSoloDisponibles: (b: boolean) => void
  brandColor: string
  formatPrecio: (n: number) => string
  hasActiveFilters: boolean
  onClearFilters: () => void
}

export function CatalogoFilters({
  search,
  onSearch,
  categorias,
  categoriaActiva,
  onCategoria,
  sort,
  onSort,
  tags,
  tagsActivos,
  onToggleTag,
  precioMin,
  precioMax,
  precioRange,
  onPrecioRange,
  soloDisponibles,
  onSoloDisponibles,
  brandColor,
  formatPrecio,
  hasActiveFilters,
  onClearFilters,
}: Props) {
  const [advancedOpen, setAdvancedOpen] = useState(false)

  return (
    <div className="sticky top-0 z-30 bg-background/95 backdrop-blur border-b shadow-sm">
      <div className="container mx-auto max-w-5xl px-4 py-3 space-y-2">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Buscar..."
              className="pl-9"
            />
          </div>
          <select
            value={sort}
            onChange={(e) => onSort(e.target.value as SortOption)}
            className="h-10 rounded-md border bg-background px-3 text-sm hidden sm:block"
            aria-label="Ordenar"
          >
            <option value="recomendados">Recomendados</option>
            <option value="precio_asc">Precio: menor a mayor</option>
            <option value="precio_desc">Precio: mayor a menor</option>
            <option value="nombre_asc">Nombre A-Z</option>
          </select>
          <Button
            variant={advancedOpen || tagsActivos.length > 0 || soloDisponibles ? "default" : "outline"}
            size="icon"
            onClick={() => setAdvancedOpen((o) => !o)}
            aria-label="Filtros avanzados"
          >
            <SlidersHorizontal className="h-4 w-4" />
          </Button>
        </div>

        {categorias.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
            <button
              onClick={() => onCategoria(null)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-sm transition-colors border ${
                categoriaActiva === null
                  ? "text-white"
                  : "bg-background hover:bg-muted"
              }`}
              style={categoriaActiva === null ? { backgroundColor: brandColor, borderColor: brandColor } : undefined}
            >
              Todos
            </button>
            {categorias.map((cat) => {
              const active = categoriaActiva === cat.id
              return (
                <button
                  key={cat.id}
                  onClick={() => onCategoria(cat.id)}
                  className={`shrink-0 px-3 py-1.5 rounded-full text-sm transition-colors border ${
                    active ? "text-white" : "bg-background hover:bg-muted"
                  }`}
                  style={active ? { backgroundColor: brandColor, borderColor: brandColor } : undefined}
                >
                  {cat.nombre}
                </button>
              )
            })}
          </div>
        )}

        {advancedOpen && (
          <div className="rounded-lg border bg-muted/30 p-3 space-y-3">
            <select
              value={sort}
              onChange={(e) => onSort(e.target.value as SortOption)}
              className="h-10 w-full rounded-md border bg-background px-3 text-sm sm:hidden"
              aria-label="Ordenar"
            >
              <option value="recomendados">Recomendados</option>
              <option value="precio_asc">Precio: menor a mayor</option>
              <option value="precio_desc">Precio: mayor a menor</option>
              <option value="nombre_asc">Nombre A-Z</option>
            </select>

            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={soloDisponibles}
                onChange={(e) => onSoloDisponibles(e.target.checked)}
                className="h-4 w-4 rounded"
              />
              Solo items disponibles
            </label>

            {precioMax > precioMin && (
              <div>
                <div className="flex items-center justify-between text-sm mb-1.5">
                  <span className="font-medium">Rango de precio</span>
                  <span className="text-muted-foreground text-xs">
                    {formatPrecio(precioRange[0])} – {formatPrecio(precioRange[1])}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={precioMin}
                    max={precioMax}
                    value={precioRange[0]}
                    onChange={(e) => onPrecioRange([Math.min(Number(e.target.value), precioRange[1]), precioRange[1]])}
                    className="flex-1 accent-current"
                    style={{ color: brandColor }}
                  />
                  <input
                    type="range"
                    min={precioMin}
                    max={precioMax}
                    value={precioRange[1]}
                    onChange={(e) => onPrecioRange([precioRange[0], Math.max(Number(e.target.value), precioRange[0])])}
                    className="flex-1 accent-current"
                    style={{ color: brandColor }}
                  />
                </div>
              </div>
            )}

            {tags.length > 0 && (
              <div>
                <div className="text-sm font-medium mb-1.5">Etiquetas</div>
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((tag) => {
                    const active = tagsActivos.includes(tag)
                    return (
                      <button
                        key={tag}
                        onClick={() => onToggleTag(tag)}
                        className={`px-2.5 py-1 rounded-full text-xs transition-colors border ${
                          active ? "text-white" : "bg-background hover:bg-muted"
                        }`}
                        style={active ? { backgroundColor: brandColor, borderColor: brandColor } : undefined}
                      >
                        {tag}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={onClearFilters} className="gap-1.5 text-muted-foreground">
                <X className="h-3 w-3" />
                Limpiar filtros
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
