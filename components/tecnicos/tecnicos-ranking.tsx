"use client"

import { useMemo, useState } from "react"
import useSWR from "swr"
import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Download,
  ExternalLink,
  Medal,
  Trophy,
  Loader2,
} from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"
import { cn } from "@/lib/utils"

interface Tecnico {
  id: string
  nombre: string
  email: string
  activo: boolean
  especialidades?: string[]
  porcentajeComision?: number
  ordenesActivas: number
  ordenesCompletadas: number
}

interface Summary {
  rangoDias: number
  tecnicos: Array<{
    tecnicoId: string
    ordenesPeriodo: number
    completadas: number
    reingresos: number
    vencidas: number
    ingresos: number
    tasaSla: number | null
    tasaReingresos: number
    tatPromedioHoras: number
  }>
}

type SortKey =
  | "ingresos"
  | "completadas"
  | "tat"
  | "sla"
  | "reingresos"
  | "activas"
  | "nombre"

type SortDir = "asc" | "desc"

interface Row {
  id: string
  nombre: string
  email: string
  activo: boolean
  ordenesActivas: number
  ingresos: number
  completadas: number
  tat: number
  tasaSla: number | null
  tasaReingresos: number
  vencidas: number
  porcentajeComision: number
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

function formatHoras(h: number): string {
  if (!h) return "—"
  if (h < 1) return `${Math.round(h * 60)} min`
  if (h < 48) return `${h.toFixed(1)} h`
  return `${(h / 24).toFixed(1)} d`
}

function formatPct(n: number | null) {
  if (n == null) return "—"
  return `${(n * 100).toFixed(0)}%`
}

function Medalist({ pos }: { pos: number }) {
  if (pos === 1) return <Trophy className="h-4 w-4 text-amber-500" />
  if (pos === 2) return <Medal className="h-4 w-4 text-slate-400" />
  if (pos === 3) return <Medal className="h-4 w-4 text-orange-600" />
  return <span className="text-xs text-muted-foreground tabular-nums w-4 text-center">{pos}</span>
}

export function TecnicosRanking() {
  const { formatPrice } = useCurrency()
  const [dias, setDias] = useState("30")
  const [sortKey, setSortKey] = useState<SortKey>("ingresos")
  const [sortDir, setSortDir] = useState<SortDir>("desc")
  const [onlyActivos, setOnlyActivos] = useState(true)

  const { data: tecnicos = [], isLoading: loadingT } = useSWR<Tecnico[]>(
    "/api/tecnicos",
    fetcher,
    { revalidateOnFocus: false }
  )

  const { data: summary, isLoading: loadingS } = useSWR<Summary>(
    `/api/tecnicos/summary?dias=${dias}`,
    fetcher,
    { revalidateOnFocus: false }
  )

  const kpiById = useMemo(() => {
    const m = new Map<string, Summary["tecnicos"][number]>()
    for (const t of summary?.tecnicos || []) m.set(t.tecnicoId, t)
    return m
  }, [summary])

  const rows: Row[] = useMemo(() => {
    const filtered = onlyActivos ? tecnicos.filter((t) => t.activo) : tecnicos
    return filtered.map((t) => {
      const k = kpiById.get(t.id)
      return {
        id: t.id,
        nombre: t.nombre,
        email: t.email,
        activo: t.activo,
        ordenesActivas: t.ordenesActivas,
        ingresos: k?.ingresos ?? 0,
        completadas: k?.completadas ?? 0,
        tat: k?.tatPromedioHoras ?? 0,
        tasaSla: k?.tasaSla ?? null,
        tasaReingresos: k?.tasaReingresos ?? 0,
        vencidas: k?.vencidas ?? 0,
        porcentajeComision: Number(t.porcentajeComision ?? 0),
      }
    })
  }, [tecnicos, kpiById, onlyActivos])

  const sorted = useMemo(() => {
    const compare = (a: Row, b: Row): number => {
      const dir = sortDir === "asc" ? 1 : -1
      switch (sortKey) {
        case "nombre":
          return a.nombre.localeCompare(b.nombre) * dir
        case "ingresos":
          return (a.ingresos - b.ingresos) * dir
        case "completadas":
          return (a.completadas - b.completadas) * dir
        case "activas":
          return (a.ordenesActivas - b.ordenesActivas) * dir
        case "tat": {
          // TAT bajo es mejor: para "desc" queremos peores primero? No — que "desc" signifique mayor TAT primero.
          return (a.tat - b.tat) * dir
        }
        case "sla": {
          const av = a.tasaSla == null ? -1 : a.tasaSla
          const bv = b.tasaSla == null ? -1 : b.tasaSla
          return (av - bv) * dir
        }
        case "reingresos":
          return (a.tasaReingresos - b.tasaReingresos) * dir
      }
    }
    return [...rows].sort(compare)
  }, [rows, sortKey, sortDir])

  // Mejor por categoría (para badges informativos)
  const bestBy = useMemo(() => {
    if (rows.length === 0) return {}
    const withCompleted = rows.filter((r) => r.completadas > 0)
    return {
      ingresos: [...rows].sort((a, b) => b.ingresos - a.ingresos)[0]?.id,
      sla: [...rows]
        .filter((r) => r.tasaSla != null)
        .sort((a, b) => (b.tasaSla ?? 0) - (a.tasaSla ?? 0))[0]?.id,
      tat: [...withCompleted].sort((a, b) => a.tat - b.tat)[0]?.id,
      reingresos:
        withCompleted.length > 0
          ? [...withCompleted].sort((a, b) => a.tasaReingresos - b.tasaReingresos)[0].id
          : undefined,
    } as Record<string, string | undefined>
  }, [rows])

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(key)
      setSortDir(key === "nombre" || key === "tat" || key === "reingresos" ? "asc" : "desc")
    }
  }

  const sortIcon = (key: SortKey) => {
    if (sortKey !== key) return <ArrowUpDown className="h-3 w-3 text-muted-foreground/60" />
    return sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
  }

  const exportCSV = () => {
    const headers = [
      "Pos",
      "Técnico",
      "Email",
      "Activo",
      "Órdenes activas",
      "Ingresos",
      "Completadas",
      "TAT promedio (h)",
      "SLA",
      "Reingresos",
      "Vencidas",
      "% Comisión",
    ]
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`
    const lines = [
      headers.map(esc).join(","),
      ...sorted.map((r, i) =>
        [
          i + 1,
          r.nombre,
          r.email,
          r.activo ? "Sí" : "No",
          r.ordenesActivas,
          r.ingresos.toFixed(2),
          r.completadas,
          r.tat.toFixed(1),
          r.tasaSla == null ? "" : (r.tasaSla * 100).toFixed(0),
          (r.tasaReingresos * 100).toFixed(0),
          r.vencidas,
          r.porcentajeComision.toFixed(2),
        ]
          .map(esc)
          .join(",")
      ),
    ]
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `ranking_tecnicos_${dias}d.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const loading = loadingT || loadingS

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href="/tecnicos">
              <ArrowLeft className="h-4 w-4 mr-1.5" />
              Volver a la lista
            </Link>
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              className="accent-primary h-3.5 w-3.5"
              checked={onlyActivos}
              onChange={(e) => setOnlyActivos(e.target.checked)}
            />
            Solo activos
          </label>
          <Select value={dias} onValueChange={setDias}>
            <SelectTrigger className="h-9 w-[160px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Últimos 7 días</SelectItem>
              <SelectItem value="30">Últimos 30 días</SelectItem>
              <SelectItem value="90">Últimos 90 días</SelectItem>
              <SelectItem value="180">Últimos 180 días</SelectItem>
              <SelectItem value="365">Último año</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={exportCSV}
            disabled={sorted.length === 0}
          >
            <Download className="h-4 w-4 mr-1.5" />
            CSV
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="py-12 text-center text-muted-foreground flex items-center justify-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Cargando ranking…
            </div>
          ) : sorted.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-sm">
              Sin técnicos para mostrar en este período.
            </div>
          ) : (
            <>
            {/* Desktop: tabla */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/30">
                  <tr className="text-left">
                    <th className="px-3 py-2 font-medium text-xs text-muted-foreground w-12">#</th>
                    <th className="px-3 py-2 font-medium text-xs">
                      <button
                        onClick={() => handleSort("nombre")}
                        className="flex items-center gap-1 hover:text-foreground"
                      >
                        Técnico {sortIcon("nombre")}
                      </button>
                    </th>
                    <th className="px-3 py-2 font-medium text-xs text-right">
                      <button
                        onClick={() => handleSort("activas")}
                        className="flex items-center gap-1 hover:text-foreground ml-auto"
                      >
                        Activas {sortIcon("activas")}
                      </button>
                    </th>
                    <th className="px-3 py-2 font-medium text-xs text-right">
                      <button
                        onClick={() => handleSort("ingresos")}
                        className="flex items-center gap-1 hover:text-foreground ml-auto"
                      >
                        Ingresos {sortIcon("ingresos")}
                      </button>
                    </th>
                    <th className="px-3 py-2 font-medium text-xs text-right">
                      <button
                        onClick={() => handleSort("completadas")}
                        className="flex items-center gap-1 hover:text-foreground ml-auto"
                      >
                        Completadas {sortIcon("completadas")}
                      </button>
                    </th>
                    <th className="px-3 py-2 font-medium text-xs text-right">
                      <button
                        onClick={() => handleSort("tat")}
                        className="flex items-center gap-1 hover:text-foreground ml-auto"
                      >
                        TAT {sortIcon("tat")}
                      </button>
                    </th>
                    <th className="px-3 py-2 font-medium text-xs text-right">
                      <button
                        onClick={() => handleSort("sla")}
                        className="flex items-center gap-1 hover:text-foreground ml-auto"
                      >
                        SLA {sortIcon("sla")}
                      </button>
                    </th>
                    <th className="px-3 py-2 font-medium text-xs text-right">
                      <button
                        onClick={() => handleSort("reingresos")}
                        className="flex items-center gap-1 hover:text-foreground ml-auto"
                      >
                        Reingresos {sortIcon("reingresos")}
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r, i) => {
                    const pos = i + 1
                    const slaBajo = r.tasaSla != null && r.tasaSla < 0.8
                    const muchosReingresos =
                      r.completadas >= 3 && r.tasaReingresos > 0.1
                    return (
                      <tr
                        key={r.id}
                        className={cn(
                          "border-b last:border-0 hover:bg-muted/40 transition-colors",
                          !r.activo && "opacity-60"
                        )}
                      >
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-center">
                            <Medalist pos={pos} />
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <Link
                            href={`/tecnicos/${r.id}`}
                            className="inline-flex items-center gap-1.5 hover:underline"
                          >
                            <div className="flex flex-col min-w-0">
                              <span className="font-medium text-sm truncate flex items-center gap-1.5">
                                {r.nombre}
                                {!r.activo && (
                                  <Badge
                                    variant="outline"
                                    className="text-[9px] font-normal bg-muted"
                                  >
                                    Inactivo
                                  </Badge>
                                )}
                                {bestBy.ingresos === r.id && r.ingresos > 0 && (
                                  <Badge className="text-[9px] font-normal bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300">
                                    Top ingresos
                                  </Badge>
                                )}
                                {bestBy.sla === r.id && r.tasaSla != null && (
                                  <Badge className="text-[9px] font-normal bg-green-100 text-green-800 border-green-200 dark:bg-green-950/40 dark:text-green-300">
                                    Mejor SLA
                                  </Badge>
                                )}
                                {bestBy.tat === r.id && r.tat > 0 && (
                                  <Badge className="text-[9px] font-normal bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300">
                                    TAT más rápido
                                  </Badge>
                                )}
                              </span>
                              <span className="text-[11px] text-muted-foreground truncate">
                                {r.email}
                              </span>
                            </div>
                            <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0" />
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {r.ordenesActivas}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium">
                          {formatPrice(r.ingresos)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.completadas}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                          {formatHoras(r.tat)}
                        </td>
                        <td
                          className={cn(
                            "px-3 py-2 text-right tabular-nums font-medium",
                            slaBajo && "text-red-600 dark:text-red-400"
                          )}
                        >
                          {formatPct(r.tasaSla)}
                          {r.vencidas > 0 && (
                            <span className="text-[10px] text-red-600 ml-1">
                              ({r.vencidas} venc.)
                            </span>
                          )}
                        </td>
                        <td
                          className={cn(
                            "px-3 py-2 text-right tabular-nums",
                            muchosReingresos && "text-amber-700 dark:text-amber-400 font-medium"
                          )}
                        >
                          {r.completadas > 0 ? formatPct(r.tasaReingresos) : "—"}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile: cards */}
            <div className="sm:hidden divide-y">
              {sorted.map((r, i) => {
                const pos = i + 1
                const slaBajo = r.tasaSla != null && r.tasaSla < 0.8
                const muchosReingresos = r.completadas >= 3 && r.tasaReingresos > 0.1
                return (
                  <div key={r.id} className={cn("p-3 space-y-2.5", !r.activo && "opacity-60")}>
                    <div className="flex items-center gap-2">
                      <Medalist pos={pos} />
                      <Link href={`/tecnicos/${r.id}`} className="flex-1 min-w-0 hover:underline">
                        <span className="font-medium text-sm truncate flex flex-wrap items-center gap-1.5">
                          {r.nombre}
                          {!r.activo && (
                            <Badge variant="outline" className="text-[9px] font-normal bg-muted">Inactivo</Badge>
                          )}
                          {bestBy.ingresos === r.id && r.ingresos > 0 && (
                            <Badge className="text-[9px] font-normal bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300">Top ingresos</Badge>
                          )}
                          {bestBy.sla === r.id && r.tasaSla != null && (
                            <Badge className="text-[9px] font-normal bg-green-100 text-green-800 border-green-200 dark:bg-green-950/40 dark:text-green-300">Mejor SLA</Badge>
                          )}
                          {bestBy.tat === r.id && r.tat > 0 && (
                            <Badge className="text-[9px] font-normal bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300">TAT más rápido</Badge>
                          )}
                        </span>
                        <span className="block text-[11px] text-muted-foreground truncate">{r.email}</span>
                      </Link>
                      <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0" />
                    </div>
                    <div className="grid grid-cols-3 gap-x-2 gap-y-1.5 text-xs">
                      <div>
                        <span className="text-muted-foreground">Activas</span>
                        <div className="font-medium tabular-nums">{r.ordenesActivas}</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Ingresos</span>
                        <div className="font-medium tabular-nums">{formatPrice(r.ingresos)}</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Completadas</span>
                        <div className="font-medium tabular-nums">{r.completadas}</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">TAT</span>
                        <div className="tabular-nums text-muted-foreground">{formatHoras(r.tat)}</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">SLA</span>
                        <div className={cn("font-medium tabular-nums", slaBajo && "text-red-600 dark:text-red-400")}>
                          {formatPct(r.tasaSla)}
                          {r.vencidas > 0 && <span className="text-[10px] text-red-600 ml-1">({r.vencidas} venc.)</span>}
                        </div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Reingresos</span>
                        <div className={cn("tabular-nums", muchosReingresos && "text-amber-700 dark:text-amber-400 font-medium")}>
                          {r.completadas > 0 ? formatPct(r.tasaReingresos) : "—"}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
            </>
          )}
        </CardContent>
      </Card>

      {sorted.length > 0 && (
        <div className="text-xs text-muted-foreground px-2">
          <strong>TAT</strong> = tiempo medio desde ingreso hasta completado ·{" "}
          <strong>SLA</strong> = % de órdenes completadas dentro de la fecha prometida ·{" "}
          <strong>Reingresos</strong> = % de órdenes re-entradas por garantía
        </div>
      )}
    </div>
  )
}
