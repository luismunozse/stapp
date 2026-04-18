"use client"

import { useMemo, useState } from "react"
import useSWR from "swr"
import Link from "next/link"
import { useSession } from "next-auth/react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Wrench,
  Mail,
  ClipboardList,
  CheckCircle,
  Plus,
  Edit,
  Trash2,
  Eye,
  Search,
  Users,
  DollarSign,
  ShieldAlert,
  RotateCcw,
  TrendingUp,
  AlertTriangle,
  X,
  Trophy,
} from "lucide-react"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { TecnicoForm } from "./tecnico-form"
import { useModal } from "@/contexts/modal-context"
import { useCurrency } from "@/contexts/currency-context"
import { cn } from "@/lib/utils"

interface Tecnico {
  id: string
  nombre: string
  email: string
  telefono?: string | null
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

type EstadoFilter = "todos" | "activos" | "inactivos" | "con_alerta"
type SortKey = "nombre" | "activas" | "completadas" | "ingresos" | "sla"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

function formatPct(n: number) {
  return `${(n * 100).toFixed(0)}%`
}

export function TecnicosList() {
  const { data: session } = useSession()
  const isAdmin = session?.user?.role === "ADMIN"
  const { confirm, showError, showWarning } = useModal()
  const { formatPrice } = useCurrency()

  const [formOpen, setFormOpen] = useState(false)
  const [editingTecnico, setEditingTecnico] = useState<Tecnico | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const [search, setSearch] = useState("")
  const [estadoFilter, setEstadoFilter] = useState<EstadoFilter>("activos")
  const [especialidadFilter, setEspecialidadFilter] = useState<string>("todas")
  const [sortKey, setSortKey] = useState<SortKey>("nombre")
  const [dias, setDias] = useState<string>("30")

  const { data: tecnicos = [], isLoading: loading, mutate } = useSWR<Tecnico[]>(
    "/api/tecnicos",
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 5000 }
  )

