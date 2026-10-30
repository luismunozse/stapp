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
import { AnularPagoDialog } from "@/components/comisiones/anular-pago-dialog"
import { COMMISSION_KIND_LABEL, type CommissionKind } from "@/lib/commissions/types"
import { round2 } from "@/lib/precios"

interface Item {
  clave: string
  ventaId: string | null
  vendedorId: string
  vendedorNombre: string
  tipo: CommissionKind
  pagoId: string | null
  numeroVenta: number | null
  clienteNombre: string | null
  fecha: string | null
  total: number
  porcentajeComision: number
  montoComision: number
  comisionPagada: boolean
  fechaPagoComision: string | null
}

interface Resumen {
  vendedorId: string
  vendedorNombre: string
  totalVentas: number
  totalFacturado: number
  totalComision: number
  totalPendiente: number
}

interface ApiResp {
  items: Item[]
  resumen: Resumen[]
}

interface Vendedor {
  id: string
  nombre: string
}

interface VendedoresListResp {
  data: Vendedor[]
}

function toISODate(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function rangoSemanaActual() {
  const hoy = new Date()
  const dia = hoy.getDay()
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

export function ComisionesVendedoresView() {
  const { formatPrice, formatDate } = useCurrency()
  const { confirm } = useModal()

  const [vendedorId, setVendedorId] = useState<string>("all")
  const [soloPendientes, setSoloPendientes] = useState(true)
  const semana = useMemo(rangoSemanaActual, [])
  const [desde, setDesde] = useState(semana.desde)
  const [hasta, setHasta] = useState(semana.hasta)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [paying, setPaying] = useState(false)
  const [anular, setAnular] = useState<{ pagoId: string | null; fecha: string | null } | null>(null)

  const { data: vendedoresResp } = useSWR<VendedoresListResp>(
    "/api/vendedores?limit=100",
    fetcher
  )
  const vendedores = vendedoresResp?.data || []

  const qs = new URLSearchParams()
  if (vendedorId && vendedorId !== "all") qs.set("vendedorId", vendedorId)
  if (desde) qs.set("desde", desde)
  if (hasta) qs.set("hasta", hasta + "T23:59:59")
  if (soloPendientes) qs.set("soloPendientes", "true")

  const { data, isLoading, error, mutate } = useSWR<ApiResp>(
    `/api/comisiones/vendedores?${qs.toString()}`,
    fetcher,
    { revalidateOnFocus: false }
  )

  useEffect(() => {
    setSelected(new Set())
  }, [vendedorId, desde, hasta, soloPendientes])

  const items = data?.items || []
  const resumen = data?.resumen || []

  // A zero-amount row can be listed but never paid.
  const pagable = (i: Item) => !i.comisionPagada && i.montoComision !== 0
  const pendientesIds = items.filter(pagable).map((i) => i.clave)
  const allSelected =
    pendientesIds.length > 0 && pendientesIds.every((id) => selected.has(id))

  const toggleAll = () => {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(pendientesIds))
  }

  const toggleOne = (clave: string) => {
    const next = new Set(selected)
    if (next.has(clave)) next.delete(clave)
    else next.add(clave)
    setSelected(next)
  }

  const selectedItems = items.filter((i) => selected.has(i.clave) && pagable(i))

  const selectLabel = (i: Item) => {
    const kind = COMMISSION_KIND_LABEL[i.tipo]
    const doc = i.numeroVenta != null ? `#${i.numeroVenta}` : ""
    return `Seleccionar comisión ${doc}${kind ? (doc ? ` (${kind})` : kind) : ""}`.trim()
  }

  const totalSeleccionado = round2(selectedItems.reduce((acc, i) => acc + i.montoComision, 0))
  const mixedPeople = new Set(selectedItems.map((i) => i.vendedorId)).size > 1

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
      const res = await fetch("/api/comisiones/vendedores/pagar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          beneficiarioId: selectedItems[0].vendedorId,
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

  const saleLink = (i: Item, className: string) =>
    i.ventaId ? (
      <Link href={`/ventas/${i.ventaId}`} className={className}>
        #{i.numeroVenta}
      </Link>
    ) : (
      <span className="text-muted-foreground">—</span>
    )

  const kindBadge = (i: Item) => {
    const label = COMMISSION_KIND_LABEL[i.tipo]
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
      <Card>
        <CardContent className="p-4 sm:p-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="space-y-1">
              <Label className="text-xs">Vendedor</Label>
              <Select value={vendedorId} onValueChange={setVendedorId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {vendedores.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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
                id="soloPendientesVend"
                type="checkbox"
                className="h-4 w-4 accent-primary"
                checked={soloPendientes}
                onChange={(e) => setSoloPendientes(e.target.checked)}
              />
              <Label htmlFor="soloPendientesVend" className="text-sm cursor-pointer">
                Solo pendientes
              </Label>
            </div>
          </div>
        </CardContent>
      </Card>

      {resumen.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {resumen.map((r) => (
            <Card key={r.vendedorId}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  {r.vendedorNombre}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Ventas</span>
                  <span>{r.totalVentas}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Facturado</span>
                  <span>{formatPrice(r.totalFacturado)}</span>
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

      {selectedItems.length > 0 && (
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 p-3 rounded-md bg-info-50 border border-info/30">
          <div className="text-sm text-info-700">
            <strong>{selectedItems.length}</strong> seleccionada(s) ·{" "}
            Total: <strong>{formatPrice(totalSeleccionado)}</strong>
            {mixedPeople && (
              <div className="text-xs mt-0.5">
                Elegí comisiones de un solo vendedor para pagarlas juntas.
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
                      aria-label="Seleccionar todas las pendientes"
                      checked={allSelected}
                      onChange={toggleAll}
                      disabled={pendientesIds.length === 0}
                    />
                  </th>
                  <th className="p-2 text-left">Venta</th>
                  <th className="p-2 text-left">Vendedor</th>
                  <th className="p-2 text-left">Cliente</th>
                  <th className="p-2 text-right">Total</th>
                  <th className="p-2 text-right">%</th>
                  <th className="p-2 text-right">Comisión</th>
                  <th className="p-2 text-left">Fecha</th>
                  <th className="p-2 text-left">Estado</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
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
                        {saleLink(i, "text-primary hover:underline")}
                        {kindBadge(i)}
                      </div>
                    </td>
                    <td className="p-2">{i.vendedorNombre}</td>
                    <td className="p-2">{i.clienteNombre}</td>
                    <td className="p-2 text-right">{formatPrice(i.total)}</td>
                    <td className="p-2 text-right">
                      <Badge variant="outline" className="text-xs">
                        <Percent className="h-3 w-3 mr-0.5" />
                        {i.porcentajeComision.toFixed(2)}
                      </Badge>
                    </td>
                    <td className="p-2 text-right font-semibold">
                      {formatPrice(i.montoComision)}
                    </td>
                    <td className="p-2">{i.fecha ? formatDate(i.fecha) : "-"}</td>
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
                        <Badge variant="warning" className="text-xs">
                          Pendiente
                        </Badge>
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
                      {saleLink(i, "text-primary hover:underline font-medium truncate")}
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
                    {i.vendedorNombre}{i.clienteNombre ? ` · ${i.clienteNombre}` : ""}
                  </div>
                  <div className="flex items-end justify-between gap-2">
                    <div className="text-xs text-muted-foreground">
                      Total {formatPrice(i.total)}{i.fecha ? ` · ${formatDate(i.fecha)}` : ""}
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
        endpoint="/api/comisiones/vendedores/pagar"
        onAnulado={handleAnulado}
      />
    </div>
  )
}
