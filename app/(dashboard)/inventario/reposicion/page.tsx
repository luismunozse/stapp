"use client"

import { useState, useMemo, useCallback, useEffect } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import useSWR from "swr"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  ArrowLeft,
  Truck,
  Loader2,
  AlertTriangle,
  Flame,
  TrendingDown,
  Package,
  ChevronDown,
  ChevronRight,
  Sparkles,
} from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"

interface RepoItem {
  inventarioId: string
  codigo: string
  nombre: string
  categoria: string
  tipoDispositivo: string
  proveedorId: string | null
  proveedorNombre: string | null
  leadTimeDias: number | null
  stockActual: number
  stockMinimo: number | null
  puntoReorden: number | null
  stockMaximo: number | null
  umbralAplicado: number
  demanda30d: number
  demandaDiariaAvg: number
  diasStockRestante: number | null
  cantidadSugerida: number
  precioCompra: number
  costoEstimado: number
  prioridad: "CRITICA" | "ALTA" | "MEDIA" | "BAJA"
}

interface GrupoProveedor {
  proveedorId: string | null
  proveedorNombre: string | null
  leadTimeDias: number | null
  items: RepoItem[]
  subtotal: number
}

interface ReposicionResp {
  coberturaDias: number
  totales: { items: number; criticos: number; altos: number; costoTotal: number }
  proveedores: GrupoProveedor[]
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

function prioridadBadge(p: RepoItem["prioridad"]) {
  switch (p) {
    case "CRITICA":
      return <Badge variant="outline" className="gap-1 border-destructive text-destructive bg-destructive/10"><Flame className="h-3 w-3" /> Crítica</Badge>
    case "ALTA":
      return <Badge variant="outline" className="gap-1 border-amber-500 text-amber-600 bg-amber-500/10"><AlertTriangle className="h-3 w-3" /> Alta</Badge>
    case "MEDIA":
      return <Badge variant="outline" className="gap-1 border-blue-500/60 text-blue-600"><TrendingDown className="h-3 w-3" /> Media</Badge>
    case "BAJA":
      return <Badge variant="outline" className="gap-1 text-muted-foreground">Baja</Badge>
  }
}

export default function ReposicionPage() {
  const router = useRouter()
  const { formatPrice } = useCurrency()
  const [coberturaDias, setCoberturaDias] = useState(30)
  const [soloCriticos, setSoloCriticos] = useState(false)

  const url = `/api/inventario/reposicion?coberturaDias=${coberturaDias}&soloCriticos=${soloCriticos}`
  const { data, isLoading, mutate } = useSWR<ReposicionResp>(url, fetcher)

  // Local edits: { [inventarioId]: cantidad } y selección { [inventarioId]: boolean }
  const [cantidades, setCantidades] = useState<Record<string, number>>({})
  const [seleccion, setSeleccion] = useState<Record<string, boolean>>({})
  const [expandidos, setExpandidos] = useState<Record<string, boolean>>({})
  const [generating, setGenerating] = useState(false)

  // Inicializar cantidades + seleccion cuando llegan datos
  useEffect(() => {
    if (!data) return
    const nuevasCants: Record<string, number> = {}
    const nuevaSel: Record<string, boolean> = {}
    const nuevoExp: Record<string, boolean> = {}
    for (const g of data.proveedores) {
      nuevoExp[g.proveedorId || "__none__"] = true
      for (const it of g.items) {
        nuevasCants[it.inventarioId] = it.cantidadSugerida
        // Pre-seleccionar críticos y altos
        nuevaSel[it.inventarioId] = it.prioridad === "CRITICA" || it.prioridad === "ALTA"
      }
    }
    setCantidades(nuevasCants)
    setSeleccion(nuevaSel)
    setExpandidos((prev) => ({ ...nuevoExp, ...prev }))
  }, [data])

  const seleccionados = useMemo(() => {
    if (!data) return [] as { grupo: GrupoProveedor; items: RepoItem[]; subtotal: number }[]
    return data.proveedores
      .map((g) => {
        const items = g.items.filter((it) => seleccion[it.inventarioId] && (cantidades[it.inventarioId] ?? 0) > 0)
        const subtotal = items.reduce((s, it) => s + (cantidades[it.inventarioId] ?? 0) * it.precioCompra, 0)
        return { grupo: g, items, subtotal }
      })
      .filter((g) => g.items.length > 0)
  }, [data, seleccion, cantidades])

  const totalSeleccionado = seleccionados.reduce((s, g) => s + g.subtotal, 0)
  const itemsSeleccionados = seleccionados.reduce((s, g) => s + g.items.length, 0)

  const toggleGrupo = useCallback((key: string, value: boolean) => {
    if (!data) return
    const grupo = data.proveedores.find((g) => (g.proveedorId || "__none__") === key)
    if (!grupo) return
    setSeleccion((prev) => {
      const next = { ...prev }
      for (const it of grupo.items) next[it.inventarioId] = value
      return next
    })
  }, [data])

  const handleGenerar = async () => {
    if (seleccionados.length === 0) return
    if (!confirm(`Generar ${seleccionados.length} OC en BORRADOR con ${itemsSeleccionados} items por ${formatPrice(totalSeleccionado)}?`)) return
    setGenerating(true)
    try {
      const body = {
        grupos: seleccionados.map((g) => ({
          proveedorId: g.grupo.proveedorId,
          notas: `Reposición sugerida (cobertura ${coberturaDias}d)`,
          items: g.items.map((it) => ({
            inventarioId: it.inventarioId,
            cantidad: cantidades[it.inventarioId],
            precioUnitario: it.precioCompra,
            descripcion: `${it.nombre} (${it.codigo})`,
          })),
        })),
      }
      const res = await fetch("/api/inventario/reposicion/generar-oc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok && res.status !== 207) {
        alert(json.error || "Error al generar OCs")
        return
      }
      const msg = json.errores > 0
        ? `${json.creadas} OC creadas, ${json.errores} fallaron`
        : `${json.creadas} OC creadas en BORRADOR`
      alert(msg)
      router.push("/ordenes-compra")
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <Link href="/inventario">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
              <Sparkles className="h-6 w-6 text-primary" /> Reposición sugerida
            </h1>
            <p className="text-sm text-muted-foreground">
              Sugerencias basadas en stock, umbrales, demanda 30d y lead time del proveedor.
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground">Cobertura</label>
          <Select value={String(coberturaDias)} onValueChange={(v) => setCoberturaDias(Number(v))}>
            <SelectTrigger className="w-32 h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">7 días</SelectItem>
              <SelectItem value="14">14 días</SelectItem>
              <SelectItem value="30">30 días</SelectItem>
              <SelectItem value="45">45 días</SelectItem>
              <SelectItem value="60">60 días</SelectItem>
              <SelectItem value="90">90 días</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button
          variant={soloCriticos ? "default" : "outline"}
          size="sm"
          onClick={() => setSoloCriticos((v) => !v)}
        >
          <Flame className="h-3.5 w-3.5 mr-1" />
          Solo críticos
        </Button>
        <Button variant="ghost" size="sm" onClick={() => mutate()}>
          Recalcular
        </Button>
      </div>

      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card><CardContent className="p-3">
            <div className="text-[10px] uppercase text-muted-foreground">Items</div>
            <div className="text-xl font-bold">{data.totales.items}</div>
          </CardContent></Card>
          <Card><CardContent className="p-3">
            <div className="text-[10px] uppercase text-muted-foreground">Críticos</div>
            <div className="text-xl font-bold text-destructive">{data.totales.criticos}</div>
          </CardContent></Card>
          <Card><CardContent className="p-3">
            <div className="text-[10px] uppercase text-muted-foreground">Altos</div>
            <div className="text-xl font-bold text-amber-600">{data.totales.altos}</div>
          </CardContent></Card>
          <Card><CardContent className="p-3">
            <div className="text-[10px] uppercase text-muted-foreground">Costo total</div>
            <div className="text-lg font-bold">{formatPrice(data.totales.costoTotal)}</div>
          </CardContent></Card>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !data || data.proveedores.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Nada que reponer. Todo el stock está por encima del umbral.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {data.proveedores.map((g) => {
            const key = g.proveedorId || "__none__"
            const expanded = expandidos[key] ?? true
            const seleccionadosGrupo = g.items.filter((it) => seleccion[it.inventarioId]).length
            const allSelected = seleccionadosGrupo === g.items.length
            return (
              <Card key={key}>
                <CardHeader
                  className="p-3 cursor-pointer hover:bg-muted/30"
                  onClick={() => setExpandidos((p) => ({ ...p, [key]: !expanded }))}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      {expanded ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                      <input
                        type="checkbox"
                        checked={allSelected}
                        ref={(el) => { if (el) el.indeterminate = seleccionadosGrupo > 0 && !allSelected }}
                        onChange={(e) => toggleGrupo(key, e.target.checked)}
                        onClick={(e) => e.stopPropagation()}
                        className="h-4 w-4"
                      />
                      <Truck className="h-4 w-4 text-muted-foreground" />
                      <CardTitle className="text-sm font-medium truncate">
                        {g.proveedorNombre || "Sin proveedor asignado"}
                      </CardTitle>
                      {g.leadTimeDias !== null && (
                        <Badge variant="secondary" className="text-[10px]">Lead {g.leadTimeDias}d</Badge>
                      )}
                      <Badge variant="outline" className="text-[10px]">{g.items.length} items</Badge>
                    </div>
                    <div className="text-sm font-semibold shrink-0">{formatPrice(g.subtotal)}</div>
                  </div>
                </CardHeader>
                {expanded && (
                  <CardContent className="p-0">
                    <div className="divide-y text-sm">
                      {g.items.map((it) => {
                        const checked = !!seleccion[it.inventarioId]
                        const qty = cantidades[it.inventarioId] ?? 0
                        return (
                          <div key={it.inventarioId} className="flex items-center gap-2 px-3 py-2">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) =>
                                setSeleccion((p) => ({ ...p, [it.inventarioId]: e.target.checked }))
                              }
                              className="h-4 w-4 shrink-0"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-medium truncate">{it.nombre}</span>
                                {prioridadBadge(it.prioridad)}
                                <Badge variant="secondary" className="text-[10px]">{it.codigo}</Badge>
                              </div>
                              <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-3 flex-wrap">
                                <span>Stock {it.stockActual} / umbral {it.umbralAplicado}</span>
                                {it.demanda30d > 0 && (
                                  <span>{it.demanda30d} vendidos / 30d ({it.demandaDiariaAvg.toFixed(2)}/día)</span>
                                )}
                                {it.diasStockRestante !== null && (
                                  <span className={it.diasStockRestante <= (it.leadTimeDias ?? 7) ? "text-amber-600 font-medium" : ""}>
                                    {it.diasStockRestante.toFixed(0)}d restantes
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="w-20 shrink-0">
                              <Input
                                type="number"
                                min={0}
                                step={1}
                                value={qty}
                                onChange={(e) =>
                                  setCantidades((p) => ({
                                    ...p,
                                    [it.inventarioId]: Math.max(0, parseInt(e.target.value) || 0),
                                  }))
                                }
                                className="h-8 text-center text-sm"
                              />
                            </div>
                            <div className="w-24 text-right text-xs shrink-0">
                              {formatPrice(qty * it.precioCompra)}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </CardContent>
                )}
              </Card>
            )
          })}
        </div>
      )}

      {itemsSeleccionados > 0 && (
        <div className="sticky bottom-4 z-10 flex items-center justify-between gap-3 rounded-lg border bg-background shadow-lg p-3">
          <div className="text-sm">
            <span className="font-semibold">{itemsSeleccionados} items</span> en{" "}
            <span className="font-semibold">{seleccionados.length} OC</span> ·{" "}
            <span className="font-bold">{formatPrice(totalSeleccionado)}</span>
          </div>
          <Button onClick={handleGenerar} disabled={generating}>
            {generating && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
            <Truck className="h-4 w-4 mr-1" /> Generar {seleccionados.length} OC
          </Button>
        </div>
      )}
    </div>
  )
}
