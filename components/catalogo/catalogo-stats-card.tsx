"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Eye, Users, FileText, TrendingUp, Loader2 } from "lucide-react"

type SerieDia = { fecha: string; vistas: number }
type ItemTop = { id: string; nombre: string; vistas: number }
type Stats = {
  vistas_total: number
  vistas_7d: number
  vistas_30d: number
  visitantes_unicos_30d: number
  cotizaciones_total: number
  cotizaciones_30d: number
  serie_30d: SerieDia[]
  items_top: ItemTop[]
}

export function CatalogoStatsCard() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/catalogo/stats")
        if (!res.ok) throw new Error()
        const data = (await res.json()) as Stats
        setStats(data)
      } catch {
        setStats(null)
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5" />
          Estadísticas
        </CardTitle>
        <CardDescription>Tráfico y solicitudes de los últimos 30 días.</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : !stats ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No hay datos disponibles.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <StatTile
                icon={Eye}
                label="Vistas 7d"
                value={stats.vistas_7d}
                subtitle={`${stats.vistas_30d} en 30d`}
              />
              <StatTile
                icon={Users}
                label="Visitantes únicos"
                value={stats.visitantes_unicos_30d}
                subtitle="últimos 30d"
              />
              <StatTile
                icon={FileText}
                label="Solicitudes 30d"
                value={stats.cotizaciones_30d}
                subtitle={`${stats.cotizaciones_total} totales`}
              />
              <StatTile
                icon={TrendingUp}
                label="Vistas totales"
                value={stats.vistas_total}
                subtitle="histórico"
              />
            </div>

            {stats.serie_30d.some((d) => d.vistas > 0) && (
              <div>
                <div className="text-xs text-muted-foreground mb-1.5">Vistas por día (30d)</div>
                <Sparkline data={stats.serie_30d.map((d) => d.vistas)} />
              </div>
            )}

            {stats.items_top.length > 0 && (
              <div>
                <div className="text-xs text-muted-foreground mb-1.5">Items más vistos (30d)</div>
                <ul className="space-y-1.5">
                  {stats.items_top.map((it, idx) => (
                    <li key={it.id} className="flex items-center gap-2 text-sm">
                      <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-muted text-xs font-medium shrink-0">
                        {idx + 1}
                      </span>
                      <span className="flex-1 truncate">{it.nombre}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {it.vistas} {it.vistas === 1 ? "vista" : "vistas"}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function StatTile({
  icon: Icon,
  label,
  value,
  subtitle,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: number
  subtitle?: string
}) {
  return (
    <div className="rounded-lg border p-3 bg-muted/30">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="text-2xl font-bold tabular-nums">{value.toLocaleString("es-AR")}</div>
      {subtitle && <div className="text-xs text-muted-foreground">{subtitle}</div>}
    </div>
  )
}

function Sparkline({ data }: { data: number[] }) {
  if (data.length === 0) return null
  const max = Math.max(...data, 1)
  const width = 280
  const height = 40
  const step = width / Math.max(data.length - 1, 1)
  const points = data
    .map((v, i) => `${(i * step).toFixed(2)},${(height - (v / max) * height).toFixed(2)}`)
    .join(" ")
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-10" preserveAspectRatio="none">
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-primary"
        points={points}
      />
    </svg>
  )
}
