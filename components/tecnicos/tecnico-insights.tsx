"use client"

import { useState } from "react"
import useSWR from "swr"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Timer,
  ShieldAlert,
  RotateCcw,
  Ban,
  DollarSign,
  AlertTriangle,
  PackageSearch,
  Wrench,
  Smartphone,
  TrendingUp,
  ExternalLink,
  Clock,
  CalendarClock,
} from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"
import { cn } from "@/lib/utils"

interface Insights {
  rangoDias: number
  totales: {
    totalOrdenes: number
    completadas: number
    activas: number
    reingresos: number
    sinReparacion: number
    vencidas: number
    ingresos: number
  }
  calidad: {
    tasaReingresos: number
    tasaSinReparacion: number
    tasaSla: number | null
  }
  tiempos: { tatPromedioHoras: number; tatMedianaHoras: number }
  especializacion: {
    porTipo: Array<{ tipo: string; count: number }>
    porMarca: Array<{ marca: string; count: number }>
  }
  topRepuestos: Array<{ nombre: string; cantidad: number; monto: number }>
  semanas: Array<{ semana: string; completadas: number; ingresos: number }>
  bloqueadas: Array<{
    id: string
    codigoOrden: string | null
    numeroOrden: number
    dispositivo: string
    dias: number
  }>
  proximasVencer: Array<{
    id: string
    codigoOrden: string | null
    numeroOrden: number
    dispositivo: string
    estado: string
    fechaPrometida: string
    horasRestantes: number
    vencida: boolean
  }>
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

function formatHoras(h: number): string {
  if (h < 1) return `${Math.round(h * 60)} min`
  if (h < 48) return `${h.toFixed(1)} h`
  return `${(h / 24).toFixed(1)} d`
}

function formatPct(n: number) {
  return `${(n * 100).toFixed(1)}%`
}

export function TecnicoInsights({ tecnicoId }: { tecnicoId: string }) {
  const { formatPrice } = useCurrency()
  const [dias, setDias] = useState("90")

  const { data, isLoading } = useSWR<Insights>(
    `/api/tecnicos/${tecnicoId}/insights?dias=${dias}`,
    fetcher,
    { revalidateOnFocus: false }
  )

  if (isLoading || !data) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">Cargando insights…</div>
    )
  }

  const { totales, calidad, tiempos, especializacion, topRepuestos, semanas, bloqueadas, proximasVencer } = data
  const maxComp = Math.max(...semanas.map((s) => s.completadas), 1)
  const semanaTopCount = maxComp

  return (
    <div className="space-y-4">
      {/* Selector de período */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Métricas operativas</span>
        </div>
        <Select value={dias} onValueChange={setDias}>
          <SelectTrigger className="w-[160px] h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="30">Últimos 30 días</SelectItem>
            <SelectItem value="90">Últimos 90 días</SelectItem>
            <SelectItem value="180">Últimos 6 meses</SelectItem>
            <SelectItem value="365">Último año</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* KPIs principales */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Kpi
          icon={<Timer className="h-4 w-4" />}
          label="TAT promedio"
          value={formatHoras(tiempos.tatPromedioHoras)}
          hint={`Mediana: ${formatHoras(tiempos.tatMedianaHoras)}`}
        />
        <Kpi
          icon={<DollarSign className="h-4 w-4" />}
          label="Ingresos generados"
          value={formatPrice(totales.ingresos)}
          hint={`${totales.completadas} orden(es) completadas`}
          accent="success"
        />
        <Kpi
          icon={<RotateCcw className="h-4 w-4" />}
          label="Reingresos por garantía"
          value={formatPct(calidad.tasaReingresos)}
          hint={`${totales.reingresos} de ${totales.completadas}`}
          accent={calidad.tasaReingresos > 0.1 ? "danger" : "default"}
        />
        <Kpi
          icon={<ShieldAlert className="h-4 w-4" />}
          label="Cumplimiento SLA"
          value={calidad.tasaSla == null ? "—" : formatPct(calidad.tasaSla)}
          hint={`${totales.vencidas} vencida(s)`}
          accent={calidad.tasaSla != null && calidad.tasaSla < 0.8 ? "danger" : "default"}
        />
      </div>

      {/* Alertas operativas */}
      {(proximasVencer.length > 0 || bloqueadas.length > 0) && (
        <div className="grid gap-3 lg:grid-cols-2">
          {proximasVencer.length > 0 && (
            <Card className="border-amber-200 dark:border-amber-900">
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  Vencen pronto o vencidas
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0 space-y-1.5">
                {proximasVencer.map((o) => (
                  <Link
                    key={o.id}
                    href={`/ordenes/${o.id}`}
                    className="flex items-center justify-between gap-2 text-xs py-1 hover:bg-muted/40 rounded px-1.5"
                  >
                    <span className="truncate">
                      <span className="font-medium text-primary">
                        {o.codigoOrden || `#${o.numeroOrden}`}
                      </span>{" "}
                      <span className="text-muted-foreground">{o.dispositivo}</span>
                    </span>
                    <Badge
                      variant={o.vencida ? "destructive" : "secondary"}
                      className="text-[10px] shrink-0"
                    >
                      <CalendarClock className="h-3 w-3 mr-0.5" />
                      {o.vencida ? `Vencida ${Math.abs(o.horasRestantes)}h` : `${o.horasRestantes}h`}
                    </Badge>
                  </Link>
                ))}
              </CardContent>
            </Card>
          )}

          {bloqueadas.length > 0 && (
            <Card className="border-orange-200 dark:border-orange-900">
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <PackageSearch className="h-4 w-4 text-orange-600" />
                  Esperando repuesto
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0 space-y-1.5">
                {bloqueadas.slice(0, 5).map((o) => (
                  <Link
                    key={o.id}
                    href={`/ordenes/${o.id}`}
                    className="flex items-center justify-between gap-2 text-xs py-1 hover:bg-muted/40 rounded px-1.5"
                  >
                    <span className="truncate">
                      <span className="font-medium text-primary">
                        {o.codigoOrden || `#${o.numeroOrden}`}
                      </span>{" "}
                      <span className="text-muted-foreground">{o.dispositivo}</span>
                    </span>
                    <Badge variant="outline" className="text-[10px] shrink-0">
                      <Clock className="h-3 w-3 mr-0.5" />
                      {o.dias}d
                    </Badge>
                  </Link>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Productividad semanal */}
      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Productividad semanal (últimas 8 semanas)
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {semanas.every((s) => s.completadas === 0) ? (
            <p className="text-xs text-muted-foreground">Sin órdenes completadas en el período.</p>
          ) : (
            <div className="flex items-end justify-between gap-1 h-28">
              {semanas.map((s, idx) => {
                const h = (s.completadas / semanaTopCount) * 100
                const isTop = s.completadas === semanaTopCount && s.completadas > 0
                return (
                  <div key={idx} className="flex flex-col items-center flex-1 gap-1">
                    <div className="text-[10px] font-medium">
                      {s.completadas > 0 ? s.completadas : ""}
                    </div>
                    <div className="w-full flex items-end h-20">
                      <div
                        className={cn(
                          "w-full rounded-t-sm transition-colors",
                          isTop ? "bg-primary" : "bg-primary/40"
                        )}
                        style={{ height: `${h}%`, minHeight: s.completadas ? 4 : 0 }}
                        title={`${s.semana}: ${s.completadas} órdenes · ${formatPrice(s.ingresos)}`}
                      />
                    </div>
                    <div className="text-[9px] text-muted-foreground">{s.semana}</div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Especialización + repuestos */}
      <div className="grid gap-3 lg:grid-cols-3">
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Smartphone className="h-4 w-4" />
              Por tipo de dispositivo
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 space-y-1.5">
            {especializacion.porTipo.length === 0 ? (
              <p className="text-xs text-muted-foreground">Sin datos.</p>
            ) : (
              especializacion.porTipo.slice(0, 5).map((t) => {
                const pct = (t.count / totales.totalOrdenes) * 100
                return (
                  <div key={t.tipo} className="space-y-0.5">
                    <div className="flex justify-between text-xs">
                      <span>{t.tipo}</span>
                      <span className="text-muted-foreground">{t.count}</span>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                )
              })
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Wrench className="h-4 w-4" />
              Marcas más reparadas
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 space-y-1.5">
            {especializacion.porMarca.length === 0 ? (
              <p className="text-xs text-muted-foreground">Sin datos.</p>
            ) : (
              especializacion.porMarca.map((m) => (
                <div key={m.marca} className="flex justify-between text-xs py-0.5">
                  <span className="truncate">{m.marca}</span>
                  <Badge variant="outline" className="text-[10px]">{m.count}</Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <PackageSearch className="h-4 w-4" />
              Top repuestos usados
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 space-y-1.5">
            {topRepuestos.length === 0 ? (
              <p className="text-xs text-muted-foreground">Sin repuestos usados.</p>
            ) : (
              topRepuestos.map((r, idx) => (
                <div key={idx} className="flex justify-between items-center text-xs py-0.5">
                  <span className="truncate flex-1 pr-2">{r.nombre}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="outline" className="text-[10px]">×{r.cantidad}</Badge>
                    <span className="text-muted-foreground">{formatPrice(r.monto)}</span>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Totales secundarios */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <MiniStat icon={<Wrench className="h-3.5 w-3.5" />} label="Activas" value={totales.activas} />
        <MiniStat icon={<Ban className="h-3.5 w-3.5" />} label="Sin reparación" value={totales.sinReparacion} hint={formatPct(calidad.tasaSinReparacion)} />
        <MiniStat icon={<RotateCcw className="h-3.5 w-3.5" />} label="Reingresos" value={totales.reingresos} />
        <MiniStat icon={<Timer className="h-3.5 w-3.5" />} label="Total del período" value={totales.totalOrdenes} />
      </div>
    </div>
  )
}

function Kpi({
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
  accent?: "default" | "success" | "danger"
}) {
  return (
    <Card>
      <CardContent className="p-3 sm:p-4">
        <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
          <span>{label}</span>
          <span
            className={cn(
              "p-1 rounded-md",
              accent === "success" && "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400",
              accent === "danger" && "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400",
              (!accent || accent === "default") && "bg-muted text-muted-foreground"
            )}
          >
            {icon}
          </span>
        </div>
        <div
          className={cn(
            "text-xl sm:text-2xl font-bold",
            accent === "success" && "text-green-600",
            accent === "danger" && "text-red-600"
          )}
        >
          {value}
        </div>
        {hint && <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div>}
      </CardContent>
    </Card>
  )
}

function MiniStat({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode
  label: string
  value: number
  hint?: string
}) {
  return (
    <Card>
      <CardContent className="p-3 flex items-center gap-3">
        <div className="p-2 rounded-md bg-muted text-muted-foreground">{icon}</div>
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="text-lg font-semibold">{value}</div>
          {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
        </div>
      </CardContent>
    </Card>
  )
}
