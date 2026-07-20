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
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Loader2,
  ScanLine,
  Plus,
  Hash,
  Star,
  ShieldCheck,
} from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"

interface Serie {
  id: string
  numero_serie: string
  lote_id: string | null
  estado:
    | "DISPONIBLE"
    | "RESERVADO"
    | "VENDIDO"
    | "GARANTIA_ACTIVA"
    | "DEVUELTO"
    | "BLOQUEADO"
  fecha_recepcion: string | null
  fecha_venta: string | null
  fecha_garantia_vence: string | null
  notas: string | null
}

interface Lote {
  id: string
  numero_lote: string
  estado: string
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

const ESTADO_COLOR: Record<Serie["estado"], string> = {
  DISPONIBLE: "border-emerald-500/60 text-emerald-600",
  RESERVADO: "border-blue-500/60 text-blue-600",
  VENDIDO: "border-muted-foreground/40 text-muted-foreground",
  GARANTIA_ACTIVA: "border-amber-500/60 text-amber-600",
  DEVUELTO: "border-red-500/60 text-red-600",
  BLOQUEADO: "border-red-500/60 text-red-600",
}

export function SeriesDialog({
  open,
  onOpenChange,
  inventarioId,
  inventarioNombre,
  onSuccess,
}: Props) {
  const { formatDate } = useCurrency()
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [series, setSeries] = useState<Serie[]>([])
  const [lotes, setLotes] = useState<Lote[]>([])
  const [depositos, setDepositos] = useState<Deposito[]>([])
  const [search, setSearch] = useState("")
  const [estadoFilter, setEstadoFilter] = useState<string>("__all__")
  const [error, setError] = useState("")
  const [okMsg, setOkMsg] = useState("")

  // form
  const [mode, setMode] = useState<"bulk" | "scan">("bulk")
  const [bulkText, setBulkText] = useState("")
  const [scanInput, setScanInput] = useState("")
  const [scanQueue, setScanQueue] = useState<string[]>([])
  const [loteId, setLoteId] = useState<string>("__none__")
  const [costo, setCosto] = useState("")
  const [garantiaDias, setGarantiaDias] = useState("")
  const [depositoId, setDepositoId] = useState<string>("__default__")

  const loadAll = async () => {
    setLoading(true)
    setError("")
    try {
      const params = new URLSearchParams()
      if (search.trim()) params.set("q", search.trim())
      if (estadoFilter !== "__all__") params.set("estado", estadoFilter)
      const [seriesRes, lotesRes, depRes] = await Promise.all([
        fetch(`/api/inventario/${inventarioId}/series?${params.toString()}`).then((r) => r.json()),
        fetch(`/api/inventario/${inventarioId}/lotes?estado=ACTIVO`).then((r) => r.json()),
        fetch(`/api/depositos`).then((r) => r.json()),
      ])
      setSeries(seriesRes.data ?? [])
      setLotes(lotesRes.data ?? [])
      setDepositos(depRes.data ?? [])
    } catch {
      setError("Error al cargar series")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!open) return
    setBulkText("")
    setScanInput("")
    setScanQueue([])
    setLoteId("__none__")
    setCosto("")
    setGarantiaDias("")
    setDepositoId("__default__")
    setError("")
    setOkMsg("")
    setSearch("")
    setEstadoFilter("__all__")
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, inventarioId])

