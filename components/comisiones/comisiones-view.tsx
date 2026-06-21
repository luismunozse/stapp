"use client"

import { useEffect, useMemo, useState } from "react"
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

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface ComisionesViewProps {
  tecnicoIdFijo?: string
}

export function ComisionesView({ tecnicoIdFijo }: ComisionesViewProps = {}) {
  const { formatPrice, formatDate } = useCurrency()
  const { confirm } = useModal()

  const [tecnicoId, setTecnicoId] = useState<string>(tecnicoIdFijo || "all")
  const [soloPendientes, setSoloPendientes] = useState(true)
  const semana = useMemo(rangoSemanaActual, [])
  const [desde, setDesde] = useState(semana.desde)
  const [hasta, setHasta] = useState(semana.hasta)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [paying, setPaying] = useState(false)

  const { data: tecnicos = [] } = useSWR<Tecnico[]>(
    tecnicoIdFijo ? null : "/api/tecnicos",
    fetcher
  )

  const effectiveTecnicoId = tecnicoIdFijo || tecnicoId

  const qs = new URLSearchParams()
  if (effectiveTecnicoId && effectiveTecnicoId !== "all") qs.set("tecnicoId", effectiveTecnicoId)
  if (desde) qs.set("desde", desde)
  if (hasta) qs.set("hasta", hasta + "T23:59:59")
  if (soloPendientes) qs.set("soloPendientes", "true")

  const { data, isLoading, mutate } = useSWR<ApiResp>(
    `/api/comisiones?${qs.toString()}`,
    fetcher,
    { revalidateOnFocus: false }
  )

  useEffect(() => {
    setSelected(new Set())
  }, [effectiveTecnicoId, desde, hasta, soloPendientes])

  const items = data?.items || []
  const resumen = data?.resumen || []

  const pendientesIds = items.filter((i) => !i.comisionPagada).map((i) => i.ordenId)
  const allSelected =
    pendientesIds.length > 0 && pendientesIds.every((id) => selected.has(id))

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set())
    } else {
      setSelected(new Set(pendientesIds))
    }
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

  const handlePagar = async () => {
    if (selected.size === 0) return
    const ok = await confirm({
      title: "Pagar comisiones",
      description: `¿Marcar ${selected.size} órden(es) como comisión pagada? Total: ${formatPrice(totalSeleccionado)}`,
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
      if (!res.ok) throw new Error("Error al pagar")
      toast.success("Comisiones marcadas como pagadas")
      setSelected(new Set())
      mutate()
    } catch (err) {
      toast.error("No se pudo marcar como pagadas")
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
                <Label className="text-xs">Técnico</Label>
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
                  <span className="text-muted-foreground">Ganancia</span>
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
      {selected.size > 0 && (
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 p-3 rounded-md bg-info-50 border border-info/30">
          <div className="text-sm text-info-700">
            <strong>{selected.size}</strong> seleccionada(s) ·{" "}
            Total: <strong>{formatPrice(totalSeleccionado)}</strong>
          </div>
          <Button onClick={handlePagar} disabled={paying}>
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
          ) : items.length === 0 ? (
            <EmptyState
              icon={Percent}
              title="Sin comisiones"
              description="Ajustá el período o los filtros."
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
                      checked={allSelected}
                      onChange={toggleAll}
                      disabled={pendientesIds.length === 0}
                    />
                  </th>
                  <th className="p-2 text-left">Orden</th>
                  <th className="p-2 text-left">Técnico</th>
                  <th className="p-2 text-left">Dispositivo</th>
                  <th className="p-2 text-right">Costo final</th>
                  <th className="p-2 text-right">Repuestos</th>
                  <th className="p-2 text-right">Ganancia</th>
                  <th className="p-2 text-right">%</th>
                  <th className="p-2 text-right">Comisión</th>
                  <th className="p-2 text-left">Completado</th>
                  <th className="p-2 text-left">Estado</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.ordenId} className="border-t hover:bg-muted/30">
                    <td className="p-2">
                      {!i.comisionPagada && (
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-primary"
                          checked={selected.has(i.ordenId)}
                          onChange={() => toggleOne(i.ordenId)}
                        />
                      )}
                    </td>
                    <td className="p-2">
                      <Link href={`/ordenes/${i.ordenId}`} className="text-primary hover:underline">
                        {i.codigoOrden || `#${i.numeroOrden}`}
                      </Link>
                    </td>
                    <td className="p-2">{i.tecnicoNombre}</td>
                    <td className="p-2">{i.dispositivo}</td>
                    <td className="p-2 text-right">{formatPrice(i.costoFinal)}</td>
                    <td className="p-2 text-right text-muted-foreground">
                      {formatPrice(i.costoRepuestos)}
                    </td>
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
                          onClick={() => handleRevertir(i.ordenId)}
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
                ))}
              </tbody>
            </table>
            </div>

            {/* Mobile: cards */}
            <div className="sm:hidden divide-y">
              {items.map((i) => (
                <div key={i.ordenId} className="p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {!i.comisionPagada && (
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-primary shrink-0"
                          checked={selected.has(i.ordenId)}
                          onChange={() => toggleOne(i.ordenId)}
                        />
                      )}
                      <Link href={`/ordenes/${i.ordenId}`} className="text-primary hover:underline font-medium truncate">
                        {i.codigoOrden || `#${i.numeroOrden}`}
                      </Link>
                    </div>
                    {i.comisionPagada ? (
                      <button
                        onClick={() => handleRevertir(i.ordenId)}
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
                      <div>Costo {formatPrice(i.costoFinal)} · Rep. {formatPrice(i.costoRepuestos)}</div>
                      <div>Ganancia {formatPrice(i.ganancia)}{i.fechaCompletado ? ` · ${formatDate(i.fechaCompletado)}` : ""}</div>
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
    </div>
  )
}
