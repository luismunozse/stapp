"use client"

import { useState, useEffect, useMemo } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { DollarSign, Loader2 } from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"
import { useOffline } from "@/contexts/offline-context"
import { STORES } from "@/lib/offline/constants"
import { MultiPagoInput, createPagoLine, type PagoLineItem } from "@/components/pagos/multi-pago-input"

interface OrdenPendiente {
  id: string
  numeroOrden: number
  codigoOrden?: string
  dispositivo: string
  costoFinal: number
  totalCobrado: number
  descuentoCobro: number
  pendiente: number
  estadoCobro: string
  estado: string
}

interface CobrarMultipleDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  clienteId?: string
  clienteNombre?: string
  ordenesPreseleccionadas?: OrdenPendiente[]
  onSuccess: () => void
}

export function CobrarMultipleDialog({
  open,
  onOpenChange,
  clienteId,
  clienteNombre,
  ordenesPreseleccionadas,
  onSuccess,
}: CobrarMultipleDialogProps) {
  const { formatPrice } = useCurrency()
  const { offlineFetch } = useOffline()
  const modoPreseleccion = !!ordenesPreseleccionadas
  const [loading, setLoading] = useState(!modoPreseleccion)
  const [submitting, setSubmitting] = useState(false)
  const [ordenes, setOrdenes] = useState<OrdenPendiente[]>(ordenesPreseleccionadas || [])
  const [seleccionadas, setSeleccionadas] = useState<Set<string>>(
    new Set((ordenesPreseleccionadas || []).map(o => o.id))
  )
  const [observaciones, setObservaciones] = useState("")
  const [saldoCuenta, setSaldoCuenta] = useState(0)

  const totalSeleccionado = useMemo(() => {
    return ordenes
      .filter(o => seleccionadas.has(o.id))
      .reduce((sum, o) => sum + o.pendiente, 0)
  }, [ordenes, seleccionadas])

  const [pagosLines, setPagosLines] = useState<PagoLineItem[]>([createPagoLine(0)])

  // Fetch ordenes pendientes (solo cuando no hay preseleccionadas)
  useEffect(() => {
    if (!open || modoPreseleccion) return
    if (!clienteId) return
    const fetchData = async () => {
      setLoading(true)
      try {
        const [ordRes, ccRes] = await Promise.all([
          fetch(`/api/clientes/${clienteId}/ordenes-pendientes`),
          fetch(`/api/clientes/${clienteId}/cuenta-corriente`),
        ])
        if (ordRes.ok) {
          const data = await ordRes.json()
          setOrdenes(data)
          // Seleccionar todas por defecto
          setSeleccionadas(new Set(data.map((o: any) => o.id)))
        }
        if (ccRes.ok) {
          const data = await ccRes.json()
          setSaldoCuenta(data.saldo || 0)
        }
      } catch { /* ignore */ }
      finally { setLoading(false) }
    }
    fetchData()
  }, [open, clienteId, modoPreseleccion])

  // Update pagos amount when selection changes
  useEffect(() => {
    if (totalSeleccionado > 0) {
      setPagosLines([createPagoLine(totalSeleccionado)])
    }
  }, [totalSeleccionado])

  const toggleOrden = (id: string) => {
    const next = new Set(seleccionadas)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSeleccionadas(next)
  }

  const toggleTodas = () => {
    if (seleccionadas.size === ordenes.length) {
      setSeleccionadas(new Set())
    } else {
      setSeleccionadas(new Set(ordenes.map(o => o.id)))
    }
  }

  const handleCobrar = async () => {
    const ordenesACobrar = ordenes.filter(o => seleccionadas.has(o.id))
    if (ordenesACobrar.length === 0) {
      alert("Seleccione al menos una orden")
      return
    }

    const totalPagos = pagosLines.reduce((sum, p) => sum + (p.monto || 0), 0)
    if (totalPagos <= 0) {
      alert("Debe registrar al menos un pago")
      return
    }
    if (totalPagos > totalSeleccionado + 0.01) {
      alert("El total de pagos excede el pendiente total")
      return
    }

    setSubmitting(true)
    try {
      // Distribuir pagos proporcionalmente entre las órdenes
      let montoRestante = totalPagos

      for (const orden of ordenesACobrar) {
        if (montoRestante <= 0) break

        const montoParaEstaOrden = Math.min(orden.pendiente, montoRestante)
        montoRestante -= montoParaEstaOrden

        // Calcular pagos proporcionales para esta orden
        const proporcion = montoParaEstaOrden / totalPagos
        const pagosOrden = pagosLines.map(p => ({
          monto: Math.round(p.monto * proporcion * 100) / 100,
          metodo: p.metodo,
          referencia: p.referencia || null,
          cuotas: p.cuotas,
          recargo: p.recargo,
          montoOriginal: p.montoOriginal,
          // costoFinanciero es un porcentaje: el servidor computa el monto sobre el
          // monto prorrateado de cada orden, por lo que se envía tal cual.
          costoFinanciero: p.costoFinanciero,
        }))

        // Ajustar redondeo en el primer pago
        const totalPagosOrden = pagosOrden.reduce((s, p) => s + p.monto, 0)
        const diff = montoParaEstaOrden - totalPagosOrden
        if (Math.abs(diff) > 0 && pagosOrden.length > 0) {
          pagosOrden[0].monto = Math.round((pagosOrden[0].monto + diff) * 100) / 100
        }

        const res = await offlineFetch(`/api/ordenes/${orden.id}/cobros`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pagos: pagosOrden.filter(p => p.monto > 0),
            observaciones: observaciones || `Cobro unificado - ${ordenesACobrar.length} órdenes`,
          }),
        }, { store: STORES.COBROS, description: `Cobro orden #${orden.numeroOrden}` })

        if (res.status === 202) {
          // Queued offline, continue with next
          continue
        }

        if (!res.ok) {
          const error = await res.json()
          alert(`Error en orden #${orden.numeroOrden}: ${error.error}`)
          break
        }
      }

      onSuccess()
      onOpenChange(false)
    } catch (err) {
      console.error("Error:", err)
      alert("Error al registrar cobros")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5" />
            {clienteNombre ? `Cobro Unificado - ${clienteNombre}` : `Cobro de ${ordenes.length} orden${ordenes.length !== 1 ? "es" : ""}`}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : ordenes.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground">
            No hay órdenes con cobro pendiente para este cliente
          </div>
        ) : (
          <div className="space-y-4">
            {/* Selección de órdenes */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-sm font-medium">Órdenes a cobrar</Label>
                <Button variant="ghost" size="sm" onClick={toggleTodas} className="text-xs h-7">
                  {seleccionadas.size === ordenes.length ? "Deseleccionar todas" : "Seleccionar todas"}
                </Button>
              </div>
              <div className="space-y-2 max-h-[200px] overflow-y-auto">
                {ordenes.map((orden) => {
                  const label = orden.codigoOrden || `#${String(orden.numeroOrden).padStart(4, "0")}`
                  return (
                    <label
                      key={orden.id}
                      className="flex items-center gap-3 p-2 rounded-lg bg-muted/50 hover:bg-muted cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        className="rounded border-gray-300 h-4 w-4"
                        checked={seleccionadas.has(orden.id)}
                        onChange={() => toggleOrden(orden.id)}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">Orden {label}</span>
                          <span className="text-sm font-medium text-red-600">
                            {formatPrice(orden.pendiente)}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {orden.dispositivo}
                          {orden.totalCobrado > 0 && ` · Abonado: ${formatPrice(orden.totalCobrado)}`}
                        </div>
                      </div>
                    </label>
                  )
                })}
              </div>
            </div>

            {/* Total seleccionado */}
            <div className="p-3 bg-muted rounded-lg text-center">
              <div className="text-xs text-muted-foreground">Total a cobrar ({seleccionadas.size} orden{seleccionadas.size !== 1 ? "es" : ""})</div>
              <div className="text-2xl font-bold text-primary">{formatPrice(totalSeleccionado)}</div>
            </div>

            {seleccionadas.size > 0 && (
              <>
                {/* Pagos */}
                <MultiPagoInput
                  montoPendiente={totalSeleccionado}
                  pagos={pagosLines}
                  onChange={setPagosLines}
                  saldoCuenta={saldoCuenta}
                  showCuentaCorriente={saldoCuenta > 0}
                />

                {/* Observaciones */}
                <div>
                  <Label className="text-xs">Observaciones</Label>
                  <Textarea
                    value={observaciones}
                    onChange={(e) => setObservaciones(e.target.value)}
                    placeholder="Notas del cobro..."
                    rows={2}
                  />
                </div>

                {/* Botón cobrar */}
                <Button className="w-full" onClick={handleCobrar} disabled={submitting}>
                  {submitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Registrando...
                    </>
                  ) : (
                    `Cobrar ${formatPrice(pagosLines.reduce((s, p) => s + (p.monto || 0), 0))}`
                  )}
                </Button>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