  useEffect(() => {
    if (!open) return
    const t = setTimeout(loadAll, 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, estadoFilter])

  const parseBulk = (text: string): string[] => {
    return Array.from(
      new Set(
        text
          .split(/[\n,;\t]/)
          .map((s) => s.trim())
          .filter(Boolean)
      )
    )
  }

  const candidatos = useMemo(() => {
    if (mode === "bulk") return parseBulk(bulkText)
    return scanQueue
  }, [mode, bulkText, scanQueue])

  const addScan = () => {
    const v = scanInput.trim()
    if (!v) return
    setScanQueue((prev) => (prev.includes(v) ? prev : [...prev, v]))
    setScanInput("")
  }

  const removeScan = (s: string) =>
    setScanQueue((prev) => prev.filter((x) => x !== s))

  const handleSubmit = async () => {
    setError("")
    setOkMsg("")
    if (candidatos.length === 0) {
      setError("Ingresá al menos 1 número de serie")
      return
    }
    setSubmitting(true)
    try {
      const body = {
        numerosSerie: candidatos,
        loteId: loteId === "__none__" ? null : loteId,
        costoUnitario: costo.trim() ? Number(costo) : null,
        depositoId: depositoId === "__default__" ? null : depositoId,
        garantiaDias: garantiaDias.trim() ? Number(garantiaDias) : null,
      }
      const res = await fetch(`/api/inventario/${inventarioId}/series`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Error al guardar series")
      setOkMsg(`${json.cantidad} serie(s) registradas`)
      setBulkText("")
      setScanQueue([])
      onSuccess?.()
      await loadAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar series")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100vw-1rem)] sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Hash className="h-4 w-4" />
            Números de serie
          </DialogTitle>
          <p className="text-xs text-muted-foreground truncate">{inventarioNombre}</p>
        </DialogHeader>

        <div className="grid md:grid-cols-2 gap-4">
          {/* Form ingreso */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Plus className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">Ingresar series</h3>
            </div>

            <div className="flex gap-1">
              <Button
                size="sm"
                variant={mode === "bulk" ? "default" : "outline"}
                onClick={() => setMode("bulk")}
                className="h-7 text-[11px] flex-1"
              >
                Carga masiva
              </Button>
              <Button
                size="sm"
                variant={mode === "scan" ? "default" : "outline"}
                onClick={() => setMode("scan")}
                className="h-7 text-[11px] flex-1"
              >
                <ScanLine className="h-3 w-3 mr-1" />
                Escanear
              </Button>
            </div>

            {mode === "bulk" ? (
              <div>
                <Label className="text-xs">
                  Uno por línea (también acepta , ; tabs)
                </Label>
                <Textarea
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                  placeholder={"SN001\nSN002\nSN003"}
                  className="mt-1 font-mono text-xs min-h-[120px]"
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Detectados: {candidatos.length}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <Label className="text-xs">Escaneá o tipeá y Enter</Label>
                <Input
                  autoFocus
                  value={scanInput}
                  onChange={(e) => setScanInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      addScan()
                    }
                  }}
                  placeholder="SN001"
                  className="font-mono text-xs"
                />
                <div className="border rounded-md p-2 min-h-[80px] max-h-[140px] overflow-y-auto flex flex-wrap gap-1">
                  {scanQueue.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground">Cola vacía</p>
                  ) : (
                    scanQueue.map((s) => (
                      <Badge
                        key={s}
                        variant="secondary"
                        className="text-[10px] cursor-pointer"
                        onClick={() => removeScan(s)}
                        title="Click para quitar"
                      >
                        {s} ×
                      </Badge>
                    ))
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {scanQueue.length} encolado(s)
                </p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
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
              <div>
                <Label className="text-xs">Garantía (días)</Label>
                <Input
                  type="number"
                  min={0}
                  max={3650}
                  step={1}
                  value={garantiaDias}
                  onChange={(e) => setGarantiaDias(e.target.value)}
                  placeholder="365"
                  className="mt-1"
                />
              </div>
            </div>

            <div>
              <Label className="text-xs">Lote (opcional)</Label>
              <Select value={loteId} onValueChange={setLoteId}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Sin lote</SelectItem>
                  {lotes.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.numero_lote}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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

            {error && <p className="text-xs text-destructive">{error}</p>}
            {okMsg && <p className="text-xs text-emerald-600">{okMsg}</p>}

            <Button
              onClick={handleSubmit}
              disabled={submitting || candidatos.length === 0}
              className="w-full"
            >
              {submitting && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Registrar {candidatos.length > 0 ? `(${candidatos.length})` : ""}
            </Button>
          </div>

          {/* Lista series */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Series existentes</h3>
              <Badge variant="secondary" className="text-[10px]">
                {series.length}
              </Badge>
            </div>
            <div className="flex gap-1">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar S/N..."
                className="h-8 text-xs"
              />
              <Select value={estadoFilter} onValueChange={setEstadoFilter}>
                <SelectTrigger className="h-8 text-xs w-[130px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Todos</SelectItem>
                  <SelectItem value="DISPONIBLE">Disponible</SelectItem>
                  <SelectItem value="RESERVADO">Reservado</SelectItem>
                  <SelectItem value="VENDIDO">Vendido</SelectItem>
                  <SelectItem value="GARANTIA_ACTIVA">Garantía</SelectItem>
                  <SelectItem value="DEVUELTO">Devuelto</SelectItem>
                  <SelectItem value="BLOQUEADO">Bloqueado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {loading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : series.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">
                Sin series cargadas
              </p>
            ) : (
              <div className="space-y-1.5 max-h-[420px] overflow-y-auto pr-1">
                {series.map((s) => (
                  <div
                    key={s.id}
                    className="rounded-md border p-2 text-xs space-y-1 hover:bg-muted/40"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[11px] truncate">{s.numero_serie}</span>
                      <Badge
                        variant="outline"
                        className={`text-[10px] ${ESTADO_COLOR[s.estado]}`}
                      >
                        {s.estado}
                      </Badge>
                    </div>
                    {(s.fecha_venta || s.fecha_garantia_vence) && (
                      <div className="text-[11px] text-muted-foreground flex items-center gap-3">
                        {s.fecha_venta && (
                          <span>
                            Vendida: {formatDate(s.fecha_venta)}
                          </span>
                        )}
                        {s.fecha_garantia_vence && (
                          <span className="flex items-center gap-1">
                            <ShieldCheck className="h-3 w-3" />
                            {formatDate(s.fecha_garantia_vence)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                ))}
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