  const { data: summary } = useSWR<Summary>(
    isAdmin ? `/api/tecnicos/summary?dias=${dias}` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 10000 }
  )

  const kpiById = useMemo(() => {
    const m = new Map<string, Summary["tecnicos"][number]>()
    for (const t of summary?.tecnicos || []) m.set(t.tecnicoId, t)
    return m
  }, [summary])

  const especialidadesDisponibles = useMemo(() => {
    const set = new Set<string>()
    for (const t of tecnicos) for (const e of t.especialidades || []) set.add(e)
    return Array.from(set).sort()
  }, [tecnicos])

  const tieneAlerta = (t: Tecnico) => {
    const k = kpiById.get(t.id)
    if (!k) return false
    if (k.tasaSla != null && k.tasaSla < 0.8) return true
    if (k.completadas >= 3 && k.tasaReingresos > 0.1) return true
    if (k.vencidas > 0) return true
    return false
  }

  const visibles = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = tecnicos.filter((t) => {
      if (estadoFilter === "activos" && !t.activo) return false
      if (estadoFilter === "inactivos" && t.activo) return false
      if (estadoFilter === "con_alerta" && !tieneAlerta(t)) return false
      if (
        especialidadFilter !== "todas" &&
        !(t.especialidades || []).includes(especialidadFilter)
      )
        return false
      if (q) {
        const hay = `${t.nombre} ${t.email}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })

    list = [...list].sort((a, b) => {
      if (sortKey === "nombre") return a.nombre.localeCompare(b.nombre)
      if (sortKey === "activas") return b.ordenesActivas - a.ordenesActivas
      if (sortKey === "completadas")
        return b.ordenesCompletadas - a.ordenesCompletadas
      if (sortKey === "ingresos")
        return (kpiById.get(b.id)?.ingresos ?? 0) - (kpiById.get(a.id)?.ingresos ?? 0)
      if (sortKey === "sla") {
        const sa = kpiById.get(a.id)?.tasaSla ?? 2
        const sb = kpiById.get(b.id)?.tasaSla ?? 2
        return sa - sb
      }
      return 0
    })
    return list
  }, [tecnicos, search, estadoFilter, especialidadFilter, sortKey, kpiById])

  const totales = useMemo(() => {
    const activos = tecnicos.filter((t) => t.activo).length
    const activasTotales = tecnicos.reduce((a, t) => a + t.ordenesActivas, 0)
    const ingresosPeriodo = (summary?.tecnicos || []).reduce(
      (a, t) => a + t.ingresos,
      0
    )
    const conAlertas = tecnicos.filter(tieneAlerta).length
    return {
      totalTecnicos: tecnicos.length,
      activos,
      inactivos: tecnicos.length - activos,
      activasTotales,
      ingresosPeriodo,
      conAlertas,
    }
  }, [tecnicos, summary, kpiById])

  const handleEdit = (tecnico: Tecnico, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setEditingTecnico(tecnico)
    setFormOpen(true)
  }

  const handleDelete = async (
    id: string,
    ordenesActivas: number,
    e: React.MouseEvent
  ) => {
    e.preventDefault()
    e.stopPropagation()

    if (ordenesActivas > 0) {
      await showWarning("No se puede eliminar un técnico con órdenes activas")
      return
    }

    const confirmed = await confirm({
      title: "Eliminar Técnico",
      description: "¿Estás seguro de eliminar este técnico? Esta acción no se puede deshacer.",
      confirmText: "Eliminar",
      cancelText: "Cancelar",
      variant: "danger",
    })

    if (!confirmed) return

    setDeletingId(id)
    try {
      const res = await fetch(`/api/tecnicos/${id}`, { method: "DELETE" })
      if (res.ok) {
        mutate()
      } else {
        const data = await res.json()
        await showError(data.error || "Error al eliminar")
      }
    } catch (error) {
      console.error("Error deleting tecnico:", error)
      await showError("Error al eliminar técnico")
    } finally {
      setDeletingId(null)
    }
  }

  const handleFormSuccess = () => {
    mutate()
    setEditingTecnico(null)
  }

  const handleFormClose = (open: boolean) => {
    setFormOpen(open)
    if (!open) setEditingTecnico(null)
  }

  const clearFilters = () => {
    setSearch("")
    setEstadoFilter("activos")
    setEspecialidadFilter("todas")
    setSortKey("nombre")
  }

  const filtrosActivos =
    search !== "" ||
    estadoFilter !== "activos" ||
    especialidadFilter !== "todas" ||
    sortKey !== "nombre"

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }

  return (
    <>
      {/* Panel resumen (solo admin) */}
      {isAdmin && tecnicos.length > 0 && (
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4 mb-4">
          <SummaryKpi
            icon={<Users className="h-4 w-4" />}
            label="Técnicos"
            value={`${totales.activos}`}
            hint={
              totales.inactivos > 0
                ? `${totales.inactivos} inactivo(s)`
                : `de ${totales.totalTecnicos} total`
            }
          />
          <SummaryKpi
            icon={<ClipboardList className="h-4 w-4" />}
            label="Órdenes activas"
            value={`${totales.activasTotales}`}
            hint="En curso del equipo"
          />
          <SummaryKpi
            icon={<DollarSign className="h-4 w-4" />}
            label={`Ingresos ${dias}d`}
            value={formatPrice(totales.ingresosPeriodo)}
            hint="Cobrado en el período"
            accent="success"
          />
          <SummaryKpi
            icon={<AlertTriangle className="h-4 w-4" />}
            label="Con alertas"
            value={`${totales.conAlertas}`}
            hint="SLA bajo, reingresos o vencidas"
            accent={totales.conAlertas > 0 ? "danger" : "default"}
          />
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-col gap-3 mb-4">
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nombre o email…"
              className="pl-8"
            />
          </div>
          {isAdmin && (
            <div className="flex gap-2">
              <Button variant="outline" asChild>
                <Link href="/tecnicos/ranking">
                  <Trophy className="mr-2 h-4 w-4" />
                  Ranking
                </Link>
              </Button>
              <Button onClick={() => setFormOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Nuevo Técnico
              </Button>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select value={estadoFilter} onValueChange={(v) => setEstadoFilter(v as EstadoFilter)}>
            <SelectTrigger className="h-9 w-[150px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="activos">Activos</SelectItem>
              <SelectItem value="inactivos">Inactivos</SelectItem>
              <SelectItem value="todos">Todos</SelectItem>
              {isAdmin && <SelectItem value="con_alerta">Con alertas</SelectItem>}
            </SelectContent>
          </Select>

          {especialidadesDisponibles.length > 0 && (
            <Select value={especialidadFilter} onValueChange={setEspecialidadFilter}>
              <SelectTrigger className="h-9 w-[170px] text-xs">
                <SelectValue placeholder="Especialidad" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas las especialidades</SelectItem>
                {especialidadesDisponibles.map((e) => (
                  <SelectItem key={e} value={e}>
                    {e}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
            <SelectTrigger className="h-9 w-[170px] text-xs">
              <TrendingUp className="h-3.5 w-3.5 mr-1" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="nombre">Orden: Nombre</SelectItem>
              <SelectItem value="activas">Orden: Activas</SelectItem>
              <SelectItem value="completadas">Orden: Completadas</SelectItem>
              {isAdmin && <SelectItem value="ingresos">Orden: Ingresos</SelectItem>}
              {isAdmin && <SelectItem value="sla">Orden: SLA (peor primero)</SelectItem>}
            </SelectContent>
          </Select>

          {isAdmin && (
            <Select value={dias} onValueChange={setDias}>
              <SelectTrigger className="h-9 w-[130px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Últimos 7 días</SelectItem>
                <SelectItem value="30">Últimos 30 días</SelectItem>
                <SelectItem value="90">Últimos 90 días</SelectItem>
                <SelectItem value="180">Últimos 180 días</SelectItem>
              </SelectContent>
            </Select>
          )}

          {filtrosActivos && (
            <Button variant="ghost" size="sm" className="h-9 text-xs" onClick={clearFilters}>
              <X className="h-3.5 w-3.5 mr-1" />
              Limpiar
            </Button>
          )}

          <div className="ml-auto text-xs text-muted-foreground">
            {visibles.length} de {tecnicos.length}
          </div>
        </div>
      </div>

      {tecnicos.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No hay técnicos registrados
            {isAdmin && (
              <div className="mt-4">
                <Button onClick={() => setFormOpen(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Agregar primer técnico
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      ) : visibles.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground text-sm">
            No hay técnicos que coincidan con los filtros.
            <div className="mt-3">
              <Button variant="outline" size="sm" onClick={clearFilters}>
                <X className="h-3.5 w-3.5 mr-1" />
                Limpiar filtros
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {visibles.map((tecnico) => {
            const k = kpiById.get(tecnico.id)
            const slaBajo = k?.tasaSla != null && k.tasaSla < 0.8
            const muchosReingresos =
              k != null && k.completadas >= 3 && k.tasaReingresos > 0.1
            const alertas: string[] = []
            if (slaBajo) alertas.push("SLA bajo")
            if (muchosReingresos) alertas.push("Reingresos altos")
            if (k && k.vencidas > 0) alertas.push(`${k.vencidas} vencida(s)`)

            return (
              <Link key={tecnico.id} href={`/tecnicos/${tecnico.id}`}>
                <Card
                  className={cn(
                    "hover:shadow-md transition-shadow cursor-pointer h-full",
                    !tecnico.activo && "opacity-70",
                    alertas.length > 0 && "border-amber-300 dark:border-amber-900"
                  )}
                >
                  <CardHeader className="p-3 sm:p-5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                        <div
                          className={cn(
                            "p-1.5 sm:p-2 rounded-lg shrink-0",
                            tecnico.activo ? "bg-primary/10" : "bg-muted"
                          )}
                        >
                          <Wrench
                            className={cn(
                              "h-4 w-4 sm:h-6 sm:w-6",
                              tecnico.activo ? "text-primary" : "text-muted-foreground"
                            )}
                          />
                        </div>
                        <div className="min-w-0">
                          <TooltipProvider delayDuration={300}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <CardTitle className="text-sm sm:text-base truncate flex items-center gap-1.5">
                                  {tecnico.nombre}
                                  {!tecnico.activo && (
                                    <Badge
                                      variant="outline"
                                      className="text-[9px] font-normal bg-muted"
                                    >
                                      Inactivo
                                    </Badge>
                                  )}
                                </CardTitle>
                              </TooltipTrigger>
                              <TooltipContent side="top">
                                <p className="font-medium">{tecnico.nombre}</p>
                                <p className="text-xs text-muted-foreground">{tecnico.email}</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                            <Mail className="h-3 w-3 shrink-0" />
                            <TooltipProvider delayDuration={300}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="truncate">{tecnico.email}</span>
                                </TooltipTrigger>
                                <TooltipContent side="bottom">{tecnico.email}</TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </div>
                        </div>
                      </div>
                      {isAdmin && (
                        <div className="flex gap-1 shrink-0">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 sm:h-8 sm:w-8"
                            onClick={(e) => handleEdit(tecnico, e)}
                          >
                            <Edit className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 sm:h-8 sm:w-8 text-destructive hover:text-destructive"
                            onClick={(e) =>
                              handleDelete(tecnico.id, tecnico.ordenesActivas, e)
                            }
                            disabled={deletingId === tecnico.id}
                          >
                            <Trash2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </CardHeader>

                  <CardContent className="p-3 sm:p-5 pt-0 space-y-2.5">
                    {/* Especialidades */}
                    {tecnico.especialidades && tecnico.especialidades.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {tecnico.especialidades.slice(0, 4).map((esp) => (
                          <Badge
                            key={esp}
                            variant="secondary"
                            className="text-[9px] font-normal px-1.5 py-0"
                          >
                            {esp}
                          </Badge>
                        ))}
                        {tecnico.especialidades.length > 4 && (
                          <Badge
                            variant="outline"
                            className="text-[9px] font-normal px-1.5 py-0"
                          >
                            +{tecnico.especialidades.length - 4}
                          </Badge>
                        )}
                      </div>
                    )}

                    {/* Órdenes */}
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="flex items-center justify-between p-2 rounded bg-muted/50">
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <ClipboardList className="h-3 w-3" />
                          Activas
                        </div>
                        <span className="font-semibold">{tecnico.ordenesActivas}</span>
                      </div>
                      <div className="flex items-center justify-between p-2 rounded bg-muted/50">
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <CheckCircle className="h-3 w-3" />
                          Hechas
                        </div>
                        <span className="font-semibold text-green-700 dark:text-green-500">
                          {tecnico.ordenesCompletadas}
                        </span>
                      </div>
                    </div>

                    {/* KPIs del período (admin) */}
                    {isAdmin && summary && (
                      <div className="space-y-1.5 text-[11px] pt-1 border-t">
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground flex items-center gap-1">
                            <DollarSign className="h-3 w-3" />
                            Ingresos {summary.rangoDias}d
                          </span>
                          <span className="font-medium">{formatPrice(k?.ingresos ?? 0)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground flex items-center gap-1">
                            <ShieldAlert className="h-3 w-3" />
                            SLA
                          </span>
                          <span
                            className={cn(
                              "font-medium",
                              slaBajo && "text-red-600 dark:text-red-400"
                            )}
                          >
                            {k?.tasaSla == null ? "—" : formatPct(k.tasaSla)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground flex items-center gap-1">
                            <RotateCcw className="h-3 w-3" />
                            Reingresos
                          </span>
                          <span
                            className={cn(
                              "font-medium",
                              muchosReingresos && "text-amber-700 dark:text-amber-500"
                            )}
                          >
                            {k?.completadas ? formatPct(k.tasaReingresos) : "—"}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Alertas */}
                    {alertas.length > 0 && (
                      <div className="flex items-start gap-1.5 p-1.5 rounded bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900">
                        <AlertTriangle className="h-3 w-3 text-amber-700 dark:text-amber-500 shrink-0 mt-0.5" />
                        <div className="text-[10px] text-amber-900 dark:text-amber-200 leading-tight">
                          {alertas.join(" · ")}
                        </div>
                      </div>
                    )}

                    {/* % Comisión + ver detalle */}
                    <div className="flex items-center justify-between pt-2 border-t text-xs">
                      <span className="text-muted-foreground">
                        % Comisión{" "}
                        <span className="font-medium text-foreground">
                          {Number(tecnico.porcentajeComision ?? 0).toFixed(2)}%
                        </span>
                      </span>
                      <span className="flex items-center gap-1 text-primary font-medium">
                        <Eye className="h-3 w-3" />
                        Ver
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      )}

      <TecnicoForm
        open={formOpen}
        onOpenChange={handleFormClose}
        tecnico={editingTecnico}
        onSuccess={handleFormSuccess}
      />
    </>
  )
}

function SummaryKpi({
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
      <CardContent className="p-3">
        <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
          <span>{label}</span>
          <span
            className={cn(
              "p-1 rounded-md",
              accent === "success" &&
                "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400",
              accent === "danger" &&
                "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400",
              (!accent || accent === "default") && "bg-muted text-muted-foreground"
            )}
          >
            {icon}
          </span>
        </div>
        <div
          className={cn(
            "text-lg sm:text-xl font-bold truncate",
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
