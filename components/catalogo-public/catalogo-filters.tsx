"use client"

import Link from "next/link"
import Image from "next/image"
import { Search, SlidersHorizontal, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Slider } from "@/components/ui/slider"
import { useState } from "react"
import { CatalogoImagePlaceholder } from "./catalogo-image-placeholder"

export type SortOption = "recomendados" | "precio_asc" | "precio_desc" | "nombre_asc"

interface Categoria {
  id: string
  nombre: string
  slug: string | null
  imagen_url: string | null
}

interface Props {
  search: string
  onSearch: (s: string) => void
  catalogoSlug: string
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
  catalogoSlug,
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

  const activeAdvancedCount =
    (tagsActivos.length > 0 ? 1 : 0) +
    (soloDisponibles ? 1 : 0) +
    (precioRange[0] !== precioMin || precioRange[1] !== precioMax ? 1 : 0) +
    (sort !== "recomendados" ? 1 : 0)

  return (
    <div className="sticky top-0 z-30 bg-background/95 backdrop-blur border-b shadow-sm">
      <div className="container mx-auto max-w-5xl px-4 py-3 space-y-2">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              type="search"
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Buscar productos o servicios..."
              className="pl-9 pr-10 h-11"
            />
            {search.length > 0 && (
              <button
                type="button"
                onClick={() => onSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 rounded-full hover:bg-muted inline-flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Limpiar búsqueda"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <select
            value={sort}
            onChange={(e) => onSort(e.target.value as SortOption)}
            className="h-11 rounded-md border bg-background px-3 text-sm hidden sm:block"
            aria-label="Ordenar"
          >
            <option value="recomendados">Recomendados</option>
            <option value="precio_asc">Precio: menor a mayor</option>
            <option value="precio_desc">Precio: mayor a menor</option>
            <option value="nombre_asc">Nombre A-Z</option>
          </select>
          <Button
            variant={activeAdvancedCount > 0 ? "default" : "outline"}
            size="icon"
            onClick={() => setAdvancedOpen((o) => !o)}
            aria-label="Filtros avanzados"
            className="relative h-11 w-11 shrink-0"
          >
            <SlidersHorizontal className="h-4 w-4" />
            {activeAdvancedCount > 0 && (
              <span
                className="absolute -top-1 -right-1 h-5 min-w-5 px-1 inline-flex items-center justify-center rounded-full bg-rose-500 text-white text-[10px] font-bold leading-none"
                style={{ backgroundColor: brandColor }}
              >
                {activeAdvancedCount}
              </span>
            )}
          </Button>
        </div>

        {categorias.length > 0 && (
          <div className="relative -mx-4 sm:mx-0">
            <div
              className="flex gap-2 overflow-x-auto pb-1 px-4 sm:px-0 scrollbar-hide snap-x snap-mandatory"
              style={{ scrollbarWidth: "none" }}
            >
            <Link
              href={`/catalogo/${catalogoSlug}`}
              prefetch={false}
              onClick={(e) => {
                if (categoriaActiva !== null) {
                  e.preventDefault()
                  onCategoria(null)
                }
              }}
              aria-current={categoriaActiva === null ? "true" : undefined}
              className="snap-start shrink-0 flex flex-col items-center gap-1.5 w-[64px] group/cat"
            >
              <span
                className={`h-[60px] w-[60px] rounded-full flex items-center justify-center font-display text-[11px] font-extrabold transition-all ${
                  categoriaActiva === null
                    ? "bg-brand text-brand-foreground shadow-brand"
                    : "bg-cat-chip text-cat-ink border-[1.5px] border-cat-border group-hover/cat:border-cat-ink"
                }`}
              >
                Todo
              </span>
              <span
                className={`text-[11px] leading-tight text-center truncate w-full ${
                  categoriaActiva === null ? "font-bold text-cat-ink" : "text-cat-muted"
                }`}
              >
                Todos
              </span>
            </Link>
            {categorias.map((cat) => {
              const active = categoriaActiva === cat.id
              const href = cat.slug ? `/catalogo/${catalogoSlug}/c/${cat.slug}` : `/catalogo/${catalogoSlug}`
              return (
                <Link
                  key={cat.id}
                  href={href}
                  prefetch={false}
                  onClick={(e) => {
                    if (!cat.slug) {
                      e.preventDefault()
                      onCategoria(cat.id)
                    }
                  }}
                  aria-current={active ? "true" : undefined}
                  className="snap-start shrink-0 flex flex-col items-center gap-1.5 w-[64px] group/cat"
                >
                  <span
                    className={`relative h-[60px] w-[60px] rounded-full overflow-hidden transition-all ${
                      active
                        ? "ring-[2.5px] ring-[var(--brand)] ring-offset-2 ring-offset-cat-bg shadow-brand"
                        : "border-[1.5px] border-cat-border group-hover/cat:border-cat-ink"
                    }`}
                  >
                    {cat.imagen_url ? (
                      <Image
                        src={cat.imagen_url}
                        alt={cat.nombre}
                        fill
                        sizes="60px"
                        className="object-cover rounded-full"
                      />
                    ) : (
                      <CatalogoImagePlaceholder name={cat.nombre} className="h-full w-full" />
                    )}
                  </span>
                  <span
                    className={`text-[11px] leading-tight text-center truncate w-full ${
                      active ? "font-bold text-cat-ink" : "text-cat-muted"
                    }`}
                  >
                    {cat.nombre}
                  </span>
                </Link>
              )
            })}
            </div>
            {/* Fade edges para indicar scroll horizontal */}
            <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-6 sm:w-4 bg-gradient-to-r from-background/95 to-transparent" />
            <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-6 sm:w-4 bg-gradient-to-l from-background/95 to-transparent" />
          </div>
        )}

        {/* Desktop: inline collapsible panel */}
        <div
          className={`hidden sm:grid transition-[grid-template-rows,opacity] duration-200 ${
            advancedOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
          }`}
        >
          <div className="overflow-hidden">
            <FiltrosAvanzadosContent
              sort={sort}
              onSort={onSort}
              soloDisponibles={soloDisponibles}
              onSoloDisponibles={onSoloDisponibles}
              precioMin={precioMin}
              precioMax={precioMax}
              precioRange={precioRange}
              onPrecioRange={onPrecioRange}
              tags={tags}
              tagsActivos={tagsActivos}
              onToggleTag={onToggleTag}
              brandColor={brandColor}
              formatPrecio={formatPrecio}
              hasActiveFilters={hasActiveFilters}
              onClearFilters={onClearFilters}
              hideSort={true}
            />
          </div>
        </div>
      </div>

      {/* Mobile: bottom sheet */}
      <Sheet open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <SheetContent side="bottom" className="sm:hidden">
          <SheetHeader className="px-4 pb-2">
            <SheetTitle className="flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4" />
              Filtros
              {activeAdvancedCount > 0 && (
                <span
                  className="inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full text-[11px] font-bold text-white"
                  style={{ backgroundColor: brandColor }}
                >
                  {activeAdvancedCount}
                </span>
              )}
            </SheetTitle>
          </SheetHeader>
          <div className="px-4 pb-4">
            <FiltrosAvanzadosContent
              sort={sort}
              onSort={onSort}
              soloDisponibles={soloDisponibles}
              onSoloDisponibles={onSoloDisponibles}
              precioMin={precioMin}
              precioMax={precioMax}
              precioRange={precioRange}
              onPrecioRange={onPrecioRange}
              tags={tags}
              tagsActivos={tagsActivos}
              onToggleTag={onToggleTag}
              brandColor={brandColor}
              formatPrecio={formatPrecio}
              hasActiveFilters={hasActiveFilters}
              onClearFilters={onClearFilters}
              hideSort={false}
              noBg
            />
            <div className="pt-3 mt-3 border-t flex gap-2">
              {hasActiveFilters && (
                <Button variant="outline" onClick={onClearFilters} className="flex-1 gap-1.5">
                  <X className="h-4 w-4" />
                  Limpiar
                </Button>
              )}
              <Button
                onClick={() => setAdvancedOpen(false)}
                className="flex-1 text-white"
                style={{ backgroundColor: brandColor }}
              >
                Ver resultados
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}

function FiltrosAvanzadosContent({
  sort, onSort, soloDisponibles, onSoloDisponibles,
  precioMin, precioMax, precioRange, onPrecioRange,
  tags, tagsActivos, onToggleTag,
  brandColor, formatPrecio, hasActiveFilters, onClearFilters,
  hideSort, noBg,
}: {
  sort: SortOption
  onSort: (s: SortOption) => void
  soloDisponibles: boolean
  onSoloDisponibles: (b: boolean) => void
  precioMin: number
  precioMax: number
  precioRange: [number, number]
  onPrecioRange: (r: [number, number]) => void
  tags: string[]
  tagsActivos: string[]
  onToggleTag: (tag: string) => void
  brandColor: string
  formatPrecio: (n: number) => string
  hasActiveFilters: boolean
  onClearFilters: () => void
  hideSort?: boolean
  noBg?: boolean
}) {
  return (
    <div className={`${noBg ? "" : "rounded-xl border bg-muted/30 mt-1"} p-4 space-y-4`}>
      {!hideSort && (
        <div>
          <div className="text-sm font-medium mb-1.5">Ordenar por</div>
          <select
            value={sort}
            onChange={(e) => onSort(e.target.value as SortOption)}
            className="h-11 w-full rounded-md border bg-background px-3 text-sm"
            aria-label="Ordenar"
          >
            <option value="recomendados">Recomendados</option>
            <option value="precio_asc">Precio: menor a mayor</option>
            <option value="precio_desc">Precio: mayor a menor</option>
            <option value="nombre_asc">Nombre A-Z</option>
          </select>
        </div>
      )}

      <label className="flex items-center gap-2.5 text-sm cursor-pointer select-none">
        <input
          type="checkbox"
          checked={soloDisponibles}
          onChange={(e) => onSoloDisponibles(e.target.checked)}
          className="h-5 w-5 rounded"
          style={{ accentColor: brandColor }}
        />
        <span className="font-medium">Solo items disponibles</span>
      </label>

      {precioMax > precioMin && (
        <div>
          <div className="flex items-center justify-between text-sm mb-3">
            <span className="font-medium">Rango de precio</span>
            <span className="text-muted-foreground text-xs tabular-nums">
              {formatPrecio(precioRange[0])} – {formatPrecio(precioRange[1])}
            </span>
          </div>
          <div className="px-1.5 pb-1" style={{ color: brandColor }}>
            <Slider
              min={precioMin}
              max={precioMax}
              step={Math.max(1, Math.round((precioMax - precioMin) / 100))}
              value={[precioRange[0], precioRange[1]]}
              onValueChange={(v) => {
                if (v.length === 2) onPrecioRange([v[0], v[1]])
              }}
              minStepsBetweenThumbs={1}
            />
          </div>
          <div className="flex items-center justify-between text-[10px] text-muted-foreground mt-1 tabular-nums px-1">
            <span>{formatPrecio(precioMin)}</span>
            <span>{formatPrecio(precioMax)}</span>
          </div>
        </div>
      )}

      {tags.length > 0 && (
        <div>
          <div className="text-sm font-medium mb-2">Etiquetas</div>
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => {
              const active = tagsActivos.includes(tag)
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => onToggleTag(tag)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all border active:scale-95 ${
                    active
                      ? "text-white shadow-sm"
                      : "bg-background hover:bg-muted hover:border-foreground/20"
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

      {hasActiveFilters && hideSort && (
        <Button
          variant="outline"
          size="sm"
          onClick={onClearFilters}
          className="gap-1.5"
        >
          <X className="h-3 w-3" />
          Limpiar filtros
        </Button>
      )}
    </div>
  )
}
