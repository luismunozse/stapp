"use client"

import { useState, useMemo } from "react"
import Link from "next/link"
import useSWR from "swr"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ArrowLeft, Loader2, Search, BarChart3, Flame, TrendingUp, TrendingDown, Skull, Sparkles, Download } from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"

type AbcClass = "A" | "B" | "C" | "SIN_VENTAS"
type RotClass = "ALTA" | "MEDIA" | "BAJA" | "MUERTA" | "NUEVA"

interface Row {
  inventarioId: string
  codigo: string
  nombre: string
  categoria: string
  tipoDispositivo: string
  proveedorNombre: string | null
  stockActual: number
  precioCompra: number
  precioVenta: number
  capitalInmovilizado: number
  qtyVendida: number
  revenue: number
  margenTotal: number
  ventasCount: number
  ultimaVentaAt: string | null
  diasSinVenta: number | null
  rotacion: number
  diasPromedioStock: number | null
  pctRevenue: number
  pctRevenueAcumulado: number
  clasificacionAbc: AbcClass
  clasificacionRotacion: RotClass
}

interface Resp {
  periodo: { dias: number; diasMuerto: number }
  totales: { items: number; revenue: number; margenTotal: number; capitalInmovilizado: number; capitalMuerto: number }
  resumenAbc: {
    A: { count: number; revenue: number }
    B: { count: number; revenue: number }
    C: { count: number; revenue: number }
    SIN_VENTAS: { count: number; capitalInmovilizado: number }
  }
  resumenRotacion: Record<RotClass, number>
  data: Row[]
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

function abcBadge(c: AbcClass) {
  switch (c) {
    case "A": return <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white">A</Badge>
    case "B": return <Badge className="bg-blue-600 hover:bg-blue-600 text-white">B</Badge>
    case "C": return <Badge variant="secondary">C</Badge>
    case "SIN_VENTAS": return <Badge variant="outline" className="text-muted-foreground">—</Badge>
  }
}

function rotBadge(c: RotClass) {
  switch (c) {
    case "ALTA": return <Badge variant="outline" className="gap-1 border-emerald-500/60 text-emerald-600"><TrendingUp className="h-3 w-3" /> Alta</Badge>
    case "MEDIA": return <Badge variant="outline" className="gap-1 border-blue-500/60 text-blue-600">Media</Badge>
    case "BAJA": return <Badge variant="outline" className="gap-1 border-amber-500/60 text-amber-600"><TrendingDown className="h-3 w-3" /> Baja</Badge>
    case "MUERTA": return <Badge variant="outline" className="gap-1 border-destructive text-destructive bg-destructive/10"><Skull className="h-3 w-3" /> Muerta</Badge>
    case "NUEVA": return <Badge variant="outline" className="gap-1 border-purple-500/60 text-purple-600"><Sparkles className="h-3 w-3" /> Nueva</Badge>
  }
}

export default function AnalisisAbcPage() {
  const { formatPrice } = useCurrency()
  const [dias, setDias] = useState(90)
  const [diasMuerto, setDiasMuerto] = useState(90)
  const [filtroAbc, setFiltroAbc] = useState<"all" | AbcClass>("all")
  const [filtroRot, setFiltroRot] = useState<"all" | RotClass>("all")
  const [search, setSearch] = useState("")

  const url = `/api/inventario/analisis-abc?dias=${dias}&diasMuerto=${diasMuerto}`
  const { data, isLoading } = useSWR<Resp>(url, fetcher)

  const filtered = useMemo(() => {
    if (!data) return [] as Row[]
    const s = search.trim().toLowerCase()
    return data.data.filter((r) => {
      if (filtroAbc !== "all" && r.clasificacionAbc !== filtroAbc) return false
      if (filtroRot !== "all" && r.clasificacionRotacion !== filtroRot) return false
      if (s && !r.nombre.toLowerCase().includes(s) && !r.codigo.toLowerCase().includes(s)) return false
      return true
    })
  }, [data, search, filtroAbc, filtroRot])

  const exportCsv = () => {
    if (!data) return
    const headers = [
      "codigo","nombre","categoria","proveedor","stock","precio_compra","precio_venta",
      "capital_inmovilizado","qty_vendida","revenue","margen_total","ventas_count",
      "dias_sin_venta","rotacion","dias_promedio_stock","pct_revenue","pct_acumulado",
      "abc","rotacion_class",
    ]
    const rows = filtered.map((r) => [
      r.codigo, `"${r.nombre.replace(/"/g, '""')}"`, r.categoria, r.proveedorNombre || "",
      r.stockActual, r.precioCompra, r.precioVenta, r.capitalInmovilizado,
      r.qtyVendida, r.revenue, r.margenTotal, r.ventasCount,
      r.diasSinVenta ?? "", r.rotacion, r.diasPromedioStock ?? "",
      r.pctRevenue, r.pctRevenueAcumulado,
      r.clasificacionAbc, r.clasificacionRotacion,
    ])
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n")
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `analisis-abc-${dias}d-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
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
              <BarChart3 className="h-6 w-6 text-primary" /> Análisis ABC + Rotación
            </h1>
            <p className="text-sm text-muted-foreground">
              Clasifica items por revenue (Pareto) y velocidad de rotación. Detecta dead stock y capital inmovilizado.
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={!data}>
          <Download className="h-3.5 w-3.5 mr-1" /> Exportar CSV
        </Button>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground">Período</label>
          <Select value={String(dias)} onValueChange={(v) => setDias(Number(v))}>
            <SelectTrigger className="w-28 h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="30">30 días</SelectItem>
              <SelectItem value="60">60 días</SelectItem>
              <SelectItem value="90">90 días</SelectItem>
              <SelectItem value="180">180 días</SelectItem>
              <SelectItem value="365">365 días</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground">Muerta si sin venta</label>
          <Select value={String(diasMuerto)} onValueChange={(v) => setDiasMuerto(Number(v))}>
            <SelectTrigger className="w-28 h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="30">30 días</SelectItem>
              <SelectItem value="60">60 días</SelectItem>
              <SelectItem value="90">90 días</SelectItem>
              <SelectItem value="180">180 días</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card><CardContent className="p-3">
              <div className="text-[10px] uppercase text-muted-foreground">Items analizados</div>
              <div className="text-xl font-bold">{data.totales.items}</div>
            </CardContent></Card>
            <Card><CardContent className="p-3">
              <div className="text-[10px] uppercase text-muted-foreground">Revenue {data.periodo.dias}d</div>
              <div className="text-lg font-bold">{formatPrice(data.totales.revenue)}</div>
            </CardContent></Card>
            <Card><CardContent className="p-3">
              <div className="text-[10px] uppercase text-muted-foreground">Capital inmovilizado</div>
              <div className="text-lg font-bold">{formatPrice(data.totales.capitalInmovilizado)}</div>
            </CardContent></Card>
            <Card><CardContent className="p-3">
              <div className="text-[10px] uppercase text-muted-foreground flex items-center gap-1">
                <Skull className="h-3 w-3" /> Capital muerto
              </div>
              <div className="text-lg font-bold text-destructive">{formatPrice(data.totales.capitalMuerto)}</div>
            </CardContent></Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Card>
              <CardContent className="p-3">
                <div className="text-xs uppercase text-muted-foreground mb-2">Distribución ABC (Pareto)</div>
                <div className="space-y-1.5">
                  {(["A", "B", "C", "SIN_VENTAS"] as const).map((c) => {
                    const r = data.resumenAbc[c]
                    const count = r.count
                    const total = data.totales.items
                    const pct = total > 0 ? (count / total) * 100 : 0
                    const monto = c === "SIN_VENTAS"
                      ? (r as { count: number; capitalInmovilizado: number }).capitalInmovilizado
                      : (r as { count: number; revenue: number }).revenue
                    return (
                      <div key={c} className="flex items-center gap-2 text-sm">
                        <div className="w-12 shrink-0">{abcBadge(c)}</div>
                        <div className="flex-1 min-w-0">
                          <div className="h-2 bg-muted rounded overflow-hidden">
                            <div
                              className={`h-full ${c === "A" ? "bg-emerald-600" : c === "B" ? "bg-blue-600" : c === "C" ? "bg-muted-foreground/40" : "bg-muted-foreground/20"}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground shrink-0 w-32 text-right">
                          {count} items · {formatPrice(monto)}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3">
                <div className="text-xs uppercase text-muted-foreground mb-2">Rotación</div>
                <div className="space-y-1.5">
                  {(["ALTA", "MEDIA", "BAJA", "MUERTA", "NUEVA"] as const).map((c) => {
                    const count = data.resumenRotacion[c]
                    return (
                      <div key={c} className="flex items-center justify-between gap-2 text-sm">
                        {rotBadge(c)}
                        <span className="text-muted-foreground">{count} items</span>
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar nombre o código..."
            className="pl-8 h-8"
          />
        </div>
        <Select value={filtroAbc} onValueChange={(v) => setFiltroAbc(v as any)}>
          <SelectTrigger className="w-32 h-8"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todo ABC</SelectItem>
            <SelectItem value="A">Clase A</SelectItem>
            <SelectItem value="B">Clase B</SelectItem>
            <SelectItem value="C">Clase C</SelectItem>
            <SelectItem value="SIN_VENTAS">Sin ventas</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filtroRot} onValueChange={(v) => setFiltroRot(v as any)}>
          <SelectTrigger className="w-36 h-8"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toda rotación</SelectItem>
            <SelectItem value="ALTA">Alta</SelectItem>
            <SelectItem value="MEDIA">Media</SelectItem>
            <SelectItem value="BAJA">Baja</SelectItem>
            <SelectItem value="MUERTA">Muerta</SelectItem>
            <SelectItem value="NUEVA">Nueva</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Sin items con los filtros actuales.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground border-b">
                <tr>
                  <th className="p-2">Item</th>
                  <th className="p-2 text-center">ABC</th>
                  <th className="p-2 text-center">Rotación</th>
                  <th className="p-2 text-right">Stock</th>
                  <th className="p-2 text-right">Vend.</th>
                  <th className="p-2 text-right">Revenue</th>
                  <th className="p-2 text-right">Margen</th>
                  <th className="p-2 text-right">Capital</th>
                  <th className="p-2 text-right">Rot/año</th>
                  <th className="p-2 text-right">Días sin venta</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((r) => {
                  const muerta = r.clasificacionRotacion === "MUERTA"
                  return (
                    <tr key={r.inventarioId} className={muerta ? "bg-destructive/5" : ""}>
                      <td className="p-2 min-w-[200px]">
                        <div className="font-medium truncate max-w-[280px]">{r.nombre}</div>
                        <div className="text-[11px] text-muted-foreground flex items-center gap-2">
                          <span>{r.codigo}</span>
                          {r.proveedorNombre && <span className="truncate">· {r.proveedorNombre}</span>}
                        </div>
                      </td>
                      <td className="p-2 text-center">{abcBadge(r.clasificacionAbc)}</td>
                      <td className="p-2 text-center">{rotBadge(r.clasificacionRotacion)}</td>
                      <td className="p-2 text-right">{r.stockActual}</td>
                      <td className="p-2 text-right">{r.qtyVendida}</td>
                      <td className="p-2 text-right font-medium">{formatPrice(r.revenue)}</td>
                      <td className="p-2 text-right text-emerald-600">{formatPrice(r.margenTotal)}</td>
                      <td className={`p-2 text-right ${muerta ? "text-destructive font-medium" : ""}`}>
                        {formatPrice(r.capitalInmovilizado)}
                      </td>
                      <td className="p-2 text-right">{r.rotacion > 0 ? r.rotacion.toFixed(1) : "—"}</td>
                      <td className="p-2 text-right">
                        {r.diasSinVenta === null ? (
                          <span className="text-muted-foreground">nunca</span>
                        ) : r.diasSinVenta > 90 ? (
                          <span className="text-destructive font-medium">{r.diasSinVenta}d</span>
                        ) : (
                          `${r.diasSinVenta}d`
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
