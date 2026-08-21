"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Loader2, PackageSearch, Search, X } from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"

export interface InventarioOption {
  id: string
  codigo: string
  nombre: string
  stock: number
  stockReservado: number
  precioCompra: number
  categoria?: string | null
  ubicacion?: string | null
  barcode?: string | null
}

interface InventarioSearchComboboxProps {
  value: InventarioOption | null
  onChange: (item: InventarioOption | null) => void
  disabled?: boolean
  /** Cuantos resultados pedir por consulta. */
  limit?: number
  /** Bump this number to force a refetch (p.ej. despues de mover stock). */
  refreshKey?: number
  /** Bump this number para devolverle el foco al input desde el padre
   *  (carga en lote: tras agregar uno, el cursor vuelve al buscador). */
  focusSignal?: number
  placeholder?: string
  emptyHint?: string
}

const DEBOUNCE_MS = 250

/** Stock realmente usable: el RPC add_repuesto_inventario valida
 *  stock - stock_reservado, asi que la UI muestra el mismo numero. */
export function disponibleDe(item: Pick<InventarioOption, "stock" | "stockReservado">) {
  return (item.stock ?? 0) - (item.stockReservado ?? 0)
}

/**
 * Type-ahead contra /api/inventario. Reemplaza al <Select> que solo cargaba
 * la primera pagina del inventario: aca cada tecla consulta al servidor, asi
 * que el catalogo completo queda alcanzable sin importar cuantos items haya.
 */
