"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import useSWR from "swr"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
import { Percent, CheckCircle2, DollarSign, Users, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { useCurrency } from "@/contexts/currency-context"
import { useModal } from "@/contexts/modal-context"
import { EmptyState } from "@/components/ui/empty-state"
import { AnularPagoDialog } from "@/components/comisiones/anular-pago-dialog"
import { commissionKindLabel, type CommissionBaseKind, type CommissionKind, type CommissionRole } from "@/lib/commissions/types"
import { orderBaseBreakdown, type BreakdownLine } from "@/lib/commissions/breakdown"
import { round2 } from "@/lib/precios"

interface Item {
  clave: string
  ordenId: string | null
  rol: string
  tipo: CommissionKind
  pagoId: string | null
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
  // What the base was taken from (optional: older payloads omit them).
  montoOrden?: number | null
  baseTipo?: CommissionBaseKind | null
  porcentajeComision: number
  montoComision: number
  comisionPagada: boolean
  fechaPagoComision: string | null
}

function breakdownOf(i: Item): BreakdownLine[] {
  return orderBaseBreakdown({
    tipo: i.tipo,
    pagado: i.comisionPagada,
    baseTipo: i.baseTipo,
    documentoTotal: i.costoFinal,
    documentoMonto: i.montoOrden,
    documentoCostoRepuestos: i.costoRepuestos,
  })
}

interface Resumen {
  tecnicoId: string
  tecnicoNombre: string
  totalOrdenes: number
  totalGanancia: number
  totalComision: number
  totalPendiente: number
}

interface ApiResp {
  items: Item[]
  resumen: Resumen[]
}

interface Tecnico {
  id: string
  nombre: string
}

function toISODate(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function rangoSemanaActual() {
  const hoy = new Date()
  const dia = hoy.getDay() // 0=Dom
  const diffLunes = dia === 0 ? -6 : 1 - dia
  const lunes = new Date(hoy)
  lunes.setDate(hoy.getDate() + diffLunes)
  const domingo = new Date(lunes)
  domingo.setDate(lunes.getDate() + 6)
  return { desde: toISODate(lunes), hasta: toISODate(domingo) }
}

const fetcher = async (url: string) => {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

interface ComisionesViewProps {
  tecnicoIdFijo?: string
  rol?: Extract<CommissionRole, "TECNICO" | "RECEPCION">
}

export function ComisionesView({ tecnicoIdFijo, rol = "TECNICO" }: ComisionesViewProps = {}) {
  const esRecepcion = rol === "RECEPCION"
  const { formatPrice, formatDate } = useCurrency()
  const { confirm } = useModal()

  const [tecnicoId, setTecnicoId] = useState<string>(tecnicoIdFijo || "all")
  const [soloPendientes, setSoloPendientes] = useState(true)
  const semana = useMemo(rangoSemanaActual, [])
  const [desde, setDesde] = useState(semana.desde)
  const [hasta, setHasta] = useState(semana.hasta)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [paying, setPaying] = useState(false)
  const [anular, setAnular] = useState<{ pagoId: string | null; fecha: string | null } | null>(null)

  // Reception can be earned by any staff role, so its people come from all operators.
  const { data: operadores = [] } = useSWR<Tecnico[]>(
    tecnicoIdFijo ? null : esRecepcion ? "/api/operadores" : "/api/tecnicos",
    fetcher
  )

  const effectiveTecnicoId = tecnicoIdFijo || tecnicoId

  const qs = new URLSearchParams()
  qs.set("rol", rol)
  if (effectiveTecnicoId && effectiveTecnicoId !== "all") qs.set("tecnicoId", effectiveTecnicoId)
  if (desde) qs.set("desde", desde)
  if (hasta) qs.set("hasta", hasta + "T23:59:59")
  if (soloPendientes) qs.set("soloPendientes", "true")

  const { data, isLoading, error, mutate } = useSWR<ApiResp>(
    `/api/comisiones?${qs.toString()}`,
    fetcher,
    { revalidateOnFocus: false }
  )

  useEffect(() => {
    setSelected(new Set())
  }, [effectiveTecnicoId, desde, hasta, soloPendientes])

  const items = data?.items || []
  const resumen = data?.resumen || []

  // /api/operadores only lists active people of the current sucursal, but a removed
  // receiver can still hold pending rows. Remember everyone seen in the data so they
  // stay selectable, including after the filter narrows the data to them.
  const seenPeople = useRef(new Map<string, string>())
  if (esRecepcion) {
    for (const i of items) seenPeople.current.set(i.tecnicoId, i.tecnicoNombre)
    for (const r of resumen) seenPeople.current.set(r.tecnicoId, r.tecnicoNombre)
  }
  const tecnicos = useMemo(() => {
    if (!esRecepcion) return operadores
    const byId = new Map<string, Tecnico>()
    for (const o of operadores) byId.set(o.id, o)
    for (const [id, nombre] of seenPeople.current) if (!byId.has(id)) byId.set(id, { id, nombre })
    return Array.from(byId.values()).sort((a, b) => a.nombre.localeCompare(b.nombre))
    // seenPeople is a ref: it is refreshed on every render that brings new data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [esRecepcion, operadores, data])

  // A zero-amount row can be listed but never paid.
  const pagable = (i: Item) => !i.comisionPagada && i.montoComision !== 0
  const pendientesIds = items.filter(pagable).map((i) => i.clave)
  const allSelected =
    pendientesIds.length > 0 && pendientesIds.every((id) => selected.has(id))

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set())
    } else {
      setSelected(new Set(pendientesIds))
    }
  }

  const toggleOne = (clave: string) => {
    const next = new Set(selected)
    if (next.has(clave)) next.delete(clave)
    else next.add(clave)
    setSelected(next)
  }

  const selectedItems = items.filter((i) => selected.has(i.clave) && pagable(i))

  const selectLabel = (i: Item) => {
    const kind = commissionKindLabel(i.tipo, "ORDEN")
    const doc = i.codigoOrden || (i.numeroOrden != null ? `#${i.numeroOrden}` : "")
    return `Seleccionar comisión ${doc}${kind ? (doc ? ` (${kind})` : kind) : ""}`.trim()
  }

  const totalSeleccionado = round2(selectedItems.reduce((acc, i) => acc + i.montoComision, 0))
  const mixedPeople = new Set(selectedItems.map((i) => i.tecnicoId)).size > 1

  const handlePagar = async () => {
    if (selectedItems.length === 0 || mixedPeople) return
    const ok = await confirm({
      title: "Pagar comisiones",
      description:
        totalSeleccionado < 0
          ? `El total es negativo (${formatPrice(totalSeleccionado)}): se registra como descuento a favor del taller. ¿Confirmás?`
          : `¿Marcar ${selectedItems.length} comisión(es) como pagadas? Total: ${formatPrice(totalSeleccionado)}`,
      confirmText: "Confirmar pago",
      variant: "info",
    })
    if (!ok) return

    setPaying(true)
    try {
      const res = await fetch("/api/comisiones/pagar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          beneficiarioId: selectedItems[0].tecnicoId,
          filas: selectedItems.map((r) => ({ clave: r.clave, monto: r.montoComision })),
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast.error(body?.error ?? "No se pudo marcar como pagadas")
        mutate()
        return
      }
      toast.success("Comisiones marcadas como pagadas")
      setSelected(new Set())
      mutate()
    } catch {
      toast.error("No se pudo marcar como pagadas")
    } finally {
      setPaying(false)
    }
  }

  const handleAnulado = () => {
    setSelected(new Set())
    mutate()
  }

  const orderLink = (i: Item, className: string) =>
    i.ordenId ? (
      <Link href={`/ordenes/${i.ordenId}`} className={className}>
        {i.codigoOrden || `#${i.numeroOrden}`}
      </Link>
    ) : (
      <span className="text-muted-foreground">—</span>
    )

  const kindBadge = (i: Item) => {
    const label = commissionKindLabel(i.tipo, "ORDEN")
    return label ? (
      <Badge variant="secondary" className="text-[10px] shrink-0">
        {label}
      </Badge>
    ) : null
  }

  const setSemanaActual = () => {
    const r = rangoSemanaActual()
    setDesde(r.desde)
    setHasta(r.hasta)
  }

  return (
    <div className="space-y-6">
      {/* Filtros */}
      <Card>
        <CardContent className="p-4 sm:p-6">
          <div className={`grid gap-3 sm:grid-cols-2 ${tecnicoIdFijo ? "lg:grid-cols-4" : "lg:grid-cols-5"}`}>
            {!tecnicoIdFijo && (
              <div className="space-y-1">
                <Label className="text-xs">{esRecepcion ? "Persona" : "Técnico"}</Label>
                <Select value={tecnicoId} onValueChange={setTecnicoId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    {tecnicos.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.nombre}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-xs">Desde</Label>
              <Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Hasta</Label>
              <Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
            </div>
            <div className="flex items-end">
              <Button variant="outline" className="w-full" onClick={setSemanaActual}>
                Semana actual
              </Button>
            </div>
            <div className="flex items-end gap-2">
              <input
                id="soloPendientes"
                type="checkbox"
                className="h-4 w-4 accent-primary"
                checked={soloPendientes}
                onChange={(e) => setSoloPendientes(e.target.checked)}
              />
              <Label htmlFor="soloPendientes" className="text-sm cursor-pointer">
                Solo pendientes
              </Label>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Resumen por técnico */}
      {resumen.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {resumen.map((r) => (
            <Card key={r.tecnicoId}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  {r.tecnicoNombre}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Órdenes</span>
                  <span>{r.totalOrdenes}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Base</span>
                  <span>{formatPrice(r.totalGanancia)}</span>
                </div>
                <div className="flex justify-between font-medium">
                  <span>Comisión total</span>
                  <span>{formatPrice(r.totalComision)}</span>
                </div>
                <div className="flex justify-between pt-1 border-t">
                  <span className="text-muted-foreground">Pendiente</span>
                  <span className="font-semibold text-primary">
                    {formatPrice(r.totalPendiente)}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Acciones bulk */}
      {selectedItems.length > 0 && (
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 p-3 rounded-md bg-info-50 border border-info/30">
          <div className="text-sm text-info-700">
            <strong>{selectedItems.length}</strong> seleccionada(s) ·{" "}
            Total: <strong>{formatPrice(totalSeleccionado)}</strong>
            {mixedPeople && (
              <div className="text-xs mt-0.5">
                Elegí comisiones de una sola persona para pagarlas juntas.
              </div>
            )}
          </div>
          <Button onClick={handlePagar} disabled={paying || mixedPeople}>
            {paying ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <DollarSign className="h-4 w-4 mr-2" />
            )}
            Marcar como pagadas
          </Button>
        </div>
      )}

      {/* Tabla */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="py-10 text-center text-muted-foreground">Cargando…</div>
          ) : error ? (
            <div role="alert" className="py-10 text-center text-sm text-destructive">
              No se pudieron cargar las comisiones.
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              icon={Percent}
              title={esRecepcion ? "Sin comisiones de recepción" : "Sin comisiones"}
              description={
                esRecepcion
                  ? "Aparecen cuando una orden recibida con porcentaje de recepción cumple la regla del taller. El porcentaje se configura en Configuración › Comisiones."
                  : "Ajustá el período o los filtros."
              }
              variant="search"
            />
          ) : (
            <>
            {/* Desktop: tabla */}
            <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase">
                <tr>
                  <th className="p-2 text-left">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-primary"
                      aria-label="Seleccionar todas las pendientes"
                      checked={allSelected}
                      onChange={toggleAll}
                      disabled={pendientesIds.length === 0}
                    />
                  </th>
                  <th className="p-2 text-left">Orden</th>
                  <th className="p-2 text-left">{esRecepcion ? "Persona" : "Técnico"}</th>
                  <th className="p-2 text-left">Dispositivo</th>
                  <th className="p-2 text-right">Costo final</th>
                  <th className="p-2 text-right">Desc./NC</th>
                  <th className="p-2 text-right">Repuestos</th>
                  <th className="p-2 text-right">Base</th>
                  <th className="p-2 text-right">%</th>
                  <th className="p-2 text-right">Comisión</th>
                  <th className="p-2 text-left">Completado</th>
                  <th className="p-2 text-left">Estado</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => {
                  const lines = breakdownOf(i)
                  const cell = (key: BreakdownLine["key"]) => {
                    const line = lines.find((l) => l.key === key)
                    return line ? formatPrice(line.amount) : "—"
                  }
                  return (
                  <tr key={i.clave} className="border-t hover:bg-muted/30">
                    <td className="p-2">
                      {!i.comisionPagada && (
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-primary"
                          aria-label={selectLabel(i)}
                          checked={selected.has(i.clave)}
                          onChange={() => toggleOne(i.clave)}
                          disabled={!pagable(i)}
                        />
                      )}
                    </td>
                    <td className="p-2">
                      <div className="flex items-center gap-1.5">
                        {orderLink(i, "text-primary hover:underline")}
                        {kindBadge(i)}
                      </div>
                    </td>
                    <td className="p-2">{i.tecnicoNombre}</td>
                    <td className="p-2">{i.dispositivo}</td>
                    <td className="p-2 text-right">{cell("costoFinal")}</td>
                    <td className="p-2 text-right text-muted-foreground">{cell("descuentos")}</td>
                    <td className="p-2 text-right text-muted-foreground">{cell("repuestos")}</td>
                    <td className="p-2 text-right">{formatPrice(i.ganancia)}</td>
                    <td className="p-2 text-right">
                      <Badge variant="outline" className="text-xs">
                        <Percent className="h-3 w-3 mr-0.5" />
                        {i.porcentajeComision.toFixed(2)}
                      </Badge>
                    </td>
                    <td className="p-2 text-right font-semibold">{formatPrice(i.montoComision)}</td>
                    <td className="p-2">
                      {i.fechaCompletado ? formatDate(i.fechaCompletado) : "-"}
                    </td>
                    <td className="p-2">
                      {i.comisionPagada ? (
                        <button
                          onClick={() => setAnular({ pagoId: i.pagoId, fecha: i.fechaPagoComision })}
                          className="inline-flex items-center gap-1 text-xs text-success-700 dark:text-success-500 hover:underline"
                        >
                          <CheckCircle2 className="h-3 w-3" />
                          Pagada
                        </button>
                      ) : (
                        <Badge variant="warning" className="text-xs">Pendiente</Badge>
                      )}
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
            </div>

            {/* Mobile: cards */}
            <div className="sm:hidden divide-y">
              {items.map((i) => (
                <div key={i.clave} className="p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {!i.comisionPagada && (
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-primary shrink-0"
                          aria-label={selectLabel(i)}
                          checked={selected.has(i.clave)}
                          onChange={() => toggleOne(i.clave)}
                          disabled={!pagable(i)}
                        />
                      )}
                      {orderLink(i, "text-primary hover:underline font-medium truncate")}
                      {kindBadge(i)}
                    </div>
                    {i.comisionPagada ? (
                      <button
                        onClick={() => setAnular({ pagoId: i.pagoId, fecha: i.fechaPagoComision })}
                        className="inline-flex items-center gap-1 text-xs text-success-700 dark:text-success-500 hover:underline shrink-0"
                      >
                        <CheckCircle2 className="h-3 w-3" />
                        Pagada
                      </button>
                    ) : (
                      <Badge variant="warning" className="text-xs shrink-0">Pendiente</Badge>
                    )}
                  </div>
                  <div className="text-sm text-muted-foreground truncate">
                    {i.tecnicoNombre} · {i.dispositivo}
                  </div>
                  <div className="flex items-end justify-between gap-2">
                    <div className="text-xs text-muted-foreground space-y-0.5">
                      {breakdownOf(i).length > 0 && (
                        <div>
                          {breakdownOf(i).map((l) => `${l.shortLabel} ${formatPrice(l.amount)}`).join(" · ")}
                        </div>
                      )}
                      <div>Base {formatPrice(i.ganancia)}{i.fechaCompletado ? ` · ${formatDate(i.fechaCompletado)}` : ""}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <Badge variant="outline" className="text-[10px] mb-1">
                        <Percent className="h-3 w-3 mr-0.5" />
                        {i.porcentajeComision.toFixed(2)}
                      </Badge>
                      <div className="font-semibold">{formatPrice(i.montoComision)}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            </>
          )}
        </CardContent>
      </Card>

      <AnularPagoDialog
        open={anular !== null}
        onOpenChange={(o) => {
          if (!o) setAnular(null)
        }}
        pagoId={anular?.pagoId ?? null}
        fechaPago={anular?.fecha ?? null}
        endpoint="/api/comisiones/pagar"
        onAnulado={handleAnulado}
      />
    </div>
  )
}
