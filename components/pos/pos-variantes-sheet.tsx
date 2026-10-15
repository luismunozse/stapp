"use client"

import { useCallback, useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { useCurrency } from "@/contexts/currency-context"
import { cn } from "@/lib/utils"
import { PosVarianteMiniatura } from "./pos-variante-miniatura"
import type { InventarioResult } from "./pos-types"

export interface GrupoAbierto {
  grupoId: string
  nombre: string
}

interface Props {
  /** The group whose variants are listed; null keeps the sheet closed. */
  grupo: GrupoAbierto | null
  onClose: () => void
  /** Called with the CHOSEN CHILD (its own id, price and full name), never with the group. */
  onAdd: (producto: InventarioResult) => void
  /** Where focus goes once the sheet has closed (the search input), instead of the vanished card. */
  devolverFoco?: () => void
}

// A whole group in one page, in the selling deposito, including the variants with no stock
// (they are listed but cannot be picked).
const LIMITE_GRUPO = 100

export function urlDeGrupo(grupoId: string): string {
  const params = new URLSearchParams({
    q: "",
    grupoId,
    scope: "venta",
    includeZeroStock: "true",
    limit: String(LIMITE_GRUPO),
  })
  return `/api/inventario/search?${params.toString()}`
}

/**
 * Bottom sheet of the POS grouped card: one big row per variant (label, price, stock, photo). The
 * whole row is the tap target (>= 56px). A variant without stock is shown but disabled.
 */
export function PosVariantesSheet({ grupo, onClose, onAdd, devolverFoco }: Props) {
  const { formatPrice } = useCurrency()
  const [respuesta, setRespuesta] = useState<{ clave: string; filas: InventarioResult[] | null } | null>(null)
  const [intento, setIntento] = useState(0)
  // While the sheet slides out `grupo` is already null: keep drawing the last group so the title
  // and rows do not flash to "Variantes" / "Cargando variantes...".
  const [ultimo, setUltimo] = useState<GrupoAbierto | null>(null)
  if (grupo && grupo !== ultimo) setUltimo(grupo)
  const mostrado = grupo ?? ultimo
  const grupoId = grupo?.grupoId ?? null
  // The answer is keyed by (group, attempt): the rows of another group, or of a failed attempt, are
  // never shown as if they were the current ones, and no state is reset inside the effect.
  const clave = `${mostrado?.grupoId ?? null}#${intento}`
  const actual = respuesta?.clave === clave ? respuesta : null
  const filas = actual?.filas ?? null
  const fallo = actual !== null && actual.filas === null

  useEffect(() => {
    if (!grupoId) return
    let cancelado = false
    const controlador = new AbortController()
    fetch(urlDeGrupo(grupoId), { signal: controlador.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((data) => {
        if (!cancelado) setRespuesta({ clave, filas: Array.isArray(data) ? data : [] })
      })
      .catch(() => {
        if (!cancelado) setRespuesta({ clave, filas: null })
      })
    return () => {
      cancelado = true
      controlador.abort()
    }
  }, [grupoId, intento, clave])

  const elegir = useCallback(
    (fila: InventarioResult) => {
      onAdd(fila)
      onClose()
    },
    [onAdd, onClose]
  )

  return (
    <Sheet open={grupo !== null} onOpenChange={(abierto) => !abierto && onClose()}>
      <SheetContent
        side="bottom"
        onCloseAutoFocus={(e) => {
          // Radix would hand focus back to the card that opened the sheet, which is gone by now.
          e.preventDefault()
          devolverFoco?.()
        }}
        className="data-[state=open]:duration-200 data-[state=closed]:duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none motion-reduce:animate-none"
      >
        <SheetHeader>
          <SheetTitle>{mostrado?.nombre ?? "Variantes"}</SheetTitle>
          <SheetDescription>Elegí la variante que vas a vender.</SheetDescription>
        </SheetHeader>

        <div className="mt-3 space-y-2 pb-2">
          {fallo ? (
            <div className="space-y-3 py-4 text-center">
              <p className="text-sm text-muted-foreground">No pudimos cargar las variantes. Probá de nuevo.</p>
              <Button variant="outline" className="h-11" onClick={() => setIntento((n) => n + 1)}>
                Reintentar
              </Button>
            </div>
          ) : filas === null ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Cargando variantes...
            </div>
          ) : filas.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Este producto no tiene variantes para vender.</p>
          ) : (
            filas.map((fila) => {
              const etiqueta = fila.etiqueta || fila.nombre
              const sinStock = fila.stock <= 0
              return (
                <button
                  key={fila.id}
                  type="button"
                  disabled={sinStock}
                  onClick={() => elegir(fila)}
                  className={cn(
                    "flex min-h-14 w-full items-center gap-3 rounded-xl border bg-card p-2 text-left transition-colors active:scale-[0.98] hover:border-primary",
                    sinStock && "cursor-not-allowed bg-muted/40 hover:border-border active:scale-100"
                  )}
                >
                  <PosVarianteMiniatura etiqueta={etiqueta} imagenUrl={fila.imagenUrl} imagenRespaldo={fila.imagenRespaldo} />
                  <span className="min-w-0 flex-1">
                    <span className={cn("block truncate text-sm font-medium", sinStock && "text-muted-foreground")}>{etiqueta}</span>
                    <span className={cn("block text-sm font-bold", sinStock ? "text-muted-foreground" : "text-primary")}>{formatPrice(fila.precioVenta)}</span>
                  </span>
                  <span
                    className={cn(
                      "shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium",
                      fila.stock <= 3 ? "bg-destructive/10 text-destructive" : "bg-muted text-foreground"
                    )}
                  >
                    {sinStock ? "Sin stock" : `Stock: ${fila.stock}`}
                  </span>
                </button>
              )
            })
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
