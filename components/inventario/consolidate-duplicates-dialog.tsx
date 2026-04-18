"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Loader2, AlertTriangle, ArrowRight, Package } from "lucide-react"
import type { Inventario } from "@/types"
import { useCurrency } from "@/contexts/currency-context"

interface ConsolidateDuplicatesDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  group: Inventario[]
  onSuccess: () => void
}

// Merge de duplicados: el usuario elige cuál es el item canónico (destino),
// el resto se archiva y su stock pasa al destino vía RPC atómica.
export function ConsolidateDuplicatesDialog({
  open,
  onOpenChange,
  group,
  onSuccess,
}: ConsolidateDuplicatesDialogProps) {
  const { formatPrice } = useCurrency()
  const [targetId, setTargetId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  const candidates = group.filter((g) => !g.deletedAt)
  const sources = targetId ? candidates.filter((c) => c.id !== targetId) : []
  const totalStockToMove = sources.reduce((acc, s) => acc + (s.stock || 0), 0)
  const target = candidates.find((c) => c.id === targetId) || null

  const handleConfirm = async () => {
    if (!targetId || sources.length === 0) return
    setLoading(true)
    setProgress({ done: 0, total: sources.length })
    try {
      for (let i = 0; i < sources.length; i++) {
        const s = sources[i]
        const res = await fetch("/api/inventario/consolidate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sourceId: s.id, targetId }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.error || `Error consolidando ${s.codigo}`)
        }
        setProgress({ done: i + 1, total: sources.length })
      }
      onSuccess()
      onOpenChange(false)
      setTargetId(null)
    } catch (err) {
      console.error("Error consolidando:", err)
      alert(err instanceof Error ? err.message : "Error al consolidar")
    } finally {
      setLoading(false)
      setProgress(null)
    }
  }

  const handleClose = (next: boolean) => {
    if (loading) return
    if (!next) setTargetId(null)
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Consolidar duplicados</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
            <div>
              <p className="font-medium">Elegí el item que querés mantener.</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                El stock de los otros se sumará al elegido y se archivarán automáticamente. Los movimientos quedan registrados como <span className="font-mono">CONSOLIDACION</span>.
              </p>
            </div>
          </div>

          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
            {candidates.map((c) => {
              const selected = targetId === c.id
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setTargetId(c.id)}
                  disabled={loading}
                  className={`w-full text-left rounded-md border p-3 transition-colors flex items-start gap-3 ${
                    selected
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-muted-foreground/40 hover:bg-muted/40"
                  } ${loading ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
                >
                  <div className={`mt-1 h-4 w-4 rounded-full border-2 shrink-0 ${selected ? "border-primary bg-primary" : "border-muted-foreground/40"}`} />
                  <div className="h-10 w-10 shrink-0 rounded bg-muted/50 overflow-hidden border flex items-center justify-center">
                    {c.imagenUrl ? (
                      <img src={c.imagenUrl} alt={c.nombre} className="h-full w-full object-cover" />
                    ) : (
                      <Package className="h-5 w-5 text-muted-foreground/50" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{c.nombre}</div>
                    <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                      <span className="font-mono">{c.codigo}</span>
                      <span>Stock: <b className="text-foreground">{c.stock}</b></span>
                      <span>Venta: {formatPrice(c.precioVenta)}</span>
                      {c.proveedor && <span className="truncate max-w-[160px]">{c.proveedor}</span>}
                    </div>
                  </div>
                  {selected && (
                    <span className="text-[10px] font-medium text-primary shrink-0 uppercase tracking-wide">
                      Destino
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {target && sources.length > 0 && (
            <div className="rounded-md border bg-muted/30 p-3 text-xs space-y-1">
              <div className="font-medium text-sm flex items-center gap-2">
                Resumen <ArrowRight className="h-3.5 w-3.5" />
              </div>
              <div>
                Se van a archivar <b>{sources.length}</b> item{sources.length > 1 ? "s" : ""} y sumar <b>{totalStockToMove}</b> unidad{totalStockToMove === 1 ? "" : "es"} al stock de <b className="font-mono">{target.codigo}</b> (queda en <b>{(target.stock || 0) + totalStockToMove}</b>).
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!targetId || sources.length === 0 || loading}
            className="gap-1.5"
          >
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {loading && progress
              ? `Consolidando ${progress.done}/${progress.total}…`
              : "Consolidar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
