"use client"

import { useEffect, useMemo, useState } from "react"
import useSWR from "swr"
import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Percent,
  CheckCircle2,
  DollarSign,
  Loader2,
  Download,
  TrendingUp,
  Wallet,
  Hash,
  Calendar as CalIcon,
  ExternalLink,
  RotateCcw,
} from "lucide-react"
import { toast } from "sonner"
import { useCurrency } from "@/contexts/currency-context"
import { useModal } from "@/contexts/modal-context"
import { cn } from "@/lib/utils"
import { EmptyState } from "@/components/ui/empty-state"
import { FieldSectionLabel } from "@/components/ui/field-section-label"

interface Item {
  ordenId: string
  tecnicoId: string
  tecnicoNombre: string
  codigoOrden: string | null
  numeroOrden: number
  dispositivo: string
  estado: string
  fechaCompletado: string | null
  costoFinal: number
  costoRepuestos: number
  ganancia: number
  porcentajeComision: number
  montoComision: number
  comisionPagada: boolean
  fechaPagoComision: string | null
}

interface ApiResp {
  items: Item[]
  resumen: Array<{
    tecnicoId: string
    tecnicoNombre: string
    totalOrdenes: number
    totalGanancia: number
    totalComision: number
    totalPendiente: number
  }>
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

function toISODate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

type Preset = "semana" | "semana_pasada" | "mes" | "mes_pasado" | "30d" | "custom"

function rangePreset(p: Preset): { desde: string; hasta: string } {
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  if (p === "semana" || p === "semana_pasada") {
    const dia = hoy.getDay()
    const diffLunes = dia === 0 ? -6 : 1 - dia
    const lunes = new Date(hoy)
    lunes.setDate(hoy.getDate() + diffLunes)
    if (p === "semana_pasada") lunes.setDate(lunes.getDate() - 7)
    const domingo = new Date(lunes)
    domingo.setDate(lunes.getDate() + 6)
    return { desde: toISODate(lunes), hasta: toISODate(domingo) }
  }
  if (p === "mes") {
    const inicio = new Date(hoy.getFullYear(), hoy.getMonth(), 1)
    const fin = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0)
    return { desde: toISODate(inicio), hasta: toISODate(fin) }
  }
  if (p === "mes_pasado") {
    const inicio = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1)
    const fin = new Date(hoy.getFullYear(), hoy.getMonth(), 0)
    return { desde: toISODate(inicio), hasta: toISODate(fin) }
  }
  // 30d
  const desde = new Date(hoy)
  desde.setDate(hoy.getDate() - 29)
  return { desde: toISODate(desde), hasta: toISODate(hoy) }
}

interface Props {
  tecnicoId: string
  tecnicoNombre: string
  porcentajeDefault?: number
  readOnly?: boolean
}

