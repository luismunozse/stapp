"use client"

import { useEffect, useMemo, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Loader2,
  Layers,
  Plus,
  AlertTriangle,
  CalendarClock,
  Star,
} from "lucide-react"

interface Lote {
  id: string
  numero_lote: string
  cantidad_inicial: number
  cantidad_actual: number
  costo_unitario: number | null
  fecha_vencimiento: string | null
  fecha_recepcion: string | null
  estado: "ACTIVO" | "AGOTADO" | "VENCIDO" | "BLOQUEADO"
  deposito_id: string | null
  notas: string | null
}

interface Deposito {
  id: string
  nombre: string
  principal: boolean
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  inventarioId: string
  inventarioNombre: string
  onSuccess?: () => void
}

function estadoBadge(estado: Lote["estado"]) {
  const map: Record<Lote["estado"], { label: string; cls: string }> = {
    ACTIVO: { label: "Activo", cls: "border-emerald-500/60 text-emerald-600" },
    AGOTADO: { label: "Agotado", cls: "border-muted-foreground/40 text-muted-foreground" },
    VENCIDO: { label: "Vencido", cls: "border-red-500/60 text-red-600" },
    BLOQUEADO: { label: "Bloqueado", cls: "border-amber-500/60 text-amber-600" },
  }
  const m = map[estado]
  return (
    <Badge variant="outline" className={`text-[10px] ${m.cls}`}>
      {m.label}
    </Badge>
  )
}

function diasParaVencer(fecha: string | null): number | null {
  if (!fecha) return null
  const d = new Date(fecha)
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  d.setHours(0, 0, 0, 0)
  return Math.round((d.getTime() - now.getTime()) / 86400000)
}