export function InventarioSearchCombobox({
  value,
  onChange,
  disabled = false,
  limit = 20,
  refreshKey = 0,
  focusSignal = 0,
  placeholder = "Buscar por nombre, código o código de barras...",
  emptyHint = "Probá con otro término o cargalo como repuesto manual.",
}: InventarioSearchComboboxProps) {
  const { formatPrice } = useCurrency()
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<InventarioOption[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const [error, setError] = useState("")

  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  // Descarta respuestas viejas que llegan fuera de orden.
  const requestSeq = useRef(0)

  const buscar = useCallback(
    async (term: string) => {
      const seq = ++requestSeq.current
      setLoading(true)
      setError("")
      try {
        const params = new URLSearchParams({ limit: String(limit) })
        if (term) params.set("search", term)
        const res = await fetch(`/api/inventario?${params.toString()}`, { cache: "no-store" })
        if (!res.ok) throw new Error("No se pudo buscar en el inventario")
        const json = await res.json()
        if (seq !== requestSeq.current) return
        const rows = (json.data ?? (Array.isArray(json) ? json : [])) as any[]
        setResults(
          rows.map((r) => ({
            id: r.id,
            codigo: r.codigo ?? "",
            nombre: r.nombre ?? "",
            stock: Number(r.stock ?? 0),
            stockReservado: Number(r.stockReservado ?? 0),
            precioCompra: Number(r.precioCompra ?? 0),
            categoria: r.categoria ?? null,
            ubicacion: r.ubicacion ?? null,
            barcode: r.barcode ?? null,
          }))
        )
        setHighlight(0)
      } catch (e) {
        if (seq !== requestSeq.current) return
        setResults([])
        setError(e instanceof Error ? e.message : "No se pudo buscar en el inventario")
      } finally {
        if (seq === requestSeq.current) setLoading(false)
      }
    },
    [limit]
  )

  // Debounce: la lista inicial (query vacio) tambien se pide, para que el
  // panel sea navegable sin escribir nada.
  useEffect(() => {
    if (!open) return
    const t = window.setTimeout(() => buscar(query.trim()), query ? DEBOUNCE_MS : 0)
    return () => window.clearTimeout(t)
  }, [query, open, buscar, refreshKey])

  // Cerrar al clickear fuera.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onPointerDown)
    document.addEventListener("touchstart", onPointerDown)
    return () => {
      document.removeEventListener("mousedown", onPointerDown)
      document.removeEventListener("touchstart", onPointerDown)
    }
  }, [open])

  const seleccionables = useMemo(
    () => results.filter((r) => disponibleDe(r) > 0),
    [results]
  )

  const seleccionar = (item: InventarioOption) => {
    if (disponibleDe(item) <= 0) return
    onChange(item)
    setOpen(false)
    setQuery("")
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault()
      if (!open) {
        setOpen(true)
        return
      }
      if (!results.length) return
      setHighlight((h) => {
        const next = e.key === "ArrowDown" ? h + 1 : h - 1
        return (next + results.length) % results.length
      })
      return
    }
    if (e.key === "Enter") {
      e.preventDefault()
      if (!open) {
        setOpen(true)
        return
      }
      const target = results[highlight]
      // Lector de código de barras: escribe rápido y manda Enter. Si el
      // término dejó un único item con stock, se selecciona ese aunque el
      // highlight no haya alcanzado a moverse.
      if (target && disponibleDe(target) > 0) seleccionar(target)
      else if (seleccionables.length === 1) seleccionar(seleccionables[0])
      return
    }
    if (e.key === "Escape") {
      setOpen(false)
    }
  }

  // Mantener visible el item resaltado al navegar con el teclado.
  // scrollIntoView no existe en todos los entornos de render (jsdom, algunos
  // webviews), y es puro confort visual: si no está, no debe romper la lista.
  useEffect(() => {
    if (!open) return
    const node = listRef.current?.children[highlight] as HTMLElement | undefined
    if (typeof node?.scrollIntoView === "function") {
      node.scrollIntoView({ block: "nearest" })
    }
  }, [highlight, open])

  // El padre pide el foco (carga en lote). No corre en el montaje inicial:
  // abrir el panel no debe robarle el foco al resto de la pantalla.
  useEffect(() => {
    if (focusSignal > 0) inputRef.current?.focus()
  }, [focusSignal])

  if (value) {
    const disponible = disponibleDe(value)
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border bg-background p-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{value.nombre}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            {value.codigo && <span className="font-mono">{value.codigo}</span>}
            <span>Disponible: {disponible}</span>
            <span>Costo: {formatPrice(value.precioCompra)}</span>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          disabled={disabled}
          aria-label="Cambiar repuesto"
          onClick={() => {
            onChange(null)
            setQuery("")
            setOpen(true)
            requestAnimationFrame(() => inputRef.current?.focus())
          }}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          aria-controls="inventario-combobox-list"
          autoComplete="off"
          className="pl-9 pr-9"
          placeholder={placeholder}
          value={query}
          disabled={disabled}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onKeyDown={onKeyDown}
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>

      {open && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-lg border bg-popover shadow-md">
          {error ? (
            <div className="p-3 text-sm text-destructive">{error}</div>
          ) : loading && !results.length ? (
            <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Buscando...
            </div>
          ) : !results.length ? (
            <div className="p-4 text-center">
              <PackageSearch className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />
              <p className="text-sm font-medium">Sin resultados</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{emptyHint}</p>
            </div>
          ) : (
            <ul
              ref={listRef}
              id="inventario-combobox-list"
              role="listbox"
              className="max-h-72 overflow-y-auto py-1"
            >
              {results.map((item, i) => {
                const disponible = disponibleDe(item)
                const sinStock = disponible <= 0
                return (
                  <li
                    key={item.id}
                    role="option"
                    aria-selected={i === highlight}
                    aria-disabled={sinStock}
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => seleccionar(item)}
                    className={[
                      "flex items-center justify-between gap-3 px-3 py-2",
                      sinStock ? "cursor-not-allowed opacity-60" : "cursor-pointer",
                      i === highlight && !sinStock ? "bg-accent" : "",
                    ].join(" ")}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{item.nombre}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                        {item.codigo && <span className="font-mono">{item.codigo}</span>}
                        {item.categoria && <span>{item.categoria}</span>}
                        {item.ubicacion && <span>📍 {item.ubicacion}</span>}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-sm font-medium">{formatPrice(item.precioCompra)}</div>
                      <div
                        className={[
                          "text-xs",
                          sinStock
                            ? "text-destructive"
                            : disponible <= 3
                              ? "text-amber-600 dark:text-amber-500"
                              : "text-muted-foreground",
                        ].join(" ")}
                      >
                        {sinStock ? "Sin stock" : `${disponible} disp.`}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
