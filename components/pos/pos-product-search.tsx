"use client"

import { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Search, Package, Loader2, Plus, Barcode } from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"
import type { InventarioResult } from "./pos-types"

interface PosProductSearchProps {
  onAddProduct: (product: InventarioResult) => void
}

export interface PosProductSearchRef {
  focusSearch: () => void
}

export const PosProductSearch = forwardRef<PosProductSearchRef, PosProductSearchProps>(
  function PosProductSearch({ onAddProduct }, ref) {
    const { formatPrice } = useCurrency()
    const inputRef = useRef<HTMLInputElement>(null)
    const [query, setQuery] = useState("")
    const [results, setResults] = useState<InventarioResult[]>([])
    const [loading, setLoading] = useState(false)
    const [recentProducts, setRecentProducts] = useState<InventarioResult[]>([])
    const [initialLoad, setInitialLoad] = useState(true)

    useImperativeHandle(ref, () => ({
      focusSearch: () => {
        inputRef.current?.focus()
        inputRef.current?.select()
      },
    }))

    // Load initial/popular products
    useEffect(() => {
      const loadInitial = async () => {
        try {
          const res = await fetch("/api/inventario/search?q=&limit=20")
          const data = await res.json()
          if (Array.isArray(data)) {
            setRecentProducts(data)
          }
        } catch {
          // ignore
        } finally {
          setInitialLoad(false)
        }
      }
      loadInitial()
    }, [])

    // Debounced search
    useEffect(() => {
      if (!query.trim()) {
        setResults([])
        return
      }

      const timer = setTimeout(async () => {
        setLoading(true)
        try {
          const res = await fetch(`/api/inventario/search?q=${encodeURIComponent(query)}&limit=20`)
          const data = await res.json()
          setResults(Array.isArray(data) ? data : [])
        } catch {
          setResults([])
        } finally {
          setLoading(false)
        }
      }, 200)

      return () => clearTimeout(timer)
    }, [query])

    const handleAdd = useCallback((product: InventarioResult) => {
      onAddProduct(product)
      setQuery("")
      setResults([])
      inputRef.current?.focus()
    }, [onAddProduct])

    // Handle barcode scan in the input itself (fast typing + Enter)
    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && results.length === 1) {
        e.preventDefault()
        handleAdd(results[0])
      }
      if (e.key === "Enter" && results.length === 0 && query.trim()) {
        // Could be a barcode - search will handle it
      }
    }

    const displayProducts = query.trim() ? results : recentProducts

    return (
      <div className="flex flex-col h-full">
        {/* Search bar */}
        <div className="p-3 border-b bg-background sticky top-0 z-10">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Buscar producto o escanear código de barras..."
              className="pl-10 pr-10 h-12 text-lg"
              autoFocus
            />
            {loading && (
              <Loader2 className="absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 animate-spin text-muted-foreground" />
            )}
            {!loading && query && (
              <Barcode className="absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground/40" />
            )}
          </div>
          {!query.trim() && (
            <p className="text-xs text-muted-foreground mt-1.5 px-1">
              Productos disponibles en stock
            </p>
          )}
          {query.trim() && !loading && (
            <p className="text-xs text-muted-foreground mt-1.5 px-1">
              {results.length} resultado{results.length !== 1 ? "s" : ""}
              {results.length === 1 && " — Enter para agregar"}
            </p>
          )}
        </div>

        {/* Product grid */}
        <div className="flex-1 overflow-y-auto p-3">
          {initialLoad ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="h-24 rounded-lg bg-muted animate-pulse" />
              ))}
            </div>
          ) : displayProducts.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground py-12">
              <Package className="h-12 w-12 mb-3 opacity-30" />
              <p className="text-sm">
                {query.trim() ? "No se encontraron productos" : "Sin productos en inventario"}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {displayProducts.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => handleAdd(product)}
                  className="group relative flex flex-col items-start rounded-lg border bg-card p-3 text-left transition-all hover:border-primary hover:shadow-md active:scale-[0.98]"
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <Package className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-[10px] font-mono text-muted-foreground truncate">
                      {product.codigo}
                    </span>
                  </div>
                  <span className="text-sm font-medium line-clamp-2 leading-tight mb-auto">
                    {product.nombre}
                  </span>
                  <div className="flex items-center justify-between w-full mt-2">
                    <span className="text-base font-bold text-primary">
                      {formatPrice(product.precioVenta)}
                    </span>
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                      product.stock <= 3
                        ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400"
                        : "bg-muted text-muted-foreground"
                    }`}>
                      Stock: {product.stock}
                    </span>
                  </div>
                  {/* Quick add overlay */}
                  <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-primary/5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                    <div className="bg-primary text-primary-foreground rounded-full p-1.5">
                      <Plus className="h-4 w-4" />
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }
)