export function LotesDialog({
  open,
  onOpenChange,
  inventarioId,
  inventarioNombre,
  onSuccess,
}: Props) {
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [lotes, setLotes] = useState<Lote[]>([])
  const [depositos, setDepositos] = useState<Deposito[]>([])
  const [error, setError] = useState("")
  const [okMsg, setOkMsg] = useState("")

  // form
  const [numeroLote, setNumeroLote] = useState("")
  const [cantidad, setCantidad] = useState("")
  const [costo, setCosto] = useState("")
  const [vencimiento, setVencimiento] = useState("")
  const [depositoId, setDepositoId] = useState<string>("__default__")
  const [notas, setNotas] = useState("")

  const loadLotes = async () => {
    setLoading(true)
    setError("")
    try {
      const [lotesRes, depRes] = await Promise.all([
        fetch(`/api/inventario/${inventarioId}/lotes`).then((r) => r.json()),
        fetch(`/api/depositos`).then((r) => r.json()),
      ])
      setLotes(lotesRes.data ?? [])
      setDepositos(depRes.data ?? [])
    } catch {
      setError("Error al cargar lotes")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!open) return
    setNumeroLote("")
    setCantidad("")
    setCosto("")
    setVencimiento("")
    setDepositoId("__default__")
    setNotas("")
    setOkMsg("")
    setError("")
    loadLotes()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, inventarioId])

  const cantNum = Number(cantidad)
  const cantInvalida = !Number.isFinite(cantNum) || cantNum <= 0 || !Number.isInteger(cantNum)

  const handleSubmit = async () => {
    setError("")
    setOkMsg("")
    if (!numeroLote.trim()) {
      setError("Número de lote requerido")
      return
    }
    if (cantInvalida) {
      setError("Cantidad debe ser un entero > 0")
      return
    }
    setSubmitting(true)
    try {
      const body = {
        numeroLote: numeroLote.trim(),
        cantidad: cantNum,
        costoUnitario: costo.trim() ? Number(costo) : null,
        fechaVencimiento: vencimiento || null,
        depositoId: depositoId === "__default__" ? null : depositoId,
        notas: notas.trim() || null,
      }
      const res = await fetch(`/api/inventario/${inventarioId}/lotes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || "Error al guardar lote")
      }
      setOkMsg("Lote registrado correctamente")
      setNumeroLote("")
      setCantidad("")
      setCosto("")
      setVencimiento("")
      setNotas("")
      onSuccess?.()
      await loadLotes()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar lote")
    } finally {
      setSubmitting(false)
    }
  }

  const totalActivo = useMemo(
    () => lotes.filter((l) => l.estado === "ACTIVO").reduce((acc, l) => acc + l.cantidad_actual, 0),
    [lotes]
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-4 w-4" />
            Lotes / Vencimientos
          </DialogTitle>
          <p className="text-xs text-muted-foreground truncate">{inventarioNombre}</p>
        </DialogHeader>

        <div className="grid md:grid-cols-2 gap-4">
          {/* Form nuevo lote */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Plus className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">Nuevo lote / entrada</h3>
            </div>
            <div>
              <Label className="text-xs">Número de lote</Label>
              <Input
                value={numeroLote}
                onChange={(e) => setNumeroLote(e.target.value)}
                placeholder="L2024-0001"
                className="mt-1"
                maxLength={120}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Cantidad</Label>
                <Input
                  type="number"
                  min={1}
                  step={1}
                  value={cantidad}
                  onChange={(e) => setCantidad(e.target.value)}
                  placeholder="0"
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-xs">Costo unitario</Label>
                <Input
                  type="number"
                  min={0}
                  step={0.01}
                  value={costo}
                  onChange={(e) => setCosto(e.target.value)}
                  placeholder="0.00"
                  className="mt-1"
                />
              </div>
            </div>
            <div>
              <Label className="text-xs">Fecha de vencimiento (opcional)</Label>
              <Input
                type="date"
                value={vencimiento}
                onChange={(e) => setVencimiento(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">Depósito</Label>
              <Select value={depositoId} onValueChange={setDepositoId}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default__">Principal (default)</SelectItem>
                  {depositos.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      <span className="flex items-center gap-1">
                        {d.principal && <Star className="h-3 w-3 text-amber-500" />}
                        {d.nombre}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Notas</Label>
              <Input
                value={notas}
                onChange={(e) => setNotas(e.target.value)}
                placeholder="OC, proveedor, observaciones..."
                className="mt-1"
                maxLength={500}
              />
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            {okMsg && <p className="text-xs text-emerald-600">{okMsg}</p>}
            <Button onClick={handleSubmit} disabled={submitting} className="w-full">
              {submitting && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Registrar entrada
            </Button>
          </div>

          {/* Lista lotes */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Lotes existentes</h3>
              <Badge variant="secondary" className="text-[10px]">
                Total activo: {totalActivo}
              </Badge>
            </div>
            {loading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : lotes.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">Sin lotes registrados</p>
            ) : (
              <div className="space-y-1.5 max-h-[400px] overflow-y-auto pr-1">
                {lotes.map((l) => {
                  const dias = diasParaVencer(l.fecha_vencimiento)
                  const urgente = dias !== null && dias <= 30 && l.estado === "ACTIVO"
                  const vencido = dias !== null && dias < 0
                  return (
                    <div
                      key={l.id}
                      className="rounded-md border p-2 text-xs space-y-1 hover:bg-muted/40"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium truncate">{l.numero_lote}</span>
                        {estadoBadge(l.estado)}
                      </div>
                      <div className="flex items-center justify-between text-muted-foreground">
                        <span>
                          {l.cantidad_actual} / {l.cantidad_inicial} u.
                        </span>
                        {l.fecha_vencimiento && (
                          <span
                            className={`flex items-center gap-1 ${
                              vencido
                                ? "text-red-600"
                                : urgente
                                ? "text-amber-600"
                                : ""
                            }`}
                          >
                            <CalendarClock className="h-3 w-3" />
                            {new Date(l.fecha_vencimiento).toLocaleDateString("es-AR")}
                            {dias !== null && (
                              <span className="ml-1">
                                ({dias < 0 ? `hace ${-dias}d` : `${dias}d`})
                              </span>
                            )}
                          </span>
                        )}
                      </div>
                      {l.notas && (
                        <p className="text-[11px] text-muted-foreground truncate">{l.notas}</p>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
            {lotes.some((l) => {
              const d = diasParaVencer(l.fecha_vencimiento)
              return d !== null && d < 0 && l.estado === "ACTIVO"
            }) && (
              <div className="flex items-start gap-2 text-[11px] rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-200 text-amber-900 p-2">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <div>Tenés lotes vencidos sin procesar. Ejecutá "Marcar vencidos" desde Inventario / Lotes.</div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