export function TecnicoComisiones({ tecnicoId, tecnicoNombre, porcentajeDefault, readOnly = false }: Props) {
  const { formatPrice, formatDate } = useCurrency()
  const { confirm } = useModal()

  const [preset, setPreset] = useState<Preset>("mes")
  const initial = useMemo(() => rangePreset("mes"), [])
  const [desde, setDesde] = useState(initial.desde)
  const [hasta, setHasta] = useState(initial.hasta)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [paying, setPaying] = useState(false)

  const qs = new URLSearchParams({ tecnicoId })
  if (desde) qs.set("desde", desde)
  if (hasta) qs.set("hasta", hasta + "T23:59:59")

  const { data, isLoading, mutate } = useSWR<ApiResp>(
    `/api/comisiones?${qs.toString()}`,
    fetcher,
    { revalidateOnFocus: false }
  )

  useEffect(() => {
    setSelected(new Set())
  }, [desde, hasta])

  const items = data?.items || []
  const pendientes = items.filter((i) => !i.comisionPagada)
  const pagadas = items.filter((i) => i.comisionPagada)

  const totalComision = items.reduce((acc, i) => acc + i.montoComision, 0)
  const totalPendiente = pendientes.reduce((acc, i) => acc + i.montoComision, 0)
  const totalPagado = pagadas.reduce((acc, i) => acc + i.montoComision, 0)
  const totalGanancia = items.reduce((acc, i) => acc + i.ganancia, 0)
  const ticketPromedio = items.length ? totalGanancia / items.length : 0
  const comisionPromedio = items.length ? totalComision / items.length : 0

  const pendientesIds = pendientes.map((i) => i.ordenId)
  const allSelected =
    pendientesIds.length > 0 && pendientesIds.every((id) => selected.has(id))

  const toggleAll = () => {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(pendientesIds))
  }
  const toggleOne = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  const totalSeleccionado = items
    .filter((i) => selected.has(i.ordenId))
    .reduce((acc, i) => acc + i.montoComision, 0)

  const applyPreset = (p: Preset) => {
    setPreset(p)
    if (p !== "custom") {
      const r = rangePreset(p)
      setDesde(r.desde)
      setHasta(r.hasta)
    }
  }

  const handlePagar = async () => {
    if (selected.size === 0) return
    const ok = await confirm({
      title: "Liquidar comisiones",
      description: `¿Marcar ${selected.size} orden(es) como comisión pagada a ${tecnicoNombre}? Total: ${formatPrice(totalSeleccionado)}`,
      confirmText: "Confirmar pago",
      variant: "info",
    })
    if (!ok) return
    setPaying(true)
    try {
      const res = await fetch("/api/comisiones/pagar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ordenIds: Array.from(selected) }),
      })
      if (!res.ok) throw new Error()
      toast.success("Comisiones liquidadas")
      setSelected(new Set())
      mutate()
    } catch {
      toast.error("No se pudo liquidar")
    } finally {
      setPaying(false)
    }
  }

  const handleRevertir = async (ordenId: string) => {
    const ok = await confirm({
      title: "Revertir pago",
      description: "¿Marcar esta comisión como pendiente nuevamente?",
      confirmText: "Revertir",
      variant: "danger",
    })
    if (!ok) return
    try {
      const res = await fetch("/api/comisiones/pagar", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ordenIds: [ordenId] }),
      })
      if (!res.ok) throw new Error()
      toast.success("Revertido")
      mutate()
    } catch {
      toast.error("No se pudo revertir")
    }
  }

  const exportCSV = () => {
    const headers = [
      "Orden", "Dispositivo", "Fecha completado",
      "Costo final", "Repuestos", "Ganancia",
      "% Comisión", "Comisión", "Estado pago", "Fecha pago",
    ]
    const rows = items.map((i) => [
      i.codigoOrden || `#${i.numeroOrden}`,
      i.dispositivo,
      i.fechaCompletado || "",
      i.costoFinal, i.costoRepuestos, i.ganancia,
      i.porcentajeComision, i.montoComision,
      i.comisionPagada ? "Pagada" : "Pendiente",
      i.fechaPagoComision || "",
    ])
    const csv = [headers, ...rows]
      .map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n")
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `comisiones_${tecnicoNombre}_${desde}_${hasta}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Historial de pagos: agrupar pagadas por fecha_pago_comision (día)
  const pagosAgrupados = useMemo(() => {
    const map = new Map<string, { fecha: string; total: number; ordenes: Item[] }>()
    for (const i of pagadas) {
      if (!i.fechaPagoComision) continue
      const k = i.fechaPagoComision.slice(0, 10)
      const cur = map.get(k) || { fecha: k, total: 0, ordenes: [] }
      cur.total += i.montoComision
      cur.ordenes.push(i)
      map.set(k, cur)
    }
    return Array.from(map.values()).sort((a, b) => (a.fecha < b.fecha ? 1 : -1))
  }, [pagadas])

  const presetBtn = (p: Preset, label: string) => (
    <button
      key={p}
      onClick={() => applyPreset(p)}
      className={cn(
        "px-3 py-1.5 rounded-md text-xs font-medium border transition-colors",
        preset === p
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-background hover:bg-muted border-input"
      )}
    >
      {label}
    </button>
  )

  return (
    <div className="space-y-4">
      {/* Filtros y acciones */}
      <div className="flex flex-wrap items-end gap-3 justify-between">
        <div className="flex flex-wrap gap-2">
          {presetBtn("semana", "Esta semana")}
          {presetBtn("semana_pasada", "Semana pasada")}
          {presetBtn("mes", "Este mes")}
          {presetBtn("mes_pasado", "Mes pasado")}
          {presetBtn("30d", "Últimos 30 días")}
          {presetBtn("custom", "Personalizado")}
        </div>
        <div className="flex gap-2 items-end">
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Desde</Label>
            <Input
              type="date"
              value={desde}
              onChange={(e) => { setDesde(e.target.value); setPreset("custom") }}
              className="h-9 w-[150px]"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Hasta</Label>
            <Input
              type="date"
              value={hasta}
              onChange={(e) => { setHasta(e.target.value); setPreset("custom") }}
              className="h-9 w-[150px]"
            />
          </div>
          <Button variant="outline" size="sm" onClick={exportCSV} disabled={items.length === 0}>
            <Download className="h-4 w-4 mr-1.5" />
            CSV
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={<Wallet className="h-4 w-4" />}
          label="Comisión pendiente"
          value={formatPrice(totalPendiente)}
          hint={`${pendientes.length} orden(es)`}
          accent="primary"
        />
        <KpiCard
          icon={<CheckCircle2 className="h-4 w-4" />}
          label="Comisión pagada"
          value={formatPrice(totalPagado)}
          hint={`${pagadas.length} orden(es)`}
          accent="success"
        />
        <KpiCard
          icon={<TrendingUp className="h-4 w-4" />}
          label="Ganancia generada"
          value={formatPrice(totalGanancia)}
          hint={`Ticket prom. ${formatPrice(ticketPromedio)}`}
        />
        <KpiCard
          icon={<Percent className="h-4 w-4" />}
          label="Comisión promedio"
          value={formatPrice(comisionPromedio)}
          hint={`% base: ${Number(porcentajeDefault ?? 0).toFixed(2)}%`}
        />
      </div>

      {/* Barra de acción para selección */}
      {!readOnly && selected.size > 0 && (
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 p-3 rounded-md bg-info-50 border border-info/30">
          <div className="text-sm text-info-700">
            <strong>{selected.size}</strong> seleccionada(s) · Total a pagar:{" "}
            <strong>{formatPrice(totalSeleccionado)}</strong>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setSelected(new Set())}>
              Limpiar
            </Button>
            <Button size="sm" onClick={handlePagar} disabled={paying}>
              {paying ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <DollarSign className="h-4 w-4 mr-1.5" />
              )}
              Liquidar seleccionadas
            </Button>
          </div>
        </div>
      )}

      {/* Tabla de órdenes */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="py-12 text-center text-muted-foreground flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Cargando comisiones…
            </div>
          ) : items.length === 0 ? (
            <EmptyState icon={Hash} title="Sin órdenes" variant="search" />
          ) : (
            <>
              {/* Barra de selección todas pendientes */}
              {!readOnly && pendientes.length > 0 && (
                <div className="flex items-center gap-2 px-4 py-2 border-b bg-muted/30">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    checked={allSelected}
                    onChange={toggleAll}
                  />
                  <span className="text-xs text-muted-foreground">
                    Seleccionar {pendientes.length} pendiente(s) ({formatPrice(totalPendiente)})
                  </span>
                </div>
              )}

              <div className="divide-y">
                {items.map((i) => (
                  <div
                    key={i.ordenId}
                    className={cn(
                      "flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors",
                      i.comisionPagada && "opacity-70"
                    )}
                  >
                    <div className="w-5 shrink-0">
                      {!readOnly && !i.comisionPagada && (
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-primary"
                          checked={selected.has(i.ordenId)}
                          onChange={() => toggleOne(i.ordenId)}
                        />
                      )}
                    </div>

                    <div className="flex-1 min-w-0 grid grid-cols-12 gap-2 items-center">
                      {/* Orden + dispositivo */}
                      <div className="col-span-12 sm:col-span-4 min-w-0">
                        <Link
                          href={`/ordenes/${i.ordenId}`}
                          className="inline-flex items-center gap-1 font-medium text-sm text-primary hover:underline"
                        >
                          {i.codigoOrden || `#${i.numeroOrden}`}
                          <ExternalLink className="h-3 w-3" />
                        </Link>
                        <div className="text-sm truncate">{i.dispositivo}</div>
                        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <CalIcon className="h-3 w-3" />
                          {i.fechaCompletado ? formatDate(i.fechaCompletado) : "-"}
                        </div>
                      </div>

                      {/* Números */}
                      <div className="col-span-8 sm:col-span-5 grid grid-cols-3 gap-2 text-xs">
                        <div>
                          <div className="text-muted-foreground">Cobrado</div>
                          <div className="font-medium">{formatPrice(i.costoFinal)}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Repuestos</div>
                          <div className="text-muted-foreground">-{formatPrice(i.costoRepuestos)}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Ganancia</div>
                          <div className="font-medium">{formatPrice(i.ganancia)}</div>
                        </div>
                      </div>

                      {/* Comisión + estado */}
                      <div className="col-span-4 sm:col-span-3 flex flex-col items-end gap-1">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-[10px]">
                            <Percent className="h-3 w-3 mr-0.5" />
                            {i.porcentajeComision.toFixed(2)}
                          </Badge>
                          <span className="font-semibold text-sm text-primary">
                            {formatPrice(i.montoComision)}
                          </span>
                        </div>
                        {i.comisionPagada ? (
                          readOnly ? (
                            <span
                              className="inline-flex items-center gap-1 text-[10px] text-success-700 dark:text-success-500"
                              title={
                                i.fechaPagoComision ? `Pagada ${formatDate(i.fechaPagoComision)}` : ""
                              }
                            >
                              <CheckCircle2 className="h-3 w-3" />
                              Pagada
                            </span>
                          ) : (
                            <button
                              onClick={() => handleRevertir(i.ordenId)}
                              className="inline-flex items-center gap-1 text-[10px] text-success-700 dark:text-success-500 hover:underline"
                              title={i.fechaPagoComision ? `Pagada ${formatDate(i.fechaPagoComision)}` : ""}
                            >
                              <CheckCircle2 className="h-3 w-3" />
                              Pagada
                              <RotateCcw className="h-2.5 w-2.5 ml-0.5" />
                            </button>
                          )
                        ) : (
                          <Badge variant="warning" className="text-[10px]">
                            Pendiente
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Historial de pagos */}
      {pagosAgrupados.length > 0 && (
        <div>
          <FieldSectionLabel icon={CheckCircle2} className="mb-2">
            Historial de liquidaciones
          </FieldSectionLabel>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {pagosAgrupados.map((p) => (
              <Card key={p.fecha}>
                <CardContent className="p-3">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="text-xs text-muted-foreground">{formatDate(p.fecha)}</div>
                      <div className="font-semibold text-lg">{formatPrice(p.total)}</div>
                    </div>
                    <Badge variant="outline" className="text-[10px]">
                      {p.ordenes.length} orden(es)
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function KpiCard({
  icon,
  label,
  value,
  hint,
  accent,
}: {
  icon: React.ReactNode
  label: string
  value: string
  hint?: string
  accent?: "primary" | "success"
}) {
  return (
    <Card>
      <CardContent className="p-3 sm:p-4">
        <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
          <span>{label}</span>
          <span
            className={cn(
              "p-1 rounded-md",
              accent === "primary" && "bg-primary/10 text-primary",
              accent === "success" && "bg-success-100/60 text-success-700 dark:bg-success/15 dark:text-success-400",
              !accent && "bg-muted text-muted-foreground"
            )}
          >
            {icon}
          </span>
        </div>
        <div
          className={cn(
            "text-xl sm:text-2xl font-bold truncate",
            accent === "primary" && "text-primary",
            accent === "success" && "text-success-600"
          )}
        >
          {value}
        </div>
        {hint && <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div>}
      </CardContent>
    </Card>
  )
}
