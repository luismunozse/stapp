"use client"

import { useEffect, useMemo, useRef, useState } from "react"
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
import { COMMISSION_KIND_LABEL, type CommissionKind } from "@/lib/commissions/types"
import { round2 } from "@/lib/precios"

interface ComisionPendiente {
  clave: string
  ventaId: string | null
  tipo: CommissionKind
  numeroVenta: number | null
  clienteNombre: string | null
  fecha: string | null
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

// Server cap per payout (`.max(500, ...)` in lib/commissions/payouts.ts).
const MAX_FILAS = 500

const fetcher = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

// Zero-amount rows are listed but can never be paid.
const pagable = (c: ComisionPendiente) => !c.pagada && c.montoComision !== 0

// Oldest first (rows without a date last), capped at what one payout accepts.
function primerasPagables(rows: ComisionPendiente[]): ComisionPendiente[] {
  return rows
    .filter(pagable)
    .sort((a, b) => {
      if (a.fecha === b.fecha) return a.clave < b.clave ? -1 : 1
      if (!a.fecha) return 1
      if (!b.fecha) return -1
      return a.fecha < b.fecha ? -1 : 1
    })
    .slice(0, MAX_FILAS)
}

export function LiquidarComisionesDialog({
  open,
  onOpenChange,
  vendedorId,
  vendedorNombre,
  onLiquidated,
}: Props) {
  const { formatPrice, formatDate } = useCurrency()
  const { showError } = useModal()

  const { data, isLoading, error, mutate } = useSWR<ComisionesResponse>(
    open ? `/api/vendedores/${vendedorId}/comisiones?estado=pendiente` : null,
    fetcher,
    { revalidateOnFocus: false }
  )

  const pendientes = data?.comisiones ?? []
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [notas, setNotas] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const preseleccionado = useRef(false)
  const [preseleccionRecortada, setPreseleccionRecortada] = useState(false)

  useEffect(() => {
    if (!open) {
      preseleccionado.current = false
      setPreseleccionRecortada(false)
      setSelectedIds(new Set())
      setNotas("")
    }
  }, [open])

  // First load after opening: preselect the oldest payable rows (up to the server cap).
  // Later reloads keep the previous selection and never auto-select new rows, so an
  // admin who unticked a disputed row does not get it back after a failed attempt.
  useEffect(() => {
    if (!open || !data?.comisiones) return
    const rows = data.comisiones
    if (!preseleccionado.current) {
      preseleccionado.current = true
      setSelectedIds(new Set(primerasPagables(rows).map((c) => c.clave)))
      setPreseleccionRecortada(rows.filter(pagable).length > MAX_FILAS)
      return
    }
    const vigentes = new Set(rows.filter(pagable).map((c) => c.clave))
    setSelectedIds((prev) => new Set([...prev].filter((clave) => vigentes.has(clave))))
  }, [data, open])

  const toggleOne = (clave: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(clave)) next.delete(clave)
      else next.add(clave)
      return next
    })
  }

  const seleccionables = useMemo(() => primerasPagables(pendientes), [pendientes])
  const todasSeleccionadas =
    seleccionables.length > 0 && seleccionables.every((c) => selectedIds.has(c.clave))

  const toggleAll = () => {
    if (todasSeleccionadas) setSelectedIds(new Set())
    else setSelectedIds(new Set(seleccionables.map((c) => c.clave)))
  }

  const seleccionadas = useMemo(
    () => pendientes.filter((c) => selectedIds.has(c.clave) && pagable(c)),
    [pendientes, selectedIds]
  )
  const totalSeleccionado = round2(seleccionadas.reduce((sum, c) => sum + c.montoComision, 0))

  const handleSubmit = async () => {
    if (seleccionadas.length === 0) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/vendedores/${vendedorId}/comisiones/liquidar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filas: seleccionadas.map((c) => ({ clave: c.clave, monto: c.montoComision })),
          notas: notas.trim() || undefined,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        await mutate()
        throw new Error(err?.error || "Error al liquidar")
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
          ) : error ? (
            <div role="alert" className="py-8 text-center text-sm text-destructive">
              No se pudieron cargar las comisiones.
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
                  {todasSeleccionadas ? "Deseleccionar todas" : "Seleccionar todas"}
                </button>
                <span>
                  {pendientes.length} comisión{pendientes.length !== 1 ? "es" : ""}
                </span>
              </div>
              {preseleccionRecortada && (
                <p className="text-xs text-muted-foreground mb-2">
                  Se preseleccionaron solo las {MAX_FILAS} comisiones más antiguas.
                </p>
              )}
              <div className="space-y-1">
                {pendientes.map((c) => {
                  const checked = selectedIds.has(c.clave)
                  const kind = COMMISSION_KIND_LABEL[c.tipo]
                  const bloqueada = !pagable(c)
                  return (
                    <label
                      key={c.clave}
                      className={`flex items-center gap-3 p-2 rounded border transition-colors ${
                        bloqueada
                          ? "cursor-not-allowed opacity-60"
                          : checked
                            ? "cursor-pointer bg-primary/5 border-primary/30"
                            : "cursor-pointer hover:bg-muted/40"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={bloqueada}
                        onChange={() => toggleOne(c.clave)}
                        className="h-4 w-4 rounded border-input"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 text-sm">
                          <span className="font-medium">
                            {c.numeroVenta != null ? `#${c.numeroVenta}` : "—"}
                          </span>
                          {kind && (
                            <Badge variant="secondary" className="text-[10px] shrink-0">
                              {kind}
                            </Badge>
                          )}
                          {c.clienteNombre && (
                            <span className="text-muted-foreground truncate">
                              {c.clienteNombre}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {c.fecha ? `${formatDate(c.fecha)} · ` : ""}
                          {formatPrice(c.total)} · {c.porcentajeComision}%
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
                {seleccionadas.length} de {pendientes.length} seleccionada(s)
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
            disabled={submitting || seleccionadas.length === 0}
          >
            {submitting
              ? "Liquidando…"
              : `Liquidar ${seleccionadas.length > 0 ? formatPrice(totalSeleccionado) : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
