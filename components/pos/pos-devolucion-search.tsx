"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import { Search, Loader2, RotateCcw, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { EmptyState } from "@/components/ui/empty-state"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
} from "@/components/ui/responsive-dialog"
import { cn } from "@/lib/utils"
import { useCurrency } from "@/contexts/currency-context"

// Shape that DevolucionForm expects
export interface VentaForDevolucion {
  id: string
  numeroVenta: number
  items: Array<{
    id: string
    inventarioId: string | null
    descripcion: string
    cantidad: number
    precioUnitario: number
  }>
}

// Raw venta shape returned by GET /api/ventas
interface VentaFromApi {
  id: string
  numeroVenta: number
  estado: string
  clienteNombre?: string | null
  total: number
  items: Array<{
    id: string
    inventarioId?: string | null
    descripcion: string
    cantidad: number
    precioUnitario: number
    [key: string]: unknown
  }>
  [key: string]: unknown
}

interface PosDevolucionSearchProps {
  open: boolean
  onClose: () => void
  onVentaFound: (venta: VentaForDevolucion) => void
}

function mapVenta(v: VentaFromApi): VentaForDevolucion {
  return {
    id: v.id,
    numeroVenta: v.numeroVenta,
    items: v.items.map((i) => ({
      id: i.id,
      inventarioId: i.inventarioId ?? null,
      descripcion: i.descripcion,
      cantidad: i.cantidad,
      precioUnitario: i.precioUnitario,
    })),
  }
}

export function PosDevolucionSearch({ open, onClose, onVentaFound }: PosDevolucionSearchProps) {
  const { formatPrice } = useCurrency()
  const [numero, setNumero] = useState("")
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<VentaFromApi[] | null>(null)
  const [searched, setSearched] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (open) {
      setNumero("")
      setResults(null)
      setSearched(false)
      // Focus input after animation
      const t = setTimeout(() => inputRef.current?.focus(), 80)
      return () => clearTimeout(t)
    }
  }, [open])

  const handleSearch = useCallback(async () => {
    const q = numero.trim()
    if (!q) return
    setLoading(true)
    setSearched(true)
    try {
      const res = await fetch(`/api/ventas?search=${encodeURIComponent(q)}&limit=5`)
      if (!res.ok) throw new Error("error")
      const json = await res.json()
      setResults(json.data ?? [])
    } catch {
      setResults([])
    } finally {
      setLoading(false)
    }
  }, [numero])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleSearch()
  }

  const handleSelect = (v: VentaFromApi) => {
    onVentaFound(mapVenta(v))
  }

  // Exact match by number (if user typed a pure number)
  const exactMatch =
    results !== null && /^\d+$/.test(numero.trim())
      ? results.find((v) => v.numeroVenta === Number(numero.trim()))
      : undefined

  // If there's an exact match, auto-select only if it's returnable — otherwise surface it with a warning
  useEffect(() => {
    if (exactMatch && exactMatch.estado !== "ANULADA") {
      onVentaFound(mapVenta(exactMatch))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exactMatch])

  const renderResultRow = (v: VentaFromApi) => {
    const isAnulada = v.estado === "ANULADA"
    return (
      <button
        key={v.id}
        type="button"
        disabled={isAnulada}
        onClick={() => !isAnulada && handleSelect(v)}
        className={cn(
          "w-full flex items-center justify-between rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
          isAnulada
            ? "cursor-not-allowed opacity-50 bg-muted"
            : "hover:bg-accent hover:text-accent-foreground cursor-pointer"
        )}
      >
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">
            Venta #{String(v.numeroVenta).padStart(4, "0")}
            {isAnulada && (
              <span className="ml-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
                <AlertTriangle className="h-3 w-3" />
                Anulada — no se puede devolver
              </span>
            )}
          </span>
          {v.clienteNombre && (
            <span className="text-xs text-muted-foreground">{v.clienteNombre}</span>
          )}
        </div>
        <span className="shrink-0 font-semibold">{formatPrice(v.total)}</span>
      </button>
    )
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={(o) => !o && onClose()}>
      <ResponsiveDialogContent hideHandle={false} className="sm:max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2">
            <RotateCcw className="h-4 w-4" />
            Buscar venta para devolución
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Ingresá el número de venta para procesar una devolución.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="flex gap-2 mt-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              ref={inputRef}
              type="text"
              inputMode="numeric"
              placeholder="Número de venta (ej: 42)"
              value={numero}
              onChange={(e) => {
                setNumero(e.target.value)
                // Clear previous results when the user edits the query
                if (searched) {
                  setResults(null)
                  setSearched(false)
                }
              }}
              onKeyDown={handleKeyDown}
              className="pl-9"
              autoComplete="off"
            />
          </div>
          <Button onClick={handleSearch} disabled={loading || !numero.trim()}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Buscar"}
          </Button>
        </div>

        {/* Results area */}
        <div className="mt-2 min-h-[80px]">
          {loading && (
            <div className="flex items-center justify-center py-8 text-muted-foreground text-sm gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Buscando...
            </div>
          )}

          {!loading && searched && results !== null && results.length === 0 && (
            <EmptyState
              icon={Search}
              variant="search"
              title="No se encontró ninguna venta"
              description={`No hay ventas que coincidan con "${numero}".`}
              className="py-6"
            />
          )}

          {!loading && results !== null && results.length > 0 && (
            <div className="flex flex-col gap-2">
              {/* If exact match was anulada, show a single warning row instead of auto-selecting */}
              {exactMatch && exactMatch.estado === "ANULADA"
                ? renderResultRow(exactMatch)
                : results
                    .filter((v) => !exactMatch || v.id !== exactMatch.id)
                    .map((v) => renderResultRow(v))}
            </div>
          )}
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
