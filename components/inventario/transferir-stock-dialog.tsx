"use client"

import { useEffect, useMemo, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Loader2, ArrowRight, AlertTriangle, Warehouse, Star } from "lucide-react"

interface DepositoStock {
  depositoId: string
  depositoNombre: string
  principal: boolean
  activo: boolean
  stock: number
  stockReservado: number
  disponible: number
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  inventarioId: string
  inventarioNombre: string
  onSuccess?: () => void
}

export function TransferirStockDialog({
  open,
  onOpenChange,
  inventarioId,
  inventarioNombre,
  onSuccess,
}: Props) {
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [data, setData] = useState<DepositoStock[]>([])
  const [discrepancia, setDiscrepancia] = useState(0)
  const [stockTotal, setStockTotal] = useState(0)
  const [origen, setOrigen] = useState<string>("")
  const [destino, setDestino] = useState<string>("")
  const [cantidad, setCantidad] = useState<string>("")
  const [motivo, setMotivo] = useState<string>("")
  const [error, setError] = useState<string>("")

  useEffect(() => {
    if (!open) return
    setError("")
    setOrigen("")
    setDestino("")
    setCantidad("")
    setMotivo("")
    setLoading(true)
    fetch(`/api/inventario/${inventarioId}/depositos`)
      .then((r) => r.json())
      .then((res) => {
        const rows: DepositoStock[] = res.data || []
        setData(rows)
        setDiscrepancia(res.discrepancia ?? 0)
        setStockTotal(res.item?.stockTotal ?? 0)
        // Default origen = primer depósito con stock > 0
        const conStock = rows.find((d) => d.activo && d.disponible > 0)
        if (conStock) setOrigen(conStock.depositoId)
      })
      .catch(() => setError("Error al cargar depósitos"))
      .finally(() => setLoading(false))
  }, [open, inventarioId])

  const origenRow = useMemo(() => data.find((d) => d.depositoId === origen), [data, origen])
  const destinoRow = useMemo(() => data.find((d) => d.depositoId === destino), [data, destino])
  const destinosDisponibles = useMemo(
    () => data.filter((d) => d.activo && d.depositoId !== origen),
    [data, origen]
  )
  const cantNum = Number(cantidad)
  const cantInvalida = !Number.isFinite(cantNum) || cantNum <= 0 || !Number.isInteger(cantNum)
  const excedeOrigen = origenRow ? cantNum > origenRow.disponible : false

  const handleSubmit = async () => {
    setError("")
    if (!origen || !destino) {
      setError("Seleccioná origen y destino")
      return
    }
    if (origen === destino) {
      setError("Origen y destino deben ser distintos")
      return
    }
    if (cantInvalida) {
      setError("Cantidad debe ser un entero > 0")
      return
    }
    if (excedeOrigen) {
      setError(`No hay suficiente disponible en origen (max ${origenRow?.disponible})`)
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch(`/api/inventario/${inventarioId}/transferir`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          depositoOrigenId: origen,
          depositoDestinoId: destino,
          cantidad: cantNum,
          motivo: motivo.trim() || null,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || "Error al transferir")
      }
      onSuccess?.()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al transferir")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Warehouse className="h-4 w-4" />
            Transferir stock
          </DialogTitle>
          <p className="text-xs text-muted-foreground truncate">{inventarioNombre}</p>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : data.length < 2 ? (
          <div className="text-sm text-muted-foreground py-4 text-center">
            Necesitás al menos 2 depósitos activos para transferir.{" "}
            <a href="/configuracion/depositos" className="underline text-primary">
              Gestionar depósitos
            </a>
          </div>
        ) : (
          <div className="space-y-3 py-2">
            {discrepancia !== 0 && (
              <div className="flex items-start gap-2 text-xs rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-200 text-amber-900 p-2">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <div>
                  Stock total ({stockTotal}) no coincide con suma por depósito (
                  {stockTotal - discrepancia}). Diferencia: {discrepancia}.
                  Las transferencias funcionan; el desbalance se corrige al asignar movimientos por depósito.
                </div>
              </div>
            )}

            <div>
              <Label className="text-xs">Origen</Label>
              <Select value={origen} onValueChange={setOrigen}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Seleccionar depósito origen" />
                </SelectTrigger>
                <SelectContent>
                  {data.filter((d) => d.activo).map((d) => (
                    <SelectItem key={d.depositoId} value={d.depositoId}>
                      <div className="flex items-center gap-2">
                        {d.principal && <Star className="h-3 w-3 text-amber-500" />}
                        <span>{d.depositoNombre}</span>
                        <Badge variant="secondary" className="text-[10px]">
                          {d.disponible} disp.
                        </Badge>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {origenRow && (
                <p className="text-[11px] text-muted-foreground mt-1">
                  Stock {origenRow.stock} · Reservado {origenRow.stockReservado} · Disponible {origenRow.disponible}
                </p>
              )}
            </div>

            <div className="flex justify-center">
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </div>

            <div>
              <Label className="text-xs">Destino</Label>
              <Select value={destino} onValueChange={setDestino}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Seleccionar depósito destino" />
                </SelectTrigger>
                <SelectContent>
                  {destinosDisponibles.length === 0 ? (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">
                      Sin destinos disponibles
                    </div>
                  ) : (
                    destinosDisponibles.map((d) => (
                      <SelectItem key={d.depositoId} value={d.depositoId}>
                        <div className="flex items-center gap-2">
                          {d.principal && <Star className="h-3 w-3 text-amber-500" />}
                          <span>{d.depositoNombre}</span>
                          <Badge variant="outline" className="text-[10px]">
                            +{d.stock}
                          </Badge>
                        </div>
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              {destinoRow && (
                <p className="text-[11px] text-muted-foreground mt-1">
                  Stock actual {destinoRow.stock}
                </p>
              )}
            </div>

            <div>
              <Label className="text-xs">Cantidad</Label>
              <Input
                type="number"
                min={1}
                step={1}
                max={origenRow?.disponible ?? undefined}
                value={cantidad}
                onChange={(e) => setCantidad(e.target.value)}
                placeholder="0"
                className="mt-1"
              />
              {excedeOrigen && (
                <p className="text-[11px] text-destructive mt-1">
                  Excede disponible en origen ({origenRow?.disponible})
                </p>
              )}
            </div>

            <div>
              <Label className="text-xs">Motivo (opcional)</Label>
              <Input
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Reposición, redistribución, etc."
                className="mt-1"
                maxLength={500}
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={
              submitting ||
              loading ||
              data.length < 2 ||
              !origen ||
              !destino ||
              cantInvalida ||
              excedeOrigen
            }
          >
            {submitting && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Transferir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
