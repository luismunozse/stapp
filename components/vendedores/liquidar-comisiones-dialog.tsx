"use client"

import { useEffect, useMemo, useState } from "react"
import useSWR from "swr"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Wallet } from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"
import { useModal } from "@/contexts/modal-context"

interface ComisionPendiente {
  ventaId: string
  numeroVenta: number
  clienteNombre: string
  fecha: string
  total: number
  porcentajeComision: number
  montoComision: number
  pagada: boolean
}

interface ComisionesResponse {
  comisiones: ComisionPendiente[]
  totales: { devengada: number; pagada: number; pendiente: number }
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  vendedorId: string
  vendedorNombre: string
  onLiquidated: () => void
}

const fetcher = (url: string) => fetch(url).then((res) => res.json())

export function LiquidarComisionesDialog({
  open,
  onOpenChange,
  vendedorId,
  vendedorNombre,
  onLiquidated,
}: Props) {
  const { formatPrice, formatDate } = useCurrency()
  const { showError } = useModal()

  const { data, isLoading, mutate } = useSWR<ComisionesResponse>(
    open ? `/api/vendedores/${vendedorId}/comisiones?estado=pendiente` : null,
    fetcher,
    { revalidateOnFocus: false }
  )

  const pendientes = data?.comisiones ?? []
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [notas, setNotas] = useState("")
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) {
      setSelectedIds(new Set())
      setNotas("")
    }
  }, [open])

  // Al llegar data nueva, preseleccionamos todas
  useEffect(() => {
    if (data?.comisiones) {
      setSelectedIds(new Set(data.comisiones.map((c) => c.ventaId)))
    }
  }, [data])

  const toggleOne = (ventaId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(ventaId)) next.delete(ventaId)
      else next.add(ventaId)
      return next
    })
  }

  const toggleAll = () => {
    if (selectedIds.size === pendientes.length) setSelectedIds(new Set())
    else setSelectedIds(new Set(pendientes.map((c) => c.ventaId)))
  }

  const totalSeleccionado = useMemo(
    () =>
      pendientes
        .filter((c) => selectedIds.has(c.ventaId))
        .reduce((sum, c) => sum + c.montoComision, 0),
    [pendientes, selectedIds]
  )

  const handleSubmit = async () => {
    if (selectedIds.size === 0) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/vendedores/${vendedorId}/comisiones/liquidar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ventaIds: Array.from(selectedIds),
          notas: notas.trim() || undefined,
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || "Error al liquidar")
      }
      await mutate()
      onLiquidated()
      onOpenChange(false)
    } catch (err) {
      await showError(err instanceof Error ? err.message : "Error al liquidar comisiones")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" />
            Liquidar comisiones
          </DialogTitle>
          <DialogDescription>
            Ventas con comisión pendiente de {vendedorNombre}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto -mx-6 px-6">
          {isLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Cargando…
            </div>
          ) : pendientes.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No hay comisiones pendientes
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between text-xs text-muted-foreground border-b pb-2 mb-2">
                <button
                  type="button"
                  onClick={toggleAll}
                  className="text-primary hover:underline"
                >
                  {selectedIds.size === pendientes.length
                    ? "Deseleccionar todas"
                    : "Seleccionar todas"}
                </button>
                <span>
                  {pendientes.length} venta{pendientes.length !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="space-y-1">
                {pendientes.map((c) => {
                  const checked = selectedIds.has(c.ventaId)
                  return (
                    <label
                      key={c.ventaId}
                      className={`flex items-center gap-3 p-2 rounded border cursor-pointer transition-colors ${
                        checked ? "bg-primary/5 border-primary/30" : "hover:bg-muted/40"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleOne(c.ventaId)}
                        className="h-4 w-4 rounded border-input"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 text-sm">
                          <span className="font-medium">#{c.numeroVenta}</span>
                          <span className="text-muted-foreground truncate">
                            {c.clienteNombre}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatDate(c.fecha)} · {formatPrice(c.total)} ·{" "}
                          {c.porcentajeComision}%
                        </div>
                      </div>
                      <Badge variant="secondary" className="shrink-0">
                        {formatPrice(c.montoComision)}
                      </Badge>
                    </label>
                  )
                })}
              </div>
            </>
          )}
        </div>

        {pendientes.length > 0 && (
          <>
            <div className="space-y-2 pt-2 border-t">
              <Label htmlFor="notas">Notas (opcional)</Label>
              <Textarea
                id="notas"
                value={notas}
                onChange={(e) => setNotas(e.target.value)}
                placeholder="Ej: liquidación mensual abril 2026, transferencia a CBU…"
                rows={2}
                maxLength={500}
              />
            </div>

            <div className="flex items-center justify-between text-sm pt-2">
              <span className="text-muted-foreground">
                {selectedIds.size} de {pendientes.length} seleccionada(s)
              </span>
              <span className="font-semibold">
                Total: {formatPrice(totalSeleccionado)}
              </span>
            </div>
          </>
        )}

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || selectedIds.size === 0}
          >
            {submitting
              ? "Liquidando…"
              : `Liquidar ${selectedIds.size > 0 ? formatPrice(totalSeleccionado) : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
